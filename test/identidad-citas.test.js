'use strict';

// Quién puede ver y tocar una cita.
//
// `activasDeCliente` es la puerta por la que pasan cancelar y mover. Buscaba por
// teléfono O por contacto, y el `contacto` lo dicta el cliente por chat: bastaba con
// escribir desde cualquier número y decir el teléfono de otra persona para llegar a
// su cita. Aquí se fija que el teléfono del canal manda y que el contacto solo puede
// estrechar la búsqueda.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { PATHS } = require('../src/config');
const bookings = require('../src/store/bookings');

const TENANT = '__test_identidad';

function tenant() {
    return {
        id: TENANT,
        business: { demo: false, calendar: { calendar_id: '', timezone: 'Europe/Madrid' } },
        services: { servicios: [{ nombre: 'Primera visita', duracion_min: 30 }] }
    };
}

const RESERVAS = [
    { id: 'mia', estado: 'confirmada', fecha: '04/08/2026', hora: '10:00', servicio: 'Primera visita', telefono_cliente: '600111111', contacto: '600111111' },
    { id: 'ajena', estado: 'confirmada', fecha: '04/08/2026', hora: '11:00', servicio: 'Primera visita', telefono_cliente: '600222222', contacto: '600222222' },
    { id: 'cancelada', estado: 'cancelada', fecha: '04/08/2026', hora: '12:00', servicio: 'Primera visita', telefono_cliente: '600111111', contacto: '600111111' }
];

test.before(() => {
    const dir = path.join(PATHS.data, TENANT);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bookings.json'), JSON.stringify(RESERVAS, null, 2));
});

test.after(() => fs.rmSync(path.join(PATHS.data, TENANT), { recursive: true, force: true }));

test('desde mi número veo mis citas activas, no las canceladas', async () => {
    const r = await bookings.activasDeCliente(tenant(), { telefono: '600111111' });
    assert.deepEqual(r.map(x => x.id), ['mia']);
});

test('dar el teléfono de otro NO me da acceso a su cita', async () => {
    // El caso del agujero: escribo desde mi número y digo el contacto de otra persona.
    const r = await bookings.activasDeCliente(tenant(), { telefono: '600111111', contacto: '600222222' });
    assert.deepEqual(r.map(x => x.id), [], 'no puede devolver la cita ajena');
});

test('el contacto estrecha, no amplía', async () => {
    const r = await bookings.activasDeCliente(tenant(), { telefono: '600111111', contacto: '600111111' });
    assert.deepEqual(r.map(x => x.id), ['mia']);
});

test('sin ninguna identidad no devuelve nada', async () => {
    // Nunca la agenda entera por descuido de quien llame.
    assert.deepEqual(await bookings.activasDeCliente(tenant(), {}), []);
});

test('con whatsapp: delante, el número se reconoce igual', async () => {
    const r = await bookings.activasDeCliente(tenant(), { telefono: 'whatsapp:600111111' });
    assert.deepEqual(r.map(x => x.id), ['mia']);
});
