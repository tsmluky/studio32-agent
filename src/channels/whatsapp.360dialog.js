'use strict';

// Preparación de un solo proceso con volumen persistente. No activar sin W1.
const express = require('express');
const crypto = require('node:crypto');
const tenants = require('../tenants');
const conversations = require('../store/conversations');
const db = require('../store/_db');
const remote = require('../store/supabase');
const orchestrator = require('../orchestrator');
const { secretoIgual } = require('../entrySecurity');
const { puedeResponder } = require('../controlGuard');
const FILE = 'd360-inbox.json';
const busy = new Set();

function configuracion(tenantId) {
    if (!/^[a-z0-9_-]{1,100}$/.test(tenantId || '')) return null;
    // No normalizar '-' a '_': eso compartiría secretos entre slugs distintos.
    const suffix = tenantId.toUpperCase();
    const apiKey = process.env[`D360_API_KEY_${suffix}`];
    const authorization = process.env[`D360_WEBHOOK_AUTH_${suffix}`];
    return apiKey && /^Basic [A-Za-z0-9+/]+={0,2}$/.test(authorization || '') ? { apiKey, authorization } : null;
}
const numero = value => typeof value === 'string' ? value.replace(/^\+/, '').replace(/\s/g, '') : '';
function parseEventos(payload) {
    const events = [];
    for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
        for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
            const value = change?.value;
            if (!value || !['messages', 'smb_message_echoes'].includes(change.field)) continue;
            const displayNumber = value.metadata?.display_phone_number;
            const echo = change.field === 'smb_message_echoes';
            for (const msg of Array.isArray(echo ? value.message_echoes : value.messages) ? (echo ? value.message_echoes : value.messages) : []) {
                if (typeof msg.id !== 'string' || !msg.id || msg.id.length > 512) throw new Error('Mensaje sin identificador válido.');
                const phone = numero(echo ? msg.to : msg.from);
                if (!/^\d{7,15}$/.test(phone)) throw new Error('Identidad telefónica inválida.');
                events.push({ kind: echo ? 'echo' : 'inbound', id: msg.id, phone, displayNumber, businessFrom: echo ? numero(msg.from) : null,
                    type: msg.type, body: msg.type === 'text' && typeof msg.text?.body === 'string' ? msg.text.body.slice(0, 4000) : null,
                    media: msg.type === 'audio' && typeof msg.audio?.id === 'string' ? { id: msg.audio.id, mimeType: msg.audio.mime_type || null, sha256: msg.audio.sha256 || null } : null });
            }
            for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
                if (typeof status.id === 'string' && typeof status.status === 'string') events.push({ kind: 'status', id: status.id, status: status.status,
                    timestamp: String(status.timestamp || ''), displayNumber });
            }
        }
    }
    return events;
}
function key(event) { return crypto.createHash('sha256').update(JSON.stringify([event.kind, event.id, event.status || '', event.timestamp || ''])).digest('hex'); }
function guardar(tenantId, event) {
    const all = db.leer(tenantId, FILE, {}), id = key(event);
    if (Object.hasOwn(all, id)) return false;
    if (Object.keys(all).length >= 5000) throw new Error('Inbox requiere archivo de eventos procesados.');
    all[id] = { event, state: 'queued', receivedAt: new Date().toISOString() };
    db.escribir(tenantId, FILE, all);
    return true;
}
function estado(tenantId, id, changes) {
    const all = db.leer(tenantId, FILE, {});
    if (!all[id]) throw new Error('Evento ausente.');
    Object.assign(all[id], changes);
    db.escribir(tenantId, FILE, all);
}
async function enviarMensaje(tenant, to, text) {
    const conf = configuracion(tenant?.id);
    if (!conf || !/^\d{7,15}$/.test(numero(to)) || typeof text !== 'string' || !text.trim() || text.length > 4096) return false;
    try {
        const response = await fetch('https://waba-v2.360dialog.io/messages', {
            method: 'POST', signal: AbortSignal.timeout(15000),
            headers: { 'D360-API-KEY': conf.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: numero(to), type: 'text', text: { body: text } })
        });
        if (!response.ok) return false;
        const result = await response.json();
        return typeof result.messages?.[0]?.id === 'string' && !['paused', 'held_for_quality_assessment'].includes(result.messages[0].message_status);
    } catch (_) { return false; }
}

