'use strict';

// Integración con Google Calendar como AGENDA REAL de reservas.
// - busyIntervalsForDate: huecos ocupados del día (checkAvailability).
// - createEvent / updateEvent / deleteEvent: alta, mover y baja de citas.
// - listEvents / getEvent: la agenda tal cual la ve el dueño (dashboard, agente).
//
// Cada función recibe el CALENDARIO como primer argumento, de una de dos formas:
//
//   - La config del negocio (`business.calendar`) con provider 'google_oauth': la
//     clínica conectó su cuenta desde el dashboard. Se usa SU acceso, guardado
//     cifrado por organización (store/calendarConnections). Es el camino del producto.
//   - Un calendar_id suelto, o una config sin provider: CUENTA DE SERVICIO de
//     Studio32 (GOOGLE_CREDENTIALS_FILE o GOOGLE_CREDENTIALS_JSON), con el calendario
//     compartido a mano con ella. Se queda para calendarios propios y pruebas.
//
// 'googleapis' se carga de forma perezosa.

let _serviceCalendar = null;
let _serviceTried = false;
const _oauthCalendars = new Map(); // organization_id → { token, calendar }

function esOAuth(ref) {
    return Boolean(ref && typeof ref === 'object' && ref.provider === 'google_oauth');
}

function idDe(ref) {
    return typeof ref === 'string' ? ref : ref && ref.calendar_id;
}

function cuentaDeServicioDisponible() {
    return !!(process.env.GOOGLE_CREDENTIALS_JSON || process.env.GOOGLE_CREDENTIALS_FILE);
}

// ¿Se puede usar este calendario desde este servidor? Sin argumento, pregunta por la
// cuenta de servicio (compatibilidad con check.js y /health).
function disponible(ref) {
    if (esOAuth(ref)) return require('./googleOAuth').disponible() && require('../secretBox').disponible();
    return cuentaDeServicioDisponible();
}

function calendarioDeServicio() {
    if (_serviceTried) return _serviceCalendar;
    _serviceTried = true;
    if (!cuentaDeServicioDisponible()) return null;
    const { google } = require('googleapis');
    const authOpts = process.env.GOOGLE_CREDENTIALS_JSON
        ? { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) }
        : { keyFile: process.env.GOOGLE_CREDENTIALS_FILE };
    const auth = new google.auth.GoogleAuth({ ...authOpts, scopes: ['https://www.googleapis.com/auth/calendar'] });
    _serviceCalendar = google.calendar({ version: 'v3', auth });
    return _serviceCalendar;
}

async function calendarioDeClinica(ref) {
    const conexiones = require('../store/calendarConnections');
    const token = await conexiones.refreshTokenDe(ref.organization_id);
    if (!token) throw new Error('Google Calendar está desconectado para este negocio.');
    const cached = _oauthCalendars.get(ref.organization_id);
    if (cached && cached.token === token) return cached.calendar;
    const { google } = require('googleapis');
    const calendar = google.calendar({ version: 'v3', auth: require('./googleOAuth').clienteConRefreshToken(token) });
    _oauthCalendars.set(ref.organization_id, { token, calendar });
    return calendar;
}

async function clienteDe(ref) {
    if (esOAuth(ref)) return calendarioDeClinica(ref);
    return calendarioDeServicio();
}

// Ejecuta una llamada a Google. Si la clínica retiró el acceso (o caducó), se marca la
// conexión para que el dashboard pida reconectar y se lanza un error entendible.
async function conGoogle(ref, fn) {
    try { return await fn(); }
    catch (err) {
        if (esOAuth(ref) && require('./googleOAuth').accesoRetirado(err)) {
            _oauthCalendars.delete(ref.organization_id);
            await require('../store/calendarConnections').marcarError(ref.organization_id, 'Google ya no acepta el acceso. Vuelve a conectar Google Calendar.');
            throw new Error('Google Calendar necesita reconectarse.');
        }
        throw err;
    }
}

const pad = (n) => String(n).padStart(2, '0');

function _bounds(datos) {
    const [d, m, y] = datos.fecha.split('/').map(Number);
    const [H, M] = datos.hora.split(':').map(Number);
    const startLocal = `${y}-${pad(m)}-${pad(d)}T${pad(H)}:${pad(M)}:00`;
    const endMin = H * 60 + M + (datos.duracion_min || 60);
    const endLocal = `${y}-${pad(m)}-${pad(d)}T${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}:00`;
    return { startLocal, endLocal };
}

