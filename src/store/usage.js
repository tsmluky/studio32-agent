'use strict';
// Uso por tenant (para el panel de Studio32): nº de mensajes y último uso.
const db = require('./_db');
const remote = require('./supabase');
const FILE = 'usage.json';
async function registrar(tenantId) {
    const u = db.leer(tenantId, FILE, { mensajes: 0, ultimo: null });
    u.mensajes = (u.mensajes || 0) + 1;
    u.ultimo = new Date().toISOString();
    db.escribir(tenantId, FILE, u);
}
async function leer(tenantId) {
    if (remote.enabled()) {
        try {
            const organization = await remote.organizationForTenant(tenantId);
            const result = await remote.getClient().from('messages').select('occurred_at', { count: 'exact' }).eq('organization_id', organization.id).eq('direction', 'inbound').order('occurred_at', { ascending: false }).limit(1);
            if (result.error) throw result.error;
            return { mensajes: result.count || 0, ultimo: result.data?.[0]?.occurred_at || null };
        } catch (error) { remote.report(error, 'read usage; using JSON'); }
    }
    return db.leer(tenantId, FILE, { mensajes: 0, ultimo: null });
}
module.exports = { registrar, leer };
