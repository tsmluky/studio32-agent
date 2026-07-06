'use strict';

// Integración con Google Calendar como AGENDA REAL de reservas.
// - busyIntervalsForDate: huecos ocupados del día (checkAvailability).
// - createEvent: alta de cita (createBooking).
// - deleteEvent: baja de cita (cancelBooking).
// - updateEvent: mover cita (rescheduleBooking).
//
// Autenticación por SERVICE ACCOUNT. Credenciales por GOOGLE_CREDENTIALS_FILE
// (ruta a .json) o GOOGLE_CREDENTIALS_JSON (JSON en una variable). El calendario
// de cada negocio se comparte con el email de la service account (permiso
// "Hacer cambios en eventos"). El calendar_id va en business.json.
// 'googleapis' se carga de forma perezosa.

let _calendar = null;
let _tried = false;

function disponible() {
    return !!(process.env.GOOGLE_CREDENTIALS_JSON || process.env.GOOGLE_CREDENTIALS_FILE);
}

function getCalendar() {
    if (_tried) return _calendar;
    _tried = true;
    if (!disponible()) return null;
    const { google } = require('googleapis');
    const authOpts = process.env.GOOGLE_CREDENTIALS_JSON
        ? { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) }
        : { keyFile: process.env.GOOGLE_CREDENTIALS_FILE };
    const auth = new google.auth.GoogleAuth({ ...authOpts, scopes: ['https://www.googleapis.com/auth/calendar'] });
    _calendar = google.calendar({ version: 'v3', auth });
    return _calendar;
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

async function busyIntervalsForDate(calendarId, fechaStr, timezone) {
    const cal = getCalendar();
    if (!cal) return [];
    const [d, m, y] = fechaStr.split('/').map(Number);
    const timeMin = new Date(Date.UTC(y, m - 1, d - 1, 0, 0, 0)).toISOString();
    const timeMax = new Date(Date.UTC(y, m - 1, d + 2, 0, 0, 0)).toISOString();
    const res = await cal.events.list({ calendarId, timeMin, timeMax, singleEvents: true, orderBy: 'startTime', maxResults: 2500 });
    const items = res.data.items || [];
    const fmtDate = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const fmtTime = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false });
    const target = `${y}-${pad(m)}-${pad(d)}`;
    const out = [];
    for (const ev of items) {
        if (!ev.start || !ev.start.dateTime) continue;
        const s = new Date(ev.start.dateTime), e = new Date(ev.end.dateTime);
        if (fmtDate.format(s) !== target) continue;
        const [sh, sm] = fmtTime.format(s).split(':').map(Number);
        const [eh, em] = fmtTime.format(e).split(':').map(Number);
        out.push({ ini: sh * 60 + sm, fin: eh * 60 + em, profesional: (ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.profesional) || null });
    }
    return out;
}

async function createEvent(calendarId, datos) {
    const cal = getCalendar();
    if (!cal) throw new Error('Google Calendar no configurado.');
    const { startLocal, endLocal } = _bounds(datos);
    const ev = await cal.events.insert({
        calendarId,
        requestBody: {
            summary: datos.summary,
            description: datos.description,
            start: { dateTime: startLocal, timeZone: datos.timezone },
            end: { dateTime: endLocal, timeZone: datos.timezone },
            extendedProperties: { private: { profesional: datos.profesional || '', contacto: datos.contacto || '', source: 'studio32-agent', tenant: datos.tenantId || '' } }
        }
    });
    return { id: ev.data.id, htmlLink: ev.data.htmlLink };
}

async function updateEvent(calendarId, eventId, datos) {
    const cal = getCalendar();
    if (!cal) throw new Error('Google Calendar no configurado.');
    const { startLocal, endLocal } = _bounds(datos);
    await cal.events.patch({
        calendarId, eventId,
        requestBody: { start: { dateTime: startLocal, timeZone: datos.timezone }, end: { dateTime: endLocal, timeZone: datos.timezone } }
    });
}

async function deleteEvent(calendarId, eventId) {
    const cal = getCalendar();
    if (!cal) return;
    await cal.events.delete({ calendarId, eventId });
}

module.exports = { disponible, busyIntervalsForDate, createEvent, updateEvent, deleteEvent };