// Persistir processing ANTES de herramientas. Tras un cierre inesperado no se
// vuelve a reservar automáticamente: queda para reconciliación manual.
async function procesar(tenant) {
    if (!remote.enabled()) return; // Sin control humano duradero no ejecutar IA.
    if (busy.has(tenant.id)) return;
    busy.add(tenant.id);
    try {
        while (true) {
            const all = db.leer(tenant.id, FILE, {});
            const pending = Object.entries(all).find(([, row]) => row.state === 'queued');
            if (!pending) return;
            const [id, row] = pending, event = row.event;
            estado(tenant.id, id, { state: 'processing' });
            try {
                if (event.kind === 'status') {
                    estado(tenant.id, id, { state: 'recorded' });
                } else if (event.kind === 'echo') {
                    await conversations.humanEcho(tenant.id, event.phone, event.body, event.id);
                    estado(tenant.id, id, { state: 'recorded' });
                } else if (event.type !== 'text' || !event.body?.trim()) {
                    estado(tenant.id, id, { state: 'unsupported' });
                } else {
                    const ctx = { tenant, tenantId: tenant.id, telefono: event.phone, channel: 'whatsapp_360dialog', providerMessageId: event.id, esOwner: false };
                    const answer = await orchestrator.responder(ctx, event.body);
                    if (!answer || !await puedeResponder(ctx)) estado(tenant.id, id, { state: 'suppressed' });
                    else {
                        // Guardar texto permite revisar un envío incierto sin repetir el agente.
                        estado(tenant.id, id, { state: 'sending', response: answer });
                        const sent = await enviarMensaje(tenant, event.phone, answer);
                        estado(tenant.id, id, { state: sent ? 'accepted' : 'delivery_uncertain' });
                    }
                }
            } catch (_) {
                estado(tenant.id, id, { state: 'review_required' });
                console.error('[360dialog] Evento requiere revisión; no se repiten herramientas.');
            }
        }
    } finally { busy.delete(tenant.id); }
}
function router() {
    const router = express.Router();
    router.post('/:tenantId/webhook', async (req, res) => {
        const conf = configuracion(req.params.tenantId);
        if (!conf) return res.sendStatus(503);
        if (!secretoIgual(req.get('Authorization'), conf.authorization)) return res.sendStatus(403);
        if (!req.is('application/json')) return res.sendStatus(415);
        let tenant, events;
        try {
            tenant = tenants.cargarTenant(req.params.tenantId);
            if (tenant.business?.channels?.whatsapp_360dialog?.enabled !== true) return res.sendStatus(503);
            events = parseEventos(req.body);
            if (events.some(event => tenants.resolverTenantPorNumero(event.displayNumber)?.id !== tenant.id ||
                (event.kind === 'echo' && numero(event.displayNumber) !== event.businessFrom))) return res.sendStatus(403);
        } catch (_) { return res.sendStatus(400); }
        try {
            // Ecos primero: takeover antes de procesar mensajes del mismo lote.
            for (const event of events.filter(event => event.kind === 'echo')) {
                await conversations.humanEcho(tenant.id, event.phone, event.body, event.id);
            }
            for (const event of events) guardar(tenant.id, event);
        } catch (_) { return res.sendStatus(503); }
        res.sendStatus(200);
        if (process.env.D360_PROCESS_INBOUND === 'on') {
            setImmediate(() => procesar(tenant).catch(() => console.error('[360dialog] Fallo de lectura de inbox.')));
        }
    });
    return router;
}
// Reanuda SOLO queued. processing/sending ambiguos requieren revisión explícita.
function iniciar() {
    if (process.env.D360_PROCESS_INBOUND !== 'on') return;
    const timer = setInterval(() => {
        for (const id of tenants.listarTenantIds()) {
            const tenant = tenants.cargarTenant(id);
            if (configuracion(id) && tenant.business?.channels?.whatsapp_360dialog?.enabled === true) {
                procesar(tenant).catch(() => console.error('[360dialog] Fallo de recuperación de inbox.'));
            }
        }
    }, 5000);
    timer.unref();
    return timer;
}
module.exports = { configuracion, parseEventos, guardar, procesar, enviarMensaje, router, iniciar };
