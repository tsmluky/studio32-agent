'use strict';

// Replays legacy JSON bookings into the canonical appointment table. Safe to
// run repeatedly: mirrorAppointment keys every record by metadata.legacy_id.
require('dotenv').config();
const { cargarTenant } = require('../src/tenants');
const bookings = require('../src/store/bookings');
const remote = require('../src/store/supabase');

async function main() {
    const tenantId = process.argv[2] || process.env.DEFAULT_TENANT;
    if (!tenantId) throw new Error('Usage: node scripts/sync-bookings-to-supabase.js <tenant-id>');
    if (!remote.enabled()) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
    const tenant = cargarTenant(tenantId);
    const rows = await bookings.listar(tenantId);
    for (const booking of rows) await bookings.mirrorAppointment(tenant, booking);
    console.log(JSON.stringify({ tenant: tenantId, synchronized: rows.length }));
}

main().catch(error => { console.error(error.message || error); process.exitCode = 1; });
