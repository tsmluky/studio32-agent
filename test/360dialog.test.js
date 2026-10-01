'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const cfg = require('../src/config');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'd360-test-'));
const oldData = cfg.PATHS.data;
cfg.PATHS.data = temp;
const tenants = require('../src/tenants');
const conversations = require('../src/store/conversations');
const remote = require('../src/store/supabase');
const orchestrator = require('../src/orchestrator');
const db = require('../src/store/_db');
const channel = require('../src/channels/whatsapp.360dialog');
const tenant = { id: 'clinic_test', business: { whatsapp_number: '+34600000101', channels: { whatsapp_360dialog: { enabled: true } } } };
const auth = 'Basic ' + Buffer.from('test:secret').toString('base64');
const realFetch = global.fetch;
let server, base;
test.before(async () => {
    process.env.D360_API_KEY_CLINIC_TEST = 'synthetic-key';
    process.env.D360_WEBHOOK_AUTH_CLINIC_TEST = auth;
    process.env.D360_PROCESS_INBOUND = 'off';
    const app = express(); app.use(express.json()); app.use('/360', channel.router());
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    cfg.PATHS.data = oldData;
    fs.rmSync(temp, { recursive: true, force: true });
});
function payload(id, { echo = false, type = 'text', number = '34600000101' } = {}) {
    const message = { id, type, from: echo ? number : '34600000999', to: '34600000999', text: { body: 'Hola' } };
    return { entry: [{ changes: [{ field: echo ? 'smb_message_echoes' : 'messages', value: { metadata: { display_phone_number: number }, [echo ? 'message_echoes' : 'messages']: [message] } }] }] };
}
function fixtures(t) {
    t.mock.method(tenants, 'cargarTenant', () => tenant);
    t.mock.method(tenants, 'resolverTenantPorNumero', number => number === '34600000101' ? tenant : null);
}
async function post(data, authorization = auth) {
    return realFetch(base + '/360/clinic_test/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization }, body: JSON.stringify(data) });
}
test('webhook autenticado persiste antes del ACK y deduplica en disco', async t => {
    fixtures(t);
    assert.equal((await post(payload('inbound-1'), 'Basic invalid')).status, 403);
    assert.equal((await post(payload('inbound-1'))).status, 200);
    assert.equal((await post(payload('inbound-1'))).status, 200);
    const entries = Object.values(db.leer(tenant.id, 'd360-inbox.json', {}));
    assert.equal(entries.length, 1); assert.equal(entries[0].state, 'queued');
    assert.equal(entries[0].event.phone, '34600000999');
});
test('rechaza número ajeno y mensajes sin ID antes de guardar', async t => {
    fixtures(t);
    assert.equal((await post(payload('other', { number: '34600000222' }))).status, 403);
    assert.equal((await post(payload(''))).status, 400);
    assert.equal(Object.values(db.leer(tenant.id, 'd360-inbox.json', {})).length, 1);
});
test('parser recorre lotes, separa ecos, estados y conserva audio pendiente', () => {
    const p = payload('batch-1');
    p.entry.push(...payload('echo-1', { echo: true }).entry, ...payload('audio-1', { type: 'audio' }).entry);
    p.entry[0].changes[0].value.statuses = [{ id: 'sent-1', status: 'delivered', timestamp: '123' }];
    const parsed = channel.parseEventos(p);
    assert.deepEqual(parsed.map(e => e.kind), ['inbound', 'status', 'echo', 'inbound']);
    assert.equal(parsed[2].phone, '34600000999'); assert.equal(parsed[3].body, null);
});
test('eco humano toma control antes del ACK; fallo de BD devuelve 503', async t => {
    fixtures(t); const seen = [];
    t.mock.method(conversations, 'humanEcho', async (...args) => { seen.push(args); });
    assert.equal((await post(payload('echo-2', { echo: true }))).status, 200);
    assert.deepEqual(seen[0], [tenant.id, '34600000999', 'Hola', 'echo-2']);
    conversations.humanEcho = async () => { throw new Error('offline'); };
    assert.equal((await post(payload('echo-3', { echo: true }))).status, 503);
});
test('fallo al persistir no confirma recepción y permite reintento del proveedor', async t => {
    fixtures(t); t.mock.method(db, 'escribir', () => { throw new Error('disk full'); });
    assert.equal((await post(payload('disk-full'))).status, 503);
});
test('envío usa clave de esa clínica y exige ID aceptado; nunca credencial global', async t => {
    let sent;
    t.mock.method(global, 'fetch', async (url, options) => { sent = { url, options }; return { ok: true, json: async () => ({ messages: [{ id: 'accepted-id' }] }) }; });
    assert.equal(await channel.enviarMensaje(tenant, '+34600000999', 'Confirmación'), true);
    assert.equal(sent.url, 'https://waba-v2.360dialog.io/messages');
    assert.equal(sent.options.headers['D360-API-KEY'], 'synthetic-key');
    assert.equal(JSON.parse(sent.options.body).recipient_type, 'individual');
    assert.equal(await channel.enviarMensaje({ id: 'another_clinic' }, '34600000999', 'Hola'), false);
    global.fetch = async () => ({ ok: true, json: async () => ({ messages: [{ id: 'held', message_status: 'held_for_quality_assessment' }] }) });
    assert.equal(await channel.enviarMensaje(tenant, '34600000999', 'Hola'), false);
});
test('inbox reanuda queued una sola vez y conserva envíos ambiguos sin repetir herramientas', async t => {
    db.escribir(tenant.id, 'd360-inbox.json', {});
    channel.guardar(tenant.id, channel.parseEventos(payload('worker-1'))[0]);
    let calls = 0;
    t.mock.method(remote, 'enabled', () => true);
    t.mock.method(conversations, 'controlMode', async () => 'agent');
    t.mock.method(orchestrator, 'responder', async () => { calls++; return 'Respuesta'; });
    t.mock.method(global, 'fetch', async () => { throw new Error('timeout'); });
    await Promise.all([channel.procesar(tenant), channel.procesar(tenant)]);
    await channel.procesar(tenant);
    assert.equal(calls, 1);
    assert.equal(Object.values(db.leer(tenant.id, 'd360-inbox.json', {}))[0].state, 'delivery_uncertain');
});
test('toma de control durante respuesta suprime envío y caída previa no se reprocesa', async t => {
    db.escribir(tenant.id, 'd360-inbox.json', { interrupted: { state: 'processing', event: { kind: 'inbound' } } });
    channel.guardar(tenant.id, channel.parseEventos(payload('worker-2'))[0]);
    t.mock.method(remote, 'enabled', () => true);
    t.mock.method(conversations, 'controlMode', async () => 'human');
    let calls = 0;
    t.mock.method(orchestrator, 'responder', async () => { calls++; return 'Respuesta'; });
    t.mock.method(global, 'fetch', async () => { throw new Error('No debe enviar'); });
    await channel.procesar(tenant);
    const entries = Object.values(db.leer(tenant.id, 'd360-inbox.json', {}));
    assert.equal(calls, 1); assert.equal(entries[0].state, 'processing'); assert.equal(entries[1].state, 'suppressed');
});
