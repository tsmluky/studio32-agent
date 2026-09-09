'use strict';

// Qué recibe el cliente cuando algo sale mal por dentro.
//
// Estos caminos no se ven en una demo y son los que hacen quedar mal en producción:
// el modelo devuelve vacío, o se queda dando vueltas entre herramientas. Antes los
// tres acababan en la misma frase y sin rastro en el log, así que era imposible saber
// si pasaban una vez al mes o veinte veces al día.

const test = require('node:test');
const assert = require('node:assert');

const llm = require('../src/llm');
const conversations = require('../src/store/conversations');
const usage = require('../src/store/usage');
const remote = require('../src/store/supabase');
const bookings = require('../src/store/bookings');
const { responder } = require('../src/orchestrator');

const TENANT = {
    id: '__test_orq',
    business: { nombre: 'Prueba', agente_nombre: 'Prueba', demo: true, horario: { dias_laborables: [1, 2, 3, 4, 5], franjas: [{ inicio: '09:00', fin: '18:00' }] }, calendar: { timezone: 'Europe/Madrid' } },
    services: { servicios: [{ nombre: 'Primera visita', duracion_min: 30 }] },
    handoff: {}, faq: '', policies: '', tone: ''
};

function ctx() {
    return { tenant: TENANT, tenantId: TENANT.id, telefono: 'sesion-prueba', esOwner: false, channel: 'test' };
}

// Deja el andamiaje en pie: conversación aceptada, agente al mando, nada que
// persistir de verdad y sin Supabase.
function andamio(t) {
    t.mock.method(conversations, 'claimInbound', async () => ({ accepted: true, controlMode: 'agent', persisted: false }));
    t.mock.method(conversations, 'get', async () => []);
    t.mock.method(conversations, 'push', async () => {});
    t.mock.method(usage, 'registrar', async () => {});
    t.mock.method(remote, 'hydrateTenant', async (tenant) => tenant);
    t.mock.method(bookings, 'activasDeCliente', async () => []);
}

test('si el modelo devuelve vacío, el cliente recibe una frase útil, no un hueco', async (t) => {
    andamio(t);
    t.mock.method(llm, 'chat', async () => ({ role: 'assistant', content: '' }));

    const r = await responder(ctx(), 'Hola');
    assert.ok(r && r.trim().length > 0, 'no puede devolver vacío');
    assert.match(r, /repites/i);
    // Y no promete escribir él más tarde, que es lo que no puede cumplir.
    assert.doesNotMatch(r, /te (aviso|escribo|confirmo)/i);
});

test('si se queda dando vueltas entre herramientas, tampoco se queda mudo', async (t) => {
    andamio(t);
    // Siempre pide herramienta: agota el margen de vueltas.
    t.mock.method(llm, 'chat', async () => ({
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'x', function: { name: 'getServices', arguments: '{}' } }]
    }));

    const r = await responder(ctx(), '¿Qué hacéis?');
    assert.ok(r && r.trim().length > 0);
});

test('una respuesta normal sale tal cual', async (t) => {
    andamio(t);
    t.mock.method(llm, 'chat', async () => ({ role: 'assistant', content: 'Buenas, ¿en qué te ayudo?' }));

    assert.equal(await responder(ctx(), 'Hola'), 'Buenas, ¿en qué te ayudo?');
});

test('si la conversación está en manos de una persona, el agente no responde', async (t) => {
    andamio(t);
    t.mock.method(conversations, 'claimInbound', async () => ({ accepted: true, controlMode: 'human', persisted: true }));
    t.mock.method(llm, 'chat', async () => { throw new Error('el modelo no debería llamarse'); });

    assert.equal(await responder(ctx(), 'Hola'), null);
});
