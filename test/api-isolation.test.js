'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cfg = require('../src/config');
const remote = require('../src/store/supabase');
const { createRouter } = require('../src/api/router');
const networkFetch = global.fetch;
const originalRemote = { ...remote };
let server, base, tables;
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'studio32-isolation-test-'));
cfg.PATHS.data = isolated;
cfg.PATHS.tenants = path.join(isolated, 'tenants');
const slugA = '__api_isolation_a';
fs.mkdirSync(path.join(cfg.PATHS.tenants, slugA), { recursive:true });
fs.writeFileSync(path.join(cfg.PATHS.tenants, slugA, 'business.json'), JSON.stringify({ demo:true, channels: { whatsapp_360dialog: { enabled: true } } }));

// Simula únicamente Supabase, con dos sesiones verificadas por su endpoint Auth.
// No prueba las políticas RLS desplegadas ni utiliza JWT/cuentas reales.
function query(table) {
    let filters = [], write = null, single = false;
    const chain = {
        select() { return this; }, order() { return this; }, limit() { return this; },
        eq(key, value) { filters.push(row => row[key] === value); return this; },
        in(key, values) { filters.push(row => values.includes(row[key])); return this; },
        contains(key, values) { filters.push(row => Object.entries(values).every(([k,v]) => row[key]?.[k] === v)); return this; },
        update(value) { write = { update: value }; return this; },
        insert(value) { write = { insert: value }; return this; },
        single() { single = true; return this; }, maybeSingle() { single = true; return this; },
        then(resolve, reject) {
            try {
                let rows = tables[table].filter(row => filters.every(filter => filter(row)));
                if (write?.update) for (const row of rows) Object.assign(row, write.update);
                if (write?.insert) {
                    const row = { id: `synthetic-${tables[table].length}`, ...write.insert };
                    tables[table].push(row); rows = [row];
                }
                return Promise.resolve({ error: null, data: structuredClone(single ? rows[0] || null : rows) }).then(resolve, reject);
            } catch (error) { return Promise.reject(error).then(resolve, reject); }
        }
    };
    return chain;
}

