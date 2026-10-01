'use strict';

// Canal WhatsApp por META CLOUD API (directo, sin Twilio ni BSP).
// - GET  /whatsapp/meta/webhook : verificación del webhook (Meta manda un reto).
// - POST /whatsapp/meta/webhook : mensajes entrantes; respondemos vía Graph API.
//
// No añade dependencias: usa fetch nativo (Node 18+). Variables en .env:
//   META_VERIFY_TOKEN   (lo eliges tú; se pega también en el panel de Meta)
//   META_ACCESS_TOKEN   (token de la app de Meta; permanente vía System User en prod)
//   META_PHONE_NUMBER_ID (id del número, NO el número en sí)
//   META_GRAPH_VERSION  (opcional, p. ej. v22.0)
//
// META_APP_SECRET valida la firma del POST; VERIFY_TOKEN solo valida el reto GET.

const express = require('express');
const { responder } = require('../orchestrator');
const { resolverTenantPorNumero } = require('../tenants');
const { verificarMeta, secretoIgual } = require('../entrySecurity');
const { puedeResponder } = require('../controlGuard');

const GRAPH = process.env.META_GRAPH_VERSION || 'v22.0';

function configurado() {
    return !!(process.env.META_ACCESS_TOKEN && process.env.META_PHONE_NUMBER_ID);
}

// Extrae { from, body, displayNumber } del payload de Meta (o null si no aplica).
function parseEntrante(payload) {
    try {
        const value = payload.entry[0].changes[0].value;
        const msg = value.messages && value.messages[0];
        if (!msg || msg.type !== 'text') return null; // ignora estados de entrega y no-texto
        return {
            id: msg.id,
            from: msg.from,
            body: msg.text.body,
            displayNumber: value.metadata && value.metadata.display_phone_number
        };
    } catch (_) { return null; }
}

async function enviarMensaje(to, texto) {
    if (!configurado()) { console.log('[META no configurado] →', to, ':', texto); return false; }
    const url = `https://graph.facebook.com/${GRAPH}/${process.env.META_PHONE_NUMBER_ID}/messages`;
    try {
        const r = await fetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } })
        });
        if (!r.ok) { console.error('Meta send error', r.status, await r.text()); return false; }
        return true;
    } catch (err) { console.error('Meta send fallo:', err.message); return false; }
}

function router() {
    const r = express.Router();

    // Verificación del webhook (Meta hace un GET con hub.*)
    r.get('/webhook', (req, res) => {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        if (mode === 'subscribe' && typeof challenge === 'string' && secretoIgual(token, process.env.META_VERIFY_TOKEN)) return res.status(200).send(challenge);
        return res.sendStatus(403);
    });

    // Mensajes entrantes
    r.post('/webhook', verificarMeta, async (req, res) => {
        res.sendStatus(200); // Solo se aceptan eventos autenticados.
        const entrante = parseEntrante(req.body);
        if (!entrante) return;
        try {
            const tenant = resolverTenantPorNumero(entrante.displayNumber);
            if (!tenant) { console.error('Meta: destino sin tenant inequívoco; evento descartado.'); return; }
            const ownerCfg = tenant.business.owner || {};
            const ownerNum = (ownerCfg.whatsapp || '').replace(/[^0-9]/g, '');
            const fromNum = (entrante.from || '').replace(/[^0-9]/g, '');
            const esOwner = !!(ownerNum && fromNum === ownerNum); // match EXACTO, nunca subcadena
            const ctx = {
                tenant,
                tenantId: tenant.id,
                telefono: entrante.from,
                esOwner,
                channel: 'whatsapp_meta',
                providerMessageId: entrante.id || null
            };
            const respuesta = await responder(ctx, entrante.body);
            if (respuesta && await puedeResponder(ctx)) await enviarMensaje(entrante.from, respuesta);
        } catch (err) { console.error('Meta webhook error:', err); }
    });

    return r;
}

module.exports = { router, configurado, enviarMensaje, parseEntrante };
