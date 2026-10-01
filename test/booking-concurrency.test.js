'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cfg = require('../src/config');
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'studio32-lock-test-'));
cfg.PATHS.data = isolated;
const remote = require('../src/store/supabase');
remote.enabled = () => false;
require('../src/notify').notificarReserva = async () => {};
const create = require('../src/tools/createBooking');
const bookings = require('../src/store/bookings');
const db = require('../src/store/_db');
const { serializar, proteger } = require('../src/bookingLock');
test.after(() => fs.rmSync(isolated, { recursive:true, force:true }));

test('dos altas simultáneas del mismo hueco solo crean una cita en un proceso', async () => {
    const tenant = { id:'concurrencia', business:{ demo:false, horario:{ dias_laborables:[1,2,3,4,5], franjas:[{ inicio:'09:00', fin:'13:00' }] } }, services:{ servicios:[{ nombre:'Revisión', duracion_min:30 }] } };
    const args = { nombre:'Prueba', contacto:'600000001', servicio:'Revisión', fecha:'04/10/2030', hora:'10:00' };
    const results = await Promise.all([
        create.run(args, { tenant, tenantId:tenant.id, telefono:'600000001' }),
        create.run({ ...args, contacto:'600000002' }, { tenant, tenantId:tenant.id, telefono:'600000002' })
    ]);
    assert.equal(results.filter(r => r.startsWith('OK:')).length, 1);
    assert.equal(results.filter(r => r.startsWith('OCUPADO:')).length, 1);
    assert.equal((await bookings.listar(tenant.id)).length, 1);
});

test('un fallo libera el lock y la operación siguiente puede continuar', async () => {
    await assert.rejects(serializar('fallo', async () => { throw new Error('fallo sintético'); }), /sintético/);
    assert.equal(await serializar('fallo', async () => 'continúa'), 'continúa');
});

test('locks anidados no bloquean y diferentes clínicas avanzan independientemente', async () => {
    assert.equal(await serializar('anidado', () => serializar('anidado', async () => 'OK')), 'OK');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const a = serializar('clinica-A', () => gate);
    try { assert.equal(await serializar('clinica-B', async () => 'B'), 'B'); }
    finally { release(); await a; }
});

test('una herramienta en cola comprueba el control tras conseguir el lock', async () => {
    let release, calls = 0, agent = true;
    const gate = new Promise(resolve => { release = resolve; });
    const first = serializar('en-cola', () => gate);
    const second = proteger(async () => { calls++; return 'OK'; })({}, { tenantId:'en-cola', puedeActuar:async () => agent });
    agent = false; release(); await first;
    assert.match(await second, /^ERROR/); assert.equal(calls, 0);
});

test('JSON corrupto no se presenta como agenda vacía y rutas externas se rechazan', () => {
    db.escribir('corrupto', 'bookings.json', []);
    fs.writeFileSync(path.join(isolated, 'corrupto', 'bookings.json'), '{roto');
    assert.throws(() => db.leer('corrupto', 'bookings.json', []), SyntaxError);
    assert.throws(() => db.leer('../fuera', 'bookings.json', []), /no válida/);
});

test('un hijo asíncrono tardío no hereda el lock ya liberado', async () => {
    let launch, release, child, entered = false;
    const delayed = new Promise(resolve => { launch = resolve; });
    await serializar('late-child', async () => { child = delayed.then(() => serializar('late-child', () => { entered = true; })); });
    const second = serializar('late-child', () => new Promise(resolve => { release = resolve; }));
    await new Promise(resolve => setImmediate(resolve));
    launch(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(entered, false);
    release(); await second; await child;
    assert.equal(entered, true);
});

test('fallo al reemplazar conserva el archivo original y limpia solo su temporal', t => {
    db.escribir('atomico', 'bookings.json', [{ id:'existente' }]);
    t.mock.method(fs, 'renameSync', () => { throw new Error('disco bloqueado'); });
    assert.throws(() => db.escribir('atomico', 'bookings.json', [{ id:'nuevo' }]), /bloqueado/);
    assert.deepEqual(db.leer('atomico', 'bookings.json', []), [{ id:'existente' }]);
    assert.deepEqual(fs.readdirSync(path.join(isolated, 'atomico')), ['bookings.json']);
});
