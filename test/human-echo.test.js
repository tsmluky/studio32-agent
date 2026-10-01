'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const remote = require('../src/store/supabase');
const db = require('../src/store/_db');
const conversations = require('../src/store/conversations');
function fixture(t, { duplicate = false, failPause = false } = {}) {
    const writes = [], files = [];
    t.mock.method(remote, 'enabled', () => true);
    t.mock.method(db, 'leer', () => ({}));
    t.mock.method(db, 'escribir', (...args) => files.push(args));
    t.mock.method(remote, 'conversationForPhone', async () => ({ organization: { id: 'org-a' }, conversation: { id: 'conv-a' }, db: { from(table) {
        let operation = 'read';
        return { select() { return this; }, eq() { return this; }, limit() { return this; },
            maybeSingle: async () => ({ data: duplicate ? { id: 'existing' } : null }),
            update(data) { writes.push({ table, data }); operation = 'pause'; return this; },
            insert(data) { writes.push({ table, data }); operation = 'insert'; return this; },
            then(resolve, reject) { return Promise.resolve({ error: failPause && operation === 'pause' ? new Error('DB offline') : null }).then(resolve, reject); }
        };
    } } }));
    return { writes, files };
}
test('eco pausa antes de registrar respuesta humana y conserva identidad del proveedor', async t => {
    const { writes, files } = fixture(t);
    assert.equal(await conversations.humanEcho('tenant-a', '34600000999', 'Yo me ocupo', 'echo-id'), true);
    assert.equal(writes[0].table, 'conversations'); assert.equal(writes[0].data.control_mode, 'human');
    assert.equal(writes[1].data.sender_type, 'human'); assert.equal(writes[1].data.provider_message_id, 'echo-id');
    assert.equal(writes[1].data.payload.provider, 'whatsapp_360dialog');
    assert.equal(files[0][2]['34600000999'][0].role, 'assistant');
});
test('eco duplicado después de release no vuelve a pausar ni añade mensaje', async t => {
    const { writes, files } = fixture(t, { duplicate: true });
    assert.equal(await conversations.humanEcho('tenant-a', '34600000999', 'Texto', 'old-echo'), false);
    assert.equal(writes.length, 0); assert.equal(files.length, 0);
});
test('fallo al pausar no registra mensaje ni permite confirmar el eco', async t => {
    const { writes, files } = fixture(t, { failPause: true });
    await assert.rejects(conversations.humanEcho('tenant-a', '34600000999', 'Texto', 'echo-fail'), /DB offline/);
    assert.equal(writes.length, 1); assert.equal(files.length, 0);
});
test('coexistencia sin base de control no se activa', async t => {
    t.mock.method(remote, 'enabled', () => false);
    await assert.rejects(conversations.humanEcho('tenant-a', '34600000999', 'Texto', 'echo'), /persistencia de control/);
});
