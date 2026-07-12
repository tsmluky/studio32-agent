'use strict';

// Log de eventos por tenant (handoffs, errores de negocio, etc.). Persistente.

const db = require('./_db');
const remote = require('./supabase');
const FILE = 'logs.json';

async function registrar(tenantId, tipo, datos) {
    const all = db.leer(tenantId, FILE, []);
    all.push({ ts: new Date().toISOString(), tipo, ...datos });
    db.escribir(tenantId, FILE, all);
    if (remote.enabled()) {
        try {
            const organization = await remote.organizationForTenant(tenantId);
            let conversation = null;
            if (datos.telefono) conversation = (await remote.conversationForPhone(tenantId, datos.telefono)).conversation;
            if (tipo === 'handoff' && conversation) {
                const handoff = await remote.getClient().from('handoffs').insert({
                    organization_id: organization.id,
                    conversation_id: conversation.id,
                    requested_by: 'agent',
                    reason: datos.motivo || 'Derivación solicitada',
                    summary: datos.resumen || null
                });
                if (handoff.error) throw handoff.error;
                const takeover = await remote.getClient().from('conversations').update({ control_mode: 'human', agent_paused_at: new Date().toISOString() }).eq('id', conversation.id);
                if (takeover.error) throw takeover.error;
            }
            const audit = await remote.getClient().from('audit_logs').insert({ organization_id: organization.id, actor_type: 'agent', action: tipo, entity_type: conversation ? 'conversation' : null, entity_id: conversation ? conversation.id : null, data: datos });
            if (audit.error) throw audit.error;
        } catch (error) { remote.report(error, 'write event; JSON retained'); }
    }
}
async function listar(tenantId) {
    return db.leer(tenantId, FILE, []);
}

module.exports = { registrar, listar };
