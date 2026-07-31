'use strict';

// Comprueba las dos garantías de los tenants de demostración:
//   1. La agenda va por sesión: las reservas de un visitante no bloquean huecos
//      a otro. Y que eso NO ocurre en tenants normales (regresión: un cliente
//      real debe seguir viendo su agenda completa).
//   2. Los límites de uso cortan cuando toca y se contabilizan los rechazos.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { PATHS } = require('../src/config');
const bookings = require('../src/store/bookings');
const demoLimits = require('../src/store/demoLimits');

const TENANT_DEMO = '__test_demo';
const TENANT_REAL = '__test_real';

function tenant(id, demo) {
    return {
        id,
        business: { demo, calendar: { calendar_id: '', timezone: 'Europe/Madrid' } },
        services: { servicios: [{ nombre: 'Primera visita', duracion_min: 30 }] }
    };
}

function sembrar(id, reservas) {
    const dir = path.join(PATHS.data, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bookings.json'), JSON.stringify(reservas, null, 2));
}

function limpiar(id) {
    fs.rmSync(path.join(PATHS.data, id), { recursive: true, force: true });
}

const RESERVAS = [
    { id: 'a', estado: 'confirmada', fecha: '04/08/2026', hora: '10:00', servicio: 'Primera visita', telefono_cliente: 'landing-aaa', creada: new Date().toISOString() },
    { id: 'b', estado: 'confirmada', fecha: '04/08/2026', hora: '12:00', servicio: 'Primera visita', telefono_cliente: 'landing-bbb', creada: new Date().toISOString() }
];

test('demo: cada sesión solo ve sus propias reservas', async (t) => {
    t.after(() => limpiar(TENANT_DEMO));
    sembrar(TENANT_DEMO, RESERVAS);

    const deA = await bookings.busyIntervals(tenant(TENANT_DEMO, true), '04/08/2026', { sesion: 'landing-aaa' });
    assert.strictEqual(deA.length, 1, 'la sesión aaa debe ver solo su reserva');
    assert.strictEqual(deA[0].ini, 600, 'y debe ser la de las 10:00');

    // El hueco que ocupó OTRO visitante tiene que seguir libre para este.
    const libre = await bookings.huecoLibre(tenant(TENANT_DEMO, true), '04/08/2026', '12:00', 30, null, { sesion: 'landing-aaa' });
    assert.strictEqual(libre, true, 'la reserva de bbb no debe bloquear a aaa');
});

test('tenant real: sigue viendo la agenda completa (no hay regresión)', async (t) => {
    t.after(() => limpiar(TENANT_REAL));
    sembrar(TENANT_REAL, RESERVAS);

    const todas = await bookings.busyIntervals(tenant(TENANT_REAL, false), '04/08/2026', { sesion: 'landing-aaa' });
    assert.strictEqual(todas.length, 2, 'un cliente real ve TODAS las reservas del día');

    const libre = await bookings.huecoLibre(tenant(TENANT_REAL, false), '04/08/2026', '12:00', 30, null, { sesion: 'landing-aaa' });
    assert.strictEqual(libre, false, 'y un hueco ocupado sigue ocupado');
});

test('demo: la purga respeta las reservas recientes', async (t) => {
    t.after(() => limpiar(TENANT_DEMO));
    const viejaISO = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    sembrar(TENANT_DEMO, [...RESERVAS, { ...RESERVAS[0], id: 'vieja', creada: viejaISO }]);

    const borradas = await bookings.purgarDemo(tenant(TENANT_DEMO, true), 48);
    assert.strictEqual(borradas, 1, 'solo se borra la de hace 72 h');
    assert.strictEqual((await bookings.listar(TENANT_DEMO)).length, 2);
});

test('demo: la purga no toca tenants reales', async (t) => {
    t.after(() => limpiar(TENANT_REAL));
    const viejaISO = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    sembrar(TENANT_REAL, [{ ...RESERVAS[0], id: 'vieja', creada: viejaISO }]);

    assert.strictEqual(await bookings.purgarDemo(tenant(TENANT_REAL, false), 48), 0);
    assert.strictEqual((await bookings.listar(TENANT_REAL)).length, 1);
});

test('límites: corta al llegar al tope por sesión', (t) => {
    t.after(() => limpiar(TENANT_DEMO));

    let ultimo = null;
    for (let i = 0; i < demoLimits.MAX_MENSAJES_SESION; i++) {
        ultimo = demoLimits.registrar(TENANT_DEMO, { sesion: 'landing-tope', ip: '1.2.3.4' });
    }
    assert.strictEqual(ultimo.ok, true, 'los mensajes dentro del tope pasan');

    const cortado = demoLimits.registrar(TENANT_DEMO, { sesion: 'landing-tope', ip: '1.2.3.4' });
    assert.strictEqual(cortado.ok, false);
    assert.strictEqual(cortado.motivo, 'sesion');
    assert.match(cortado.respuesta, /demostración/i);
});

test('límites: no se guarda la IP en claro', (t) => {
    t.after(() => limpiar(TENANT_DEMO));

    demoLimits.registrar(TENANT_DEMO, { sesion: 'landing-priv', ip: '203.0.113.77' });
    const crudo = fs.readFileSync(path.join(PATHS.data, TENANT_DEMO, 'demo-limits.json'), 'utf8');
    assert.ok(!crudo.includes('203.0.113.77'), 'la IP no puede aparecer en el fichero');
});
