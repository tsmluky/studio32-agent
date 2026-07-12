'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const remote = require('../src/store/supabase');

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function readText(file) {
    try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; }
}
function slug(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function importTenant(tenantId) {
    const dir = path.join(__dirname, '..', 'tenants', tenantId);
    if (!fs.existsSync(dir)) throw new Error(`Tenant not found: ${tenantId}`);

    const business = readJson(path.join(dir, 'business.json'), {});
    const servicesFile = readJson(path.join(dir, 'services.json'), { servicios: [] });
    const handoff = readJson(path.join(dir, 'handoff.json'), {});
    const faq = readText(path.join(dir, 'faq.md'));
    const policies = readText(path.join(dir, 'policies.md'));
    const tone = readText(path.join(dir, 'tone.md'));
    const organization = await remote.organizationForTenant(tenantId);
    const db = remote.getClient();

    const orgUpdate = await db.from('organizations').update({
        name: business.nombre || tenantId,
        status: business._estado === 'borrador' ? 'draft' : 'active',
        timezone: business.calendar?.timezone || 'Europe/Madrid',
        metadata: { city: business.ciudad || null, web: business.web || null }
    }).eq('id', organization.id);
    if (orgUpdate.error) throw orgUpdate.error;

    for (const service of servicesFile.servicios || []) {
        const externalKey = slug(service.id || service.nombre);
        const existing = await db.from('services').select('id').eq('organization_id', organization.id).eq('external_key', externalKey).maybeSingle();
        if (existing.error) throw existing.error;
        const values = {
            organization_id: organization.id,
            external_key: externalKey,
            name: service.nombre,
            description: service.descripcion || null,
            duration_minutes: service.duracion_min || null,
            price_amount: service.precio_eur ?? null,
            currency: 'EUR',
            settings: service
        };
        const result = existing.data
            ? await db.from('services').update(values).eq('id', existing.data.id)
            : await db.from('services').insert(values);
        if (result.error) throw result.error;
    }

    const config = await db.from('agent_configs').select('id').eq('organization_id', organization.id).eq('version', 1).maybeSingle();
    if (config.error) throw config.error;
    const configValues = {
        organization_id: organization.id,
        version: 1,
        status: 'active',
        business,
        services_snapshot: servicesFile.servicios || [],
        faq,
        policies,
        tone,
        handoff_config: handoff,
        activated_at: new Date().toISOString()
    };
    const saved = config.data
        ? await db.from('agent_configs').update(configValues).eq('id', config.data.id)
        : await db.from('agent_configs').insert(configValues);
    if (saved.error) throw saved.error;

    console.log(`Imported ${tenantId}: ${(servicesFile.servicios || []).length} services`);
}

async function main() {
    if (!remote.enabled()) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    const tenants = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
    if (!tenants.length) throw new Error('Pass one or more tenant IDs explicitly');
    for (const tenantId of tenants) await importTenant(tenantId);
}

main().catch(error => { console.error(error.message || error); process.exit(1); });
