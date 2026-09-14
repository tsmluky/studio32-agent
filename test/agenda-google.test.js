'use strict';

// Google Calendar es la agenda (DECISIONS 14/09).
//
// Lo que el dueño ve en su móvil y lo que ve en el dashboard tienen que ser lo mismo,
// y el agente no puede contarle a un paciente una cita que la clínica ya movió o
// borró. Aquí se fija sin red: Google se simula sustituyendo las funciones del módulo.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { PATHS } = require('../src/config');
const gcal = require('../src/integrations/googleCalendar');
const remote = require('../src/store/supabase');
const bookings = require('../src/store/bookings');
const { combinar } = require('../src/agenda');

const TENANT = '__test_agenda_google';
const original = { ...gcal };
const enabledOriginal = remote.enabled;

function tenant(extra = {}) {
    return {
        id: TENANT,
        business: { demo: false, calendar: { calendar_id: 'cal@test', timezone: 'Europe/Madrid' }, ...extra },
        services: { servicios: [{ nombre: 'Revisión', duracion_min: 30 }] }
    };
}

function escribirReservas(reservas) {
    const dir = path.join(PATHS.data, TENANT);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bookings.json'), JSON.stringify(reservas, null, 2));
}

function leerReservas() {
    return JSON.parse(fs.readFileSync(path.join(PATHS.data, TENANT, 'bookings.json'), 'utf8'));
}

test.beforeEach(() => {
    gcal.disponible = () => true;
    remote.enabled = () => false; // sin espejo en Supabase durante las pruebas
});

test.afterEach(() => {
    Object.assign(gcal, original);
    remote.enabled = enabledOriginal;
    fs.rmSync(path.join(PATHS.data, TENANT), { recursive: true, force: true });
});

// ─── Qué ve la clínica en el dashboard ───

const EVENTO_AGENTE = { id: 'ev-agente', summary: 'Revisión · Marta', start: { dateTime: '2026-09-17T11:30:00+02:00' }, end: { dateTime: '2026-09-17T12:00:00+02:00' } };
const EVENTO_CLINICA = { id: 'ev-clinica', summary: 'Paciente llamó por teléfono', start: { dateTime: '2026-09-17T16:00:00+02:00' }, end: { dateTime: '2026-09-17T16:30:00+02:00' } };
const FICHA = { id: 'row-1', status: 'confirmed', starts_at: '2026-09-17T08:00:00.000Z', ends_at: '2026-09-17T08:30:00.000Z', external_calendar_event_id: 'ev-agente', contact: { name: 'Marta' }, service: { name: 'Revisión' } };

test('una cita apuntada en el móvil aparece en el dashboard', () => {
    const vista = combinar([EVENTO_CLINICA], []);
    assert.equal(vista.length, 1);
    assert.equal(vista[0].source, 'calendar');
    assert.equal(vista[0].title, 'Paciente llamó por teléfono');
    assert.equal(vista[0].id, 'gcal:ev-clinica');
});

test('una cita del agente lleva su ficha y la hora que dice Google, no la de la copia', () => {
    // La ficha dice 10:00 (08:00Z); en Google la clínica la movió a las 11:30.
    const [cita] = combinar([EVENTO_AGENTE], [FICHA]);
    assert.equal(cita.source, 'agent');
    assert.equal(cita.contact.name, 'Marta');
    assert.equal(cita.starts_at, '2026-09-17T09:30:00.000Z');
});

test('si está en Google es una cita, aunque la ficha diga cancelada', () => {
    const [cita] = combinar([EVENTO_AGENTE], [{ ...FICHA, status: 'cancelled' }]);
    assert.equal(cita.status, 'confirmed');
});

test('una cita del agente borrada en Google se enseña cancelada', () => {
    const [cita] = combinar([], [FICHA], { eventosAusentes: new Set(['ev-agente']) });
    assert.equal(cita.status, 'cancelled');
});

test('una cita del agente movida a otras fechas no se enseña en estas', () => {
    assert.deepEqual(combinar([], [FICHA]), []);
});

test('lo que solo existe en la copia se enseña marcado, no se esconde', () => {
    const [cita] = combinar([], [{ ...FICHA, external_calendar_event_id: null }]);
    assert.equal(cita.source, 'panel_only');
});

