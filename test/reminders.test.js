'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cfg = require('../src/config');
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'studio32-reminder-test-'));
cfg.PATHS.data = isolated;
const tenants = require('../src/tenants');
const meta = require('../src/channels/whatsapp.meta');
const conversations = require('../src/store/conversations');
const db = require('../src/store/_db');
const reminders = require('../src/reminders');
test.after(() => fs.rmSync(isolated, { recursive:true, force:true }));

function setup(t, extra = {}) {
    const id = 'recordatorios-test';
    const when = new Date(Date.now() + 60 * 60000);
    const pad = n => String(n).padStart(2, '0');
    const row = { id:'r1', nombre:'Prueba', estado:'confirmada', fecha:pad(when.getUTCDate())+'/'+pad(when.getUTCMonth()+1)+'/'+when.getUTCFullYear(), hora:pad(when.getUTCHours())+':'+pad(when.getUTCMinutes()), telefono_cliente:'34600000001' };
    const tenant = { id, business:{ nombre:'Prueba', timezone:'UTC', recordatorios:{ enabled:true, provider:'whatsapp_meta', phone_number_id:'test-number' }, ...extra } };
    process.env.META_PHONE_NUMBER_ID = 'test-number';
    t.mock.method(tenants, 'listarTenantIds', () => [id]);
    t.mock.method(tenants, 'cargarTenant', () => tenant);
    t.mock.method(meta, 'configurado', () => true);
    t.mock.method(conversations, 'controlMode', async () => 'agent');
    db.escribir(id, 'bookings.json', [row]);
    return { id, row, tenant };
}

test('horario de recordatorio usa la zona del negocio, no la del servidor', () => {
    const rows = [{ estado:'confirmada', fecha:'15/07/2030', hora:'10:00' }];
    assert.equal(reminders.pendientes(rows, new Date('2030-07-15T07:00:00Z'), 'Europe/Madrid')[0].tipo, '2h');
    assert.equal(reminders.pendientes(rows, new Date('2030-07-15T07:00:00Z'), 'UTC').length, 0);
});

test('rechazo del proveedor no marca enviado y se puede reintentar', async t => {
    const s = setup(t);
    let attempts = 0;
    t.mock.method(meta, 'enviarMensaje', async () => ++attempts > 1);
    await reminders.revisar();
    assert.equal(db.leer(s.id, 'bookings.json', [])[0].recordado_2h, undefined);
    await reminders.revisar();
    assert.ok(db.leer(s.id, 'bookings.json', [])[0].recordado_2h);
    assert.equal(attempts, 2);
});

test('añadir una reserva mientras se envía no se pierde al guardar el recordatorio', async t => {
    const s = setup(t);
    t.mock.method(meta, 'enviarMensaje', async () => { db.escribir(s.id, 'bookings.json', [s.row, { id:'nueva', estado:'confirmada' }]); return true; });
    await reminders.revisar();
    const rows = db.leer(s.id, 'bookings.json', []);
    assert.equal(rows.length, 2); assert.equal(rows[1].id, 'nueva'); assert.ok(rows[0].recordado_2h);
});

test('demos, opt-in ausente y emisor distinto no envían recordatorios', async t => {
    const s = setup(t, { demo:true });
    let sends = 0;
    t.mock.method(meta, 'enviarMensaje', async () => { sends++; return true; });
    await reminders.revisar();
    s.tenant.business.demo = false; s.tenant.business.recordatorios.enabled = false;
    await reminders.revisar();
    s.tenant.business.recordatorios.enabled = true; s.tenant.business.recordatorios.phone_number_id = 'otra-clinica';
    await reminders.revisar();
    assert.equal(sends, 0);
});

test('sesión web con forma de teléfono y conversación humana no reciben recordatorio del agente', async t => {
    const s = setup(t);
    let sends = 0;
    t.mock.method(meta, 'enviarMensaje', async () => { sends++; return true; });
    db.escribir(s.id, 'bookings.json', [{ ...s.row, telefono_cliente:'web:34600000001' }]);
    await reminders.revisar();
    db.escribir(s.id, 'bookings.json', [s.row]);
    t.mock.method(conversations, 'controlMode', async () => 'human');
    await reminders.revisar(); assert.equal(sends, 0);
});
