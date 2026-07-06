'use strict';

// Reservas por tenant. Fuente de verdad de las CITAS: Google Calendar si está
// configurado (con respaldo JSON), o solo JSON. Cubre alta, baja, reprogramación
// y consulta de huecos.

const db = require('./_db');
const gcal = require('../integrations/googleCalendar');
const FILE = 'bookings.json';

function horaAMin(h) { const [a, b] = h.split(':').map(Number); return a * 60 + (b || 0); }

function calCfg(tenant) {
    const c = (tenant.business && tenant.business.calendar) || null;
    return (c && c.calendar_id && gcal.disponible()) ? c : null;
}

// Modo AFORO (restaurantes): si business.capacidad.mesas > 0, un hueco admite
// tantas reservas simultáneas como mesas. Sin capacidad → modo cita (1 hueco =
// 1 reserva por profesional), que es el comportamiento de siempre.
function capacidadDe(tenant) {
    const c = tenant.business && tenant.business.capacidad;
    return (c && Number(c.mesas) > 0) ? c : null;
}

// Huecos ocupados [{ ini, fin, profesional }] (minutos) para una fecha.
async function busyIntervals(tenant, fecha) {
    const cfg = calCfg(tenant);
    if (cfg) {
        try { return await gcal.busyIntervalsForDate(cfg.calendar_id, fecha, cfg.timezone || 'Europe/Madrid'); }
        catch (err) { console.error('Lectura de Calendar falló, uso JSON:', err.message); }
    }
    const servicios = (tenant.services && tenant.services.servicios) || [];
    return db.leer(tenant.id, FILE, [])
        .filter(r => r.fecha === fecha && r.estado === 'confirmada')
        .map(r => { const ini = horaAMin(r.hora); const dur = (servicios.find(s => s.nombre === r.servicio) || {}).duracion_min || 60; return { ini, fin: ini + dur, profesional: r.profesional || null }; });
}

// ¿Está libre un hueco concreto? En modo aforo cuenta reservas solapadas contra
// el nº de mesas; en modo cita basta un solape para bloquear.
async function huecoLibre(tenant, fecha, hora, duracionMin, profesional) {
    const intervals = await busyIntervals(tenant, fecha);
    const ini = horaAMin(hora), fin = ini + duracionMin;
    const cap = capacidadDe(tenant);
    if (cap) {
        const solapadas = intervals.filter(o => ini < o.fin && fin > o.ini).length;
        return solapadas < Number(cap.mesas);
    }
    return !intervals.some(o => (!profesional || o.profesional === profesional || o.profesional == null) && ini < o.fin && fin > o.ini);
}

async function listarJSONPorFecha(tenantId, fecha) {
    return db.leer(tenantId, FILE, []).filter(r => r.fecha === fecha);
}

// Citas activas (confirmadas) de un cliente, por teléfono o contacto.
async function activasDeCliente(tenant, { telefono, contacto }) {
    const tel = (telefono || '').replace('whatsapp:', '');
    return db.leer(tenant.id, FILE, []).filter(r =>
        r.estado === 'confirmada' &&
        ((tel && r.telefono_cliente === tel) || (contacto && r.contacto === contacto))
    );
}

async function crear(tenant, datos) {
    const cfg = calCfg(tenant);
    let calendar = null;
    if (cfg) {
        try {
            calendar = await gcal.createEvent(cfg.calendar_id, {
                summary: `${datos.servicio} · ${datos.nombre}${datos.comensales ? ` · ${datos.comensales} pax` : ''}`,
                description: `Reserva vía WhatsApp (Studio32 Agent)\nCliente: ${datos.nombre}\nContacto: ${datos.contacto}\nWhatsApp: ${datos.telefono_cliente || '-'}\nComensales: ${datos.comensales || '-'}\nProfesional: ${datos.profesional || '-'}`,
                fecha: datos.fecha, hora: datos.hora, duracion_min: datos.duracion_min || 60,
                timezone: cfg.timezone || 'Europe/Madrid', profesional: datos.profesional, contacto: datos.contacto, tenantId: tenant.id
            });
        } catch (err) { console.error('Alta en Calendar falló, guardo solo JSON:', err.message); }
    }
    const all = db.leer(tenant.id, FILE, []);
    const reserva = { id: db.id(), creada: new Date().toISOString(), estado: 'confirmada', calendar_event_id: calendar ? calendar.id : null, calendar_link: calendar ? calendar.htmlLink : null, ...datos };
    all.push(reserva);
    db.escribir(tenant.id, FILE, all);
    return reserva;
}

async function cancelar(tenant, id) {
    const all = db.leer(tenant.id, FILE, []);
    const r = all.find(x => x.id === id);
    if (!r) return null;
    const cfg = calCfg(tenant);
    if (cfg && r.calendar_event_id) {
        try { await gcal.deleteEvent(cfg.calendar_id, r.calendar_event_id); }
        catch (err) { console.error('Baja en Calendar falló:', err.message); }
    }
    r.estado = 'cancelada';
    r.cancelada = new Date().toISOString();
    db.escribir(tenant.id, FILE, all);
    return r;
}

async function reprogramar(tenant, id, nuevaFecha, nuevaHora) {
    const all = db.leer(tenant.id, FILE, []);
    const r = all.find(x => x.id === id);
    if (!r) return null;
    const cfg = calCfg(tenant);
    if (cfg && r.calendar_event_id) {
        try { await gcal.updateEvent(cfg.calendar_id, r.calendar_event_id, { fecha: nuevaFecha, hora: nuevaHora, duracion_min: r.duracion_min || 60, timezone: cfg.timezone || 'Europe/Madrid' }); }
        catch (err) { console.error('Mover en Calendar falló:', err.message); }
    }
    r.fecha_anterior = r.fecha; r.hora_anterior = r.hora;
    r.fecha = nuevaFecha; r.hora = nuevaHora; r.reprogramada = new Date().toISOString();
    db.escribir(tenant.id, FILE, all);
    return r;
}

async function listar(tenantId) { return db.leer(tenantId, FILE, []); }

module.exports = { busyIntervals, huecoLibre, capacidadDe, listarJSONPorFecha, activasDeCliente, crear, cancelar, reprogramar, listar };