async function busyIntervalsForDate(ref, fechaStr, timezone) {
    const cal = await clienteDe(ref);
    if (!cal) return [];
    const calendarId = idDe(ref);
    const [d, m, y] = fechaStr.split('/').map(Number);
    const timeMin = new Date(Date.UTC(y, m - 1, d - 1, 0, 0, 0)).toISOString();
    const timeMax = new Date(Date.UTC(y, m - 1, d + 2, 0, 0, 0)).toISOString();
    const res = await conGoogle(ref, () => cal.events.list({ calendarId, timeMin, timeMax, singleEvents: true, orderBy: 'startTime', maxResults: 2500 }));
    const items = res.data.items || [];
    const fmtDate = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const fmtTime = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false });
    const target = `${y}-${pad(m)}-${pad(d)}`;
    const out = [];
    for (const ev of items) {
        if (!ev.start) continue;
        // Evento de día completo ("cerrado por vacaciones", "formación del equipo"):
        // no tiene dateTime, tiene date (y end.date es EXCLUSIVO, tal cual lo da la
        // API). Antes se ignoraba sin más, así que un día marcado cerrado en Google
        // seguía dando horas — el agente citaba sobre un día en el que el negocio no
        // abría. Bloquea el día entero, para cualquier profesional.
        if (!ev.start.dateTime) {
            if (ev.start.date && ev.end && ev.end.date && ev.start.date <= target && target < ev.end.date) {
                out.push({ ini: 0, fin: 24 * 60, profesional: null });
            }
            continue;
        }
        const s = new Date(ev.start.dateTime), e = new Date(ev.end.dateTime);
        if (fmtDate.format(s) !== target) continue;
        const [sh, sm] = fmtTime.format(s).split(':').map(Number);
        const [eh, em] = fmtTime.format(e).split(':').map(Number);
        out.push({ ini: sh * 60 + sm, fin: eh * 60 + em, profesional: (ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.profesional) || null });
    }
    return out;
}

async function createEvent(ref, datos) {
    const cal = await clienteDe(ref);
    if (!cal) throw new Error('Google Calendar no configurado.');
    const { startLocal, endLocal } = _bounds(datos);
    const ev = await conGoogle(ref, () => cal.events.insert({
        calendarId: idDe(ref),
        requestBody: {
            summary: datos.summary,
            description: datos.description,
            start: { dateTime: startLocal, timeZone: datos.timezone },
            end: { dateTime: endLocal, timeZone: datos.timezone },
            extendedProperties: { private: { profesional: datos.profesional || '', contacto: datos.contacto || '', source: 'studio32-agent', tenant: datos.tenantId || '' } }
        }
    }));
    return { id: ev.data.id, htmlLink: ev.data.htmlLink };
}

async function updateEvent(ref, eventId, datos) {
    const cal = await clienteDe(ref);
    if (!cal) throw new Error('Google Calendar no configurado.');
    const { startLocal, endLocal } = _bounds(datos);
    await conGoogle(ref, () => cal.events.patch({
        calendarId: idDe(ref), eventId,
        requestBody: { start: { dateTime: startLocal, timeZone: datos.timezone }, end: { dateTime: endLocal, timeZone: datos.timezone } }
    }));
}

// Borrar algo que ya no está (el dueño lo quitó desde el móvil) no es un fallo:
// el resultado que se buscaba ya se cumple.
async function deleteEvent(ref, eventId) {
    const cal = await clienteDe(ref);
    if (!cal) return;
    try { await conGoogle(ref, () => cal.events.delete({ calendarId: idDe(ref), eventId })); }
    catch (err) { if (!yaNoExiste(err)) throw err; }
}

function yaNoExiste(err) {
    const code = err && (err.code || (err.response && err.response.status));
    return code === 404 || code === 410;
}

// Eventos del calendario en un intervalo, tal cual los ve el dueño en su móvil.
// Es la lectura que usa el dashboard: Google es la agenda, no una copia.
async function listEvents(ref, timeMin, timeMax) {
    const cal = await clienteDe(ref);
    if (!cal) throw new Error('Google Calendar no configurado.');
    const items = [];
    let pageToken;
    do {
        const res = await conGoogle(ref, () => cal.events.list({
            calendarId: idDe(ref), timeMin, timeMax, singleEvents: true, orderBy: 'startTime',
            maxResults: 2500, pageToken
        }));
        items.push(...(res.data.items || []));
        pageToken = res.data.nextPageToken;
    } while (pageToken);
    return items.filter(ev => ev.status !== 'cancelled' && ev.start);
}

// Un evento concreto, o null si ya no existe o está cancelado.
async function getEvent(ref, eventId) {
    const cal = await clienteDe(ref);
    if (!cal) throw new Error('Google Calendar no configurado.');
    try {
        const res = await conGoogle(ref, () => cal.events.get({ calendarId: idDe(ref), eventId }));
        return res.data && res.data.status !== 'cancelled' ? res.data : null;
    } catch (err) {
        if (yaNoExiste(err)) return null;
        throw err;
    }
}

// Calendarios de la cuenta conectada en los que la clínica es dueña: son los únicos
// en los que el permiso pedido (calendar.events.owned) deja trabajar al asistente.
async function listOwnedCalendars(ref) {
    const cal = await clienteDe(ref);
    if (!cal) throw new Error('Google Calendar no configurado.');
    const res = await conGoogle(ref, () => cal.calendarList.list({ minAccessRole: 'owner', maxResults: 250 }));
    return (res.data.items || []).map(item => ({ id: item.id, summary: item.summaryOverride || item.summary, timeZone: item.timeZone || null, primary: Boolean(item.primary) }));
}

module.exports = { disponible, busyIntervalsForDate, createEvent, updateEvent, deleteEvent, listEvents, getEvent, listOwnedCalendars };
