'use strict';

// La agenda que ve el dashboard.
//
// Regla (DECISIONS 14/09): Google Calendar ES la agenda. Lo que el dueño ve en su
// móvil y lo que ve en el dashboard tienen que ser lo mismo, así que el dashboard no
// lee una copia: lee Google, a través de este servidor (la clave nunca llega al
// navegador). La base de datos solo aporta la FICHA de cada cita que creó el agente
// —quién es el paciente, su WhatsApp, su conversación— y se cruza por el id del
// evento.
//
// Tres casos, y cada uno se enseña tal cual es:
//   - evento de Google con ficha      → cita del agente, con sus datos.
//   - evento de Google sin ficha      → la apuntó la clínica (source: 'calendar').
//   - ficha sin evento en Google      → no está en la agenda real (source:
//                                       'panel_only'); se enseña marcada, no se
//                                       esconde, para que el desajuste se vea.
//
// Negocios sin calendario conectado (o de demostración): lo de siempre, la base de
// datos.

const remote = require('./store/supabase');
const gcal = require('./integrations/googleCalendar');
const { cargarTenant } = require('./tenants');
const { calCfg, zonedDateTimeToIso } = require('./store/bookings');

const CAMPOS = 'id,contact_id,conversation_id,service_id,status,starts_at,ends_at,resource_name,notes,metadata,external_calendar_event_id,created_at,updated_at';

// Error con un mensaje que sí se le puede enseñar a la clínica tal cual.
class AgendaError extends Error {
    constructor(message, status = 502) {
        super(message);
        this.status = status;
        this.publicMessage = message;
    }
}

async function contactMap(db, organizationId, ids) {
    if (!ids.length) return new Map();
    const result = await db.from('contacts').select('id,name,phone,email,status,last_seen_at').eq('organization_id', organizationId).in('id', ids);
    if (result.error) throw result.error;
    return new Map((result.data || []).map(row => [row.id, row]));
}

async function serviceMap(db, organizationId, ids) {
    if (!ids.length) return new Map();
    const result = await db.from('services').select('id,name,duration_minutes,price_amount,currency').eq('organization_id', organizationId).in('id', ids);
    if (result.error) throw result.error;
    return new Map((result.data || []).map(row => [row.id, row]));
}

async function conFichas(db, organizationId, rows) {
    const contacts = await contactMap(db, organizationId, [...new Set(rows.map(row => row.contact_id).filter(Boolean))]);
    const services = await serviceMap(db, organizationId, [...new Set(rows.map(row => row.service_id).filter(Boolean))]);
    return rows.map(row => ({ ...row, contact: contacts.get(row.contact_id) || null, service: services.get(row.service_id) || null }));
}

// Calendario del negocio de esta organización, o null. La organización y el tenant
// comparten identificador (slug). Se hidrata igual que en el agente: la
// configuración de la base de datos manda sobre la de archivo.
async function calendarioDeOrganizacion(slug) {
    if (!slug) return null;
    let tenant;
    try { tenant = cargarTenant(slug); }
    catch (_) { return null; }
    return calCfg(await remote.hydrateTenant(tenant));
}

// Inicio y fin de un evento en ISO. Los de día completo empiezan a medianoche de
// Madrid y se marcan como tales.
function limitesDeEvento(ev, timeZone) {
    if (ev.start.dateTime) return { starts_at: new Date(ev.start.dateTime).toISOString(), ends_at: new Date(ev.end.dateTime).toISOString(), all_day: false };
    const [y, m, d] = ev.start.date.split('-');
    const [ye, me, de] = ev.end.date.split('-');
    return {
        starts_at: zonedDateTimeToIso(`${d}/${m}/${y}`, '00:00', timeZone),
        ends_at: zonedDateTimeToIso(`${de}/${me}/${ye}`, '00:00', timeZone),
        all_day: true
    };
}

