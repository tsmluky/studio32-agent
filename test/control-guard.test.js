'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const llm = require('../src/llm');
const conversations = require('../src/store/conversations');
const remote = require('../src/store/supabase');
const usage = require('../src/store/usage');
const tools = require('../src/tools');
const { responder } = require('../src/orchestrator');
const { puedeResponder } = require('../src/controlGuard');
const originals = [llm, conversations, remote, usage, tools].map(module => [module, { ...module }]);
test.afterEach(() => { for (const [module, snapshot] of originals) Object.assign(module, snapshot); });

function setup(t, options = {}) {
    const saved = [], calls = [];
    let mode = 'agent';
    const ctx = { tenantId: '__control_test', telefono: 'sesion-sintetica', channel: 'test', tenant: {
        id: '__control_test', business: { nombre: 'Prueba', demo: true }, services: { servicios: [] }, handoff: {}, faq: '', policies: '', tone: ''
    } };
    t.mock.method(conversations, 'claimInbound', async () => ({ accepted: true, persisted: !!options.persisted, controlMode: 'agent' }));
    t.mock.method(conversations, 'controlMode', async () => mode);
    t.mock.method(conversations, 'get', async () => []);
    t.mock.method(conversations, 'push', async (_tenant, _phone, value) => { saved.push(value); if (options.afterPush) options.afterPush(value, setMode); });
    t.mock.method(remote, 'hydrateTenant', async tenant => tenant);
    t.mock.method(usage, 'registrar', async () => {});
    t.mock.method(tools, 'ejecutar', async name => { calls.push(name); return 'OK'; });
    function setMode(value) { mode = value; }
    return { ctx, saved, calls, setMode };
}
function tool(name, id = name) { return { id, function: { name, arguments: '{}' } }; }

test('takeover durante generación impide reserva y conserva el mensaje del usuario una vez', async t => {
    const s = setup(t);
    t.mock.method(llm, 'chat', async () => { s.setMode('human'); return { tool_calls: [tool('createBooking')] }; });
    assert.equal(await responder(s.ctx, 'Reserva para mañana'), null);
    assert.deepEqual(s.calls, []);
    assert.deepEqual(s.saved.map(m => m.role), ['user']);
});

test('takeover durante una herramienta impide ejecutar la siguiente y volver al modelo', async t => {
    const s = setup(t);
    let models = 0;
    t.mock.method(llm, 'chat', async () => { models++; return { tool_calls: [tool('getServices'), tool('createBooking')] }; });
    t.mock.method(tools, 'ejecutar', async name => { s.calls.push(name); s.setMode('human'); return 'OK'; });
    assert.equal(await responder(s.ctx, 'Consulta y reserva'), null);
    assert.deepEqual(s.calls, ['getServices']);
    assert.equal(models, 1);
    assert.deepEqual(s.saved.map(m => m.role), ['user']);
});

test('paused y fallo de lectura nunca autorizan respuesta', async t => {
    const s = setup(t);
    s.setMode('paused');
    t.mock.method(llm, 'chat', async () => { throw new Error('no debe llamarse'); });
    assert.equal(await responder(s.ctx, 'Hola'), null);
    t.mock.method(conversations, 'controlMode', async () => { throw new Error('BD no disponible'); });
    assert.equal(await puedeResponder(s.ctx), false);
});

test('inbound ya persistido no se duplica al detenerse durante el modelo', async t => {
    const s = setup(t, { persisted: true });
    t.mock.method(llm, 'chat', async () => { s.setMode('human'); return { content: 'Respuesta pendiente' }; });
    assert.equal(await responder(s.ctx, 'Hola'), null);
    assert.deepEqual(s.saved, []);
});

test('takeover mientras se persiste el usuario impide guardar respuesta del agente', async t => {
    const s = setup(t, { afterPush: (value, setMode) => { if (value.role === 'user') setMode('human'); } });
    t.mock.method(llm, 'chat', async () => ({ content: 'Hola' }));
    assert.equal(await responder(s.ctx, 'Hola'), null);
    assert.deepEqual(s.saved.map(m => m.role), ['user']);
});

test('handoff termina el turno sin otras herramientas ni promesas del modelo', async t => {
    const s = setup(t);
    t.mock.method(llm, 'chat', async () => ({ tool_calls: [tool('handoffHuman'), tool('createBooking')] }));
    assert.equal(await responder(s.ctx, 'Quiero hablar con recepción'), null);
    assert.deepEqual(s.calls, ['handoffHuman']);
    assert.deepEqual(s.saved.map(m => m.role), ['user']);
});

test('estado de control de Supabase ausente o ilegible es pausa, sin habilitar fallback', async t => {
    t.mock.method(remote, 'enabled', () => true);
    t.mock.method(remote, 'report', () => {});
    t.mock.method(remote, 'conversationForPhone', async () => ({ conversation: {} }));
    assert.equal(await conversations.controlMode('__control_test', 'x'), 'paused');
    t.mock.method(remote, 'conversationForPhone', async () => { throw new Error('falló'); });
    assert.equal(await conversations.controlMode('__control_test', 'x'), 'paused');
});

test('sin control remoto configurado se conserva la simulación local', async t => {
    t.mock.method(remote, 'enabled', () => false);
    assert.equal(await conversations.controlMode('__control_test', 'x'), 'agent');
});
