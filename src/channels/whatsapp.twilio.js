'use strict';

// Canal WhatsApp vía TWILIO (BSP). Convive con el canal Meta sin pisarlo: este se
// monta en /whatsapp y Meta en /whatsapp/meta. Útil cuando Studio32 provisiona y
// gestiona el número desde Twilio (incluido en la cuota del cliente).
//
// La librería 'twilio' se carga de forma perezosa: el proyecto y el smoke test
// cargan sin tenerla instalada; solo se requiere al enviar/recibir de verdad.
//
// Config (.env): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER
// (formato whatsapp:+34XXXXXXXXX; en pruebas el sandbox whatsapp:+14155238886).
//
// Seguridad (producción): conviene validar la firma X-Twilio-Signature del webhook.
// Se deja anotado; no se fuerza para no romper pruebas tras un túnel (ngrok).

const express = require('express');
const { responder } = require('../orchestrator');
const { resolverTenantPorNumero, cargarTenant } = require('../tenants');

let _twilio = null;
function lib() { if (!_twilio) _twilio = require('twilio'); return _twilio; }

function configurado() {
    return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_NUMBER);
}

let _client = null;
function getClient() {
    if (_client) return _client;
    if (!configurado()) return null;
    _client = lib()(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    return _client;
}

// Envía un WhatsApp por Twilio. `to` admite con o sin prefijo "whatsapp:".
async function enviarMensaje(to, texto) {
    const client = getClient();
    if (!client) { console.log('[TWILIO no configurado] →', to, ':', texto); return; }
    const dest = String(to).startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    try {
        await client.messages.create({ from: process.env.TWILIO_WHATSAPP_NUMBER, to: dest, body: texto });
    } catch (err) { console.error('Twilio send fallo:', err.message); }
}

function router() {
    const r = express.Router();

    r.post('/webhook', async (req, res) => {
        const from = req.body.From;            // cliente:  "whatsapp:+34..."
        const to = req.body.To;                // negocio:  "whatsapp:+..."  -> tenant
        const body = (req.body.Body || '').trim();

        // Responder rápido a Twilio (TwiML vacío) y procesar en segundo plano.
        res.set('Content-Type', 'text/xml');
        res.send(new (lib().twiml.MessagingResponse)().toString());

        if (!from || !body) return;
        try {
            const tenant = resolverTenantPorNumero(to) || cargarTenant(process.env.DEFAULT_TENANT || 'studio32');
            const ownerCfg = tenant.business.owner || {};
            const ownerNum = (ownerCfg.whatsapp || '').replace(/[^0-9]/g, '');
            const fromNum = (from || '').replace(/[^0-9]/g, '');
            const esOwner = !!(ownerNum && fromNum === ownerNum); // match EXACTO, nunca subcadena
            const ctx = {
                tenant,
                tenantId: tenant.id,
                telefono: from,
                esOwner,
                channel: 'whatsapp_twilio',
                providerMessageId: req.body.MessageSid || req.body.SmsMessageSid || null
            };
            const respuesta = await responder(ctx, body);
            if (respuesta) await enviarMensaje(from, respuesta);
        } catch (err) {
            console.error('Error en canal Twilio:', err);
            await enviarMensaje(from, 'Ahora mismo no puedo responder, pruebo de nuevo en unos minutos.');
        }
    });

    return r;
}

module.exports = { router, configurado, enviarMensaje };