// Combina eventos de Google con las fichas de la base de datos. Función pura: es la
// lógica que decide qué ve la clínica, y se prueba sin red.
function combinar(events, rows, { timeZone = 'Europe/Madrid', eventosAusentes = new Set() } = {}) {
    const porEvento = new Map(rows.filter(row => row.external_calendar_event_id).map(row => [row.external_calendar_event_id, row]));
    const vistos = new Set();
    const out = [];

    for (const ev of events) {
        const limites = limitesDeEvento(ev, timeZone);
        const ficha = porEvento.get(ev.id);
        if (ficha) {
            vistos.add(ev.id);
            out.push({
                ...ficha,
                starts_at: limites.starts_at,
                ends_at: limites.ends_at,
                // Si está en Google, es una cita: la verdad es el calendario, aunque la
                // ficha diga cancelada (pasaba al cancelar desde el dashboard antes del
                // 14/09, que no tocaba Google).
                status: ficha.status === 'cancelled' ? 'confirmed' : ficha.status,
                source: 'agent',
                title: null,
                all_day: limites.all_day
            });
        } else {
            out.push({
                id: `gcal:${ev.id}`,
                contact_id: null,
                conversation_id: null,
                service_id: null,
                status: 'confirmed',
                starts_at: limites.starts_at,
                ends_at: limites.ends_at,
                resource_name: null,
                notes: ev.description || null,
                metadata: {},
                external_calendar_event_id: ev.id,
                contact: null,
                service: null,
                source: 'calendar',
                title: ev.summary || 'Sin título',
                all_day: limites.all_day
            });
        }
    }

    for (const row of rows) {
        if (row.external_calendar_event_id && vistos.has(row.external_calendar_event_id)) continue;
        if (row.external_calendar_event_id) {
            // Tenía evento y no está en el intervalo: o se borró en Google (se enseña
            // cancelada) o se movió fuera de estas fechas (no toca enseñarla aquí).
            if (eventosAusentes.has(row.external_calendar_event_id)) out.push({ ...row, status: 'cancelled', source: 'agent', title: null, all_day: false });
            continue;
        }
        out.push({ ...row, source: 'panel_only', title: null, all_day: false });
    }

    return out.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

async function agendaDeOrganizacion({ organizationId, slug, from, to, status, limit = 250 }) {
    const db = remote.getClient();
    let query = db.from('appointments').select(CAMPOS).eq('organization_id', organizationId).order('starts_at').limit(Math.min(Number(limit) || 100, 500));
    if (from) query = query.gte('starts_at', from);
    if (to) query = query.lt('starts_at', to);
    const result = await query;
    if (result.error) throw result.error;
    const rows = await conFichas(db, organizationId, result.data || []);

    const cal = await calendarioDeOrganizacion(slug);
    if (!cal) return { appointments: status ? rows.filter(row => row.status === status) : rows, calendar: { connected: false } };

    const timeZone = cal.timezone || 'Europe/Madrid';
    const timeMin = from || new Date(Date.now() - 86_400_000).toISOString();
    const timeMax = to || new Date(Date.now() + 60 * 86_400_000).toISOString();
    let events;
    try { events = await gcal.listEvents(cal.calendar_id, timeMin, timeMax); }
    catch (err) {
        console.error('[Agenda] Lectura de Google Calendar falló:', err.message);
        throw new AgendaError('No se ha podido leer Google Calendar ahora mismo. Vuelve a intentarlo en unos segundos.');
    }

    // Citas del agente que la clínica ha movido a estas fechas desde otras: su ficha
    // tiene la hora vieja y la consulta por fechas no la trae. Se buscan por evento.
    const conFicha = new Set(rows.map(row => row.external_calendar_event_id).filter(Boolean));
    const sinFicha = events.map(ev => ev.id).filter(id => !conFicha.has(id));
    if (sinFicha.length) {
        const movidas = await db.from('appointments').select(CAMPOS).eq('organization_id', organizationId).in('external_calendar_event_id', sinFicha);
        if (movidas.error) throw movidas.error;
        rows.push(...await conFichas(db, organizationId, movidas.data || []));
    }

    // Fichas con evento que no aparece: una consulta por cada una para distinguir
    // "borrada en Google" de "movida a otras fechas". Suelen ser cero o una.
    const enIntervalo = new Set(events.map(ev => ev.id));
    const eventosAusentes = new Set();
    for (const row of rows) {
        const id = row.external_calendar_event_id;
        if (!id || enIntervalo.has(id) || row.status === 'cancelled') continue;
        try { if (!(await gcal.getEvent(cal.calendar_id, id))) eventosAusentes.add(id); }
        catch (err) { console.error('[Agenda] No se pudo comprobar un evento:', err.message); }
    }

    const appointments = combinar(events, rows, { timeZone, eventosAusentes });
    return { appointments: status ? appointments.filter(item => item.status === status) : appointments, calendar: { connected: true } };
}

module.exports = { agendaDeOrganizacion, calendarioDeOrganizacion, combinar, AgendaError };