test('un día completo se enseña como tal, empezando a medianoche de Madrid', () => {
    const [cita] = combinar([{ id: 'vac', summary: 'Vacaciones', start: { date: '2026-09-18' }, end: { date: '2026-09-19' } }], []);
    assert.equal(cita.all_day, true);
    assert.equal(cita.starts_at, '2026-09-17T22:00:00.000Z');
});

// ─── Las demos nunca tocan Google ───

test('un tenant de demostración no usa Google aunque tenga calendar_id', () => {
    assert.equal(bookings.calCfg(tenant({ demo: true })), null);
    assert.ok(bookings.calCfg(tenant()));
});

// ─── El agente respeta lo que la clínica cambió en el móvil ───

const RESERVA = { id: 'r1', estado: 'confirmada', fecha: '17/09/2026', hora: '10:00', duracion_min: 30, servicio: 'Revisión', telefono_cliente: '600111111', contacto: '600111111', calendar_event_id: 'ev-agente' };

test('si la clínica borró la cita en Google, el agente ya no la da por activa', async () => {
    escribirReservas([RESERVA]);
    gcal.getEvent = async () => null;
    const activas = await bookings.activasDeCliente(tenant(), { telefono: '600111111' });
    assert.deepEqual(activas, []);
    assert.equal(leerReservas()[0].estado, 'cancelada');
    assert.equal(leerReservas()[0].cancelada_por, 'calendar');
});

test('si la clínica movió la cita en Google, el agente toma la hora nueva', async () => {
    escribirReservas([RESERVA]);
    gcal.getEvent = async () => EVENTO_AGENTE;
    const [cita] = await bookings.activasDeCliente(tenant(), { telefono: '600111111' });
    assert.equal(cita.hora, '11:30');
    assert.equal(cita.hora_anterior, '10:00');
    assert.equal(leerReservas()[0].hora, '11:30');
});

test('si Google no responde, no se contesta con la copia', async () => {
    escribirReservas([RESERVA]);
    gcal.getEvent = async () => { throw new Error('Google caído'); };
    await assert.rejects(bookings.activasDeCliente(tenant(), { telefono: '600111111' }), /Google caído/);
});

// ─── Cancelar ───

test('cancelar desde el dashboard (estricto) no cancela nada si Google falla', async () => {
    escribirReservas([RESERVA]);
    gcal.deleteEvent = async () => { throw new Error('Google caído'); };
    await assert.rejects(bookings.cancelar(tenant(), 'r1', { estricto: true }), /Google caído/);
    assert.equal(leerReservas()[0].estado, 'confirmada', 'sigue activa: no se puede enseñar cancelada lo que sigue en el móvil');
});

test('cancelar desde el agente sigue adelante aunque Google falle', async () => {
    escribirReservas([RESERVA]);
    gcal.deleteEvent = async () => { throw new Error('Google caído'); };
    const r = await bookings.cancelar(tenant(), 'r1');
    assert.equal(r.estado, 'cancelada');
});

// ─── Días cerrados en Google ───

test('un evento de día completo bloquea el día entero', async () => {
    // busyIntervalsForDate usa el cliente interno de googleapis: se carga una copia
    // nueva del módulo con credenciales falsas y un cliente simulado.
    const googleapis = require('googleapis');
    const clienteReal = googleapis.google.calendar;
    const credencialesPrevias = process.env.GOOGLE_CREDENTIALS_JSON;
    const ruta = require.resolve('../src/integrations/googleCalendar');
    const items = [{ id: 'vac', start: { date: '2026-09-18' }, end: { date: '2026-09-19' } }];
    process.env.GOOGLE_CREDENTIALS_JSON = JSON.stringify({ client_email: 'test@test', private_key: 'x' });
    googleapis.google.calendar = () => ({ events: { list: async () => ({ data: { items } }) } });
    delete require.cache[ruta];
    try {
        const copia = require(ruta);
        assert.deepEqual(await copia.busyIntervalsForDate('cal@test', '18/09/2026', 'Europe/Madrid'), [{ ini: 0, fin: 1440, profesional: null }]);
        assert.deepEqual(await copia.busyIntervalsForDate('cal@test', '19/09/2026', 'Europe/Madrid'), [], 'end.date es exclusivo: el día siguiente queda libre');
    } finally {
        googleapis.google.calendar = clienteReal;
        if (credencialesPrevias === undefined) delete process.env.GOOGLE_CREDENTIALS_JSON; else process.env.GOOGLE_CREDENTIALS_JSON = credencialesPrevias;
        delete require.cache[ruta];
    }
});
