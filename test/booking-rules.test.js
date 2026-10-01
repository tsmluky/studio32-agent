'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../src/bookingRules');
const bookings = require('../src/store/bookings');
const create = require('../src/tools/createBooking');
const availability = require('../src/tools/checkAvailability');
const reschedule = require('../src/tools/rescheduleBooking');

function contexto() {
    return { tenantId: '__rules', telefono: 'sesion-sintetica', tenant: {
        id: '__rules', business: { demo: true, profesionales: ['Ana'], horario: {
            dias_laborables: [1, 2, 3, 4, 5], franjas: [{ inicio: '09:00', fin: '19:00' }],
            franjas_por_dia: { 5: [{ inicio: '09:00', fin: '13:00' }] }
        } }, services: { servicios: [{ nombre: 'Revisión', duracion_min: 30 }, { nombre: 'Retirado', duracion_min: 30, activo: false }] }
    } };
}

test('rechaza fechas normalizadas por JavaScript y horas fuera de rango', () => {
    for (const fecha of ['30/02/2030', '31/04/2030', '2030-10-04', null]) assert.ok(Number.isNaN(rules.parsearFecha(fecha).getTime()));
    assert.equal(rules.parsearFecha('29/02/2032').getDate(), 29);
    for (const hora of ['25:00', '12:99', '9:00', null]) assert.ok(Number.isNaN(rules.horaAMin(hora)));
});

test('consulta, alta y cambio respetan el viernes reducido y no escriben fuera de horario', async (t) => {
    const ctx = contexto();
    t.mock.method(bookings, 'busyIntervals', async () => []);
    t.mock.method(bookings, 'activasDeCliente', async () => [{ id: 'cita', servicio: 'Revisión', duracion_min: 30 }]);
    t.mock.method(bookings, 'huecoLibre', async () => { throw new Error('no debe comprobar ni escribir'); });
    const huecos = JSON.parse(await availability.run({ fecha: '04/10/2030', servicio: 'Revisión' }, ctx));
    assert.ok(huecos.huecos.Ana.includes('12:30'));
    assert.ok(!huecos.huecos.Ana.includes('16:00'));
    assert.match(await create.run({ nombre: 'Prueba', contacto: '600000000', servicio: 'Revisión', fecha: '04/10/2030', hora: '16:00' }, ctx), /^FUERA_HORARIO/);
    assert.match(await reschedule.run({ nueva_fecha: '04/10/2030', nueva_hora: '16:00' }, ctx), /^FUERA_HORARIO/);
});

test('el alta rechaza servicios inactivos, profesionales desconocidos y fechas imposibles', async () => {
    const ctx = contexto();
    const base = { nombre: 'Prueba', contacto: '600000000', servicio: 'Revisión', fecha: '04/10/2030', hora: '10:00' };
    assert.match(await create.run({ ...base, servicio: 'Retirado' }, ctx), /^ERROR/);
    assert.match(await create.run({ ...base, servicio: 'Inventado' }, ctx), /^ERROR/);
    assert.match(await create.run({ ...base, profesional: 'Inventado' }, ctx), /^ERROR/);
    assert.match(await create.run({ ...base, fecha: '30/02/2030' }, ctx), /^ERROR/);
    assert.match(await create.run({ ...base, hora: '25:00' }, ctx), /^ERROR/);
});

test('un día con franjas vacías no hereda el horario general', async () => {
    const ctx = contexto();
    ctx.tenant.business.horario.franjas_por_dia[5] = [];
    assert.match(await create.run({ nombre: 'Prueba', contacto: '600000000', servicio: 'Revisión', fecha: '04/10/2030', hora: '10:00' }, ctx), /^FUERA_HORARIO/);
});
