'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const remote = require('../src/store/supabase');
const { zonedDateTimeToIso } = require('../src/store/bookings');
const { parseEntrante } = require('../src/channels/whatsapp.meta');

test('Supabase stays disabled until both server variables exist', () => {
    const previousUrl = process.env.SUPABASE_URL;
    const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal(remote.enabled(), false);
    if (previousUrl) process.env.SUPABASE_URL = previousUrl;
    if (previousKey) process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
});

test('normalizes WhatsApp addresses for stable contact identity', () => {
    assert.equal(remote.normalizedPhone('whatsapp:+34600111222'), '+34600111222');
    assert.equal(remote.normalizedPhone('  web-session-42 '), 'web-session-42');
});

test('converts Madrid appointments to UTC across daylight saving time', () => {
    assert.equal(zonedDateTimeToIso('2026-01-15', '10:00', 'Europe/Madrid'), '2026-01-15T09:00:00.000Z');
    assert.equal(zonedDateTimeToIso('2026-07-15', '10:00', 'Europe/Madrid'), '2026-07-15T08:00:00.000Z');
    assert.equal(zonedDateTimeToIso('15/07/2026', '10:00', 'Europe/Madrid'), '2026-07-15T08:00:00.000Z');
});

test('preserves Meta message IDs for webhook idempotency', () => {
    const parsed = parseEntrante({ entry: [{ changes: [{ value: {
        metadata: { display_phone_number: '+34600000000' },
        messages: [{ id: 'wamid.test-123', from: '34611111111', type: 'text', text: { body: 'Hola' } }]
    } }] }] });
    assert.deepEqual(parsed, { id: 'wamid.test-123', from: '34611111111', body: 'Hola', displayNumber: '+34600000000' });
});

test('maps database services into the runtime tenant used by the next reply', () => {
    const tenant = { business: { nombre: 'Clínica' }, services: { servicios: [] }, faq: 'Anterior', policies: '', tone: '', handoff: {} };
    const hydrated = remote.mergeRuntimeTenant(tenant, [{
        id: 'service-1', external_key: 'revision', name: 'Revisión dental', description: 'Valoración completa',
        duration_minutes: 30, price_amount: '45.00', active: true, settings: { reservable: true, precio_eur: null }
    }], { faq: 'Actualizada', tone: 'Claro y cercano', business: { ciudad: 'Valencia' }, handoff_config: { email: 'recepcion@example.test' } });
    assert.equal(hydrated.services.servicios[0].nombre, 'Revisión dental');
    assert.equal(hydrated.services.servicios[0].precio_eur, 45);
    assert.equal(hydrated.services.servicios[0].reservable, true);
    assert.equal(hydrated.faq, 'Actualizada');
    assert.equal(hydrated.business.ciudad, 'Valencia');
});
