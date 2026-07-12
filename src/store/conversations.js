'use strict';

// Historial de conversación PERSISTENTE por tenant + teléfono (formato OpenAI).
// A diferencia de los prototipos (Map en memoria), sobrevive a reinicios.

const db = require('./_db');
const remote = require('./supabase');
const FILE = 'conversations.json';
const MAX_HISTORIAL = 20;

function appendJson(tenantId, telefono, mensaje) {
    const all = db.leer(tenantId, FILE, {});
    const h = all[telefono] || [];
    h.push(mensaje);
    if (h.length > MAX_HISTORIAL) h.splice(0, h.length - MAX_HISTORIAL);
    all[telefono] = h;
    db.escribir(tenantId, FILE, all);
    return h;
}

async function claimInbound(tenantId, telefono, mensaje, providerMessageId, provider) {
    if (!providerMessageId || !remote.enabled()) return { accepted: true, persisted: false };
    try {
        const ctx = await remote.conversationForPhone(tenantId, telefono, { contactAttributes: { source: provider || 'agent' } });
        const now = new Date().toISOString();
        const result = await ctx.db.from('messages').insert({
            organization_id: ctx.organization.id,
            conversation_id: ctx.conversation.id,
            provider_message_id: providerMessageId,
            direction: 'inbound',
            sender_type: 'contact',
            body: mensaje,
            payload: { provider: provider || null },
            occurred_at: now
        });
        if (result.error) {
            if (result.error.code === '23505') return { accepted: false, persisted: true, controlMode: ctx.conversation.control_mode };
            throw result.error;
        }
        appendJson(tenantId, telefono, { role: 'user', content: mensaje });
        const updated = await ctx.db.from('conversations').update({ last_message_at: now }).eq('id', ctx.conversation.id);
        if (updated.error) remote.report(updated.error, 'update inbound conversation timestamp');
        return { accepted: true, persisted: true, controlMode: ctx.conversation.control_mode };
    } catch (error) {
        remote.report(error, 'claim inbound webhook; processing with JSON fallback');
        return { accepted: true, persisted: false };
    }
}

async function controlMode(tenantId, telefono) {
    if (!remote.enabled()) return 'agent';
    try {
        const ctx = await remote.conversationForPhone(tenantId, telefono);
        return ctx.conversation.control_mode || 'agent';
    } catch (error) {
        remote.report(error, 'read conversation control mode');
        return 'agent';
    }
}

async function get(tenantId, telefono) {
    if (remote.enabled()) {
        try {
            const ctx = await remote.conversationForPhone(tenantId, telefono);
            const result = await ctx.db.from('messages')
                .select('sender_type, body, occurred_at')
                .eq('conversation_id', ctx.conversation.id)
                .in('sender_type', ['contact', 'agent'])
                .order('occurred_at', { ascending: false })
                .limit(MAX_HISTORIAL);
            if (result.error) throw result.error;
            return (result.data || []).reverse().map(row => ({
                role: row.sender_type === 'contact' ? 'user' : 'assistant',
                content: row.body
            })).filter(m => typeof m.content === 'string' && m.content);
        } catch (error) { remote.report(error, 'read conversation; using JSON'); }
    }
    const all = db.leer(tenantId, FILE, {});
    const h = all[telefono] || [];
    // Solo turnos limpios (user/assistant de texto). Filtra restos antiguos de
    // tool_calls/tool para no romper la validación del modelo.
    return h.filter(m => m && (
        (m.role === 'user' && typeof m.content === 'string') ||
        (m.role === 'assistant' && typeof m.content === 'string' && m.content && !m.tool_calls)
    ));
}

async function push(tenantId, telefono, mensaje) {
    // Keep the legacy panel and rollback path alive during Phase 2.
    const h = appendJson(tenantId, telefono, mensaje);

    if (remote.enabled() && mensaje && typeof mensaje.content === 'string') {
        try {
            const ctx = await remote.conversationForPhone(tenantId, telefono);
            const isUser = mensaje.role === 'user';
            const now = new Date().toISOString();
            const result = await ctx.db.from('messages').insert({
                organization_id: ctx.organization.id,
                conversation_id: ctx.conversation.id,
                direction: isUser ? 'inbound' : 'outbound',
                sender_type: isUser ? 'contact' : 'agent',
                body: mensaje.content,
                payload: { provider: mensaje.provider || null },
                occurred_at: now
            });
            if (result.error) throw result.error;
            const updated = await ctx.db.from('conversations').update({ last_message_at: now }).eq('id', ctx.conversation.id);
            if (updated.error) throw updated.error;
        } catch (error) { remote.report(error, 'write conversation; JSON retained'); }
    }
    return h;
}

module.exports = { get, push, claimInbound, controlMode };