test.before(async () => {
    remote.enabled = () => true;
    remote.getClient = () => ({ from: query });
    remote.hydrateTenant = async tenant => tenant;
    remote.organizationForTenant = async slug => structuredClone(tables.organizations.find(row => row.slug === slug));
    const app = express(); app.use(express.json()); app.use('/api', createRouter());
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    global.fetch = async (url, options) => {
        if (String(url).endsWith('/auth/v1/user')) {
            const token = options.headers.Authorization;
            const id = { 'Bearer session-A':'user-A', 'Bearer session-B':'user-B', 'Bearer session-reader':'reader' }[token];
            return { ok: !!id, json: async () => ({ id, email: id + '@example.test' }) };
        }
        throw new Error('Red externa bloqueada en prueba de aislamiento');
    };
});
test.beforeEach(() => {
    tables = {
        organization_members: [{ user_id:'user-A', organization_id:'org-A', role:'owner' }, { user_id:'user-B', organization_id:'org-B', role:'operator' }, { user_id:'reader', organization_id:'org-A', role:'viewer' }],
        conversations: [{ id:'conv-A', organization_id:'org-A', contact_id:'contact-A', control_mode:'agent' }, { id:'conv-B', organization_id:'org-B', contact_id:'contact-B', control_mode:'agent' }],
        contacts: [{ id:'contact-A', organization_id:'org-A', name:'Paciente A' }, { id:'contact-B', organization_id:'org-B', name:'Paciente B' }],
        appointments: [{ id:'appointment-B', organization_id:'org-B', status:'confirmed' }],
        organizations: [{ id:'org-A', slug:slugA }, { id:'org-B', slug:'__api_isolation_b' }],
        messages: [], handoffs: [], audit_logs: []
    };
});
test.after(async () => {
    global.fetch = networkFetch; Object.assign(remote, originalRemote);
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(isolated, { recursive:true, force:true });
});
function request(token, route, method = 'GET', body = {}) {
    return networkFetch(base + '/api' + route, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type':'application/json' }, ...(method === 'GET' ? {} : { body:JSON.stringify(body) }) });
}

test('dos sesiones simultáneas reciben únicamente su organización y contactos', async () => {
    const [a, b] = await Promise.all([request('session-A', '/inbox?organization_id=org-A'), request('session-B', '/inbox?organization_id=org-B')]);
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.deepEqual((await a.json()).conversations.map(row => row.contact.name), ['Paciente A']);
    assert.deepEqual((await b.json()).conversations.map(row => row.contact.name), ['Paciente B']);
    assert.equal((await request('session-A', '/inbox?organization_id=org-B')).status, 403);
    assert.equal((await request('session-B', '/inbox?organization_id=org-A')).status, 403);
});

test('respuesta humana 360dialog usa el slug de la organización autorizada', async t => {
    tables.conversations[0].control_mode = 'human';
    tables.contacts[0].phone = '34600000999';
    const sent = [];
    t.mock.method(require('../src/channels/whatsapp.360dialog'), 'enviarMensaje', async (tenant, phone, body) => { sent.push({ tenantId: tenant.id, phone, body }); return true; });
    const response = await request('session-A', '/conversations/conv-A/messages', 'POST', { channel:'whatsapp_360dialog', body:'Respuesta recepción' });
    assert.equal(response.status, 201);
    assert.deepEqual(sent, [{ tenantId:slugA, phone:'34600000999', body:'Respuesta recepción' }]);
    assert.equal((await request('session-B', '/conversations/conv-A/messages', 'POST', { channel:'whatsapp_360dialog', body:'Otra clínica' })).status, 403);
    assert.equal(sent.length, 1);
});

test('adivinar IDs no permite tomar, liberar, enviar ni cancelar recursos de otra clínica', async () => {
    const original = structuredClone(tables);
    for (const action of ['takeover','release','resolve','messages']) {
        assert.equal((await request('session-A', '/conversations/conv-B/' + action, 'POST', { body:'Hola' })).status, 403);
    }
    assert.equal((await request('session-A', '/appointments/appointment-B/cancel', 'POST')).status, 403);
    assert.deepEqual(tables, original);
});

test('resolver no libera al agente; release explícito sí, y viewer no controla', async () => {
    assert.equal((await request('session-reader', '/conversations/conv-A/takeover', 'POST')).status, 403);
    assert.equal((await request('session-A', '/conversations/conv-A/takeover', 'POST')).status, 200);
    assert.equal(tables.conversations[0].control_mode, 'human');
    assert.equal((await request('session-A', '/conversations/conv-A/resolve', 'POST')).status, 200);
    assert.equal(tables.conversations[0].control_mode, 'human');
    assert.equal((await request('session-A', '/conversations/conv-A/release', 'POST')).status, 200);
    assert.equal(tables.conversations[0].control_mode, 'agent');
    assert.equal(tables.conversations[1].control_mode, 'agent');
});

test('cancelar desde panel sin Calendar también cancela la copia operativa JSON', async () => {
    const reserva = { id:'legacy-A', estado:'confirmada', fecha:'04/10/2030', hora:'10:00', servicio:'Revisión' };
    const dir = path.join(isolated, slugA);
    fs.mkdirSync(dir, { recursive:true });
    fs.writeFileSync(path.join(dir, 'bookings.json'), JSON.stringify([reserva]));
    tables.appointments.push({ id:'appointment-A', organization_id:'org-A', status:'confirmed', metadata:{ legacy_id:'legacy-A' } });
    const response = await request('session-A', '/appointments/appointment-A/cancel', 'POST');
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'bookings.json')))[0].estado, 'cancelada');
    assert.equal(tables.appointments.find(row => row.id === 'appointment-A').status, 'cancelled');
});
