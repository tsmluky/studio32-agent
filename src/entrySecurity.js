'use strict';

const crypto = require('node:crypto');

function secretoIgual(got, expected) {
    if (typeof got !== 'string' || typeof expected !== 'string' || !expected) return false;
    const a = Buffer.from(got), b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verificarMeta(req, res, next) {
    const secret = process.env.META_APP_SECRET;
    if (!secret) return res.sendStatus(503);
    const signature = req.get('x-hub-signature-256');
    if (!Buffer.isBuffer(req.rawBody) || !/^sha256=[a-fA-F0-9]{64}$/.test(signature || '')) return res.sendStatus(403);
    const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest();
    const got = Buffer.from(signature.slice(7), 'hex');
    if (!crypto.timingSafeEqual(got, expected)) return res.sendStatus(403);
    next();
}

function verificarTwilio(req, res, next) {
    const token = process.env.TWILIO_AUTH_TOKEN;
    const canonical = process.env.TWILIO_WEBHOOK_URL;
    if (!token || !canonical) return res.sendStatus(503);
    // El proveedor envía formulario. No validar JSON como si fuese formulario.
    if (!req.is('application/x-www-form-urlencoded')) return res.sendStatus(415);
    let url;
    try { url = new URL(canonical); } catch (_) { return res.sendStatus(503); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) return res.sendStatus(503);
    // No reconstruir la URL desde Host / X-Forwarded-Host controlados por el emisor.
    if (req.originalUrl !== url.pathname + url.search) return res.sendStatus(403);
    const signature = req.get('x-twilio-signature');
    if (typeof signature !== 'string' || !signature) return res.sendStatus(403);
    try {
        if (!require('twilio').validateRequest(token, signature, canonical, req.body || {})) return res.sendStatus(403);
    } catch (_) { return res.sendStatus(403); }
    next();
}

function identidadWeb(tenant, sesion, ownerToken, smokeToken) {
    if (typeof sesion !== 'string' || !sesion.trim() || sesion.length > 200 || ['__proto__', 'constructor', 'prototype'].includes(sesion)) {
        return { status: 400, error: 'La sesión debe ser un identificador de texto de hasta 200 caracteres.' };
    }
    const esOwner = secretoIgual(ownerToken, tenant.business?.owner?.token);
    const smoke = secretoIgual(smokeToken, process.env.SMOKE_TOKEN);
    const demo = tenant.business?.demo === true;
    // Excepción explícita para el widget comercial propio; no para otras clínicas.
    if (!demo && tenant.id !== 'studio32' && !esOwner && !smoke) {
        return { status: 403, error: 'El chat de este negocio requiere acceso autorizado.' };
    }
    // Un identificador elegido en la web jamás es una identidad telefónica real.
    return { telefono: demo ? sesion : `web:${sesion}`, esOwner };
}

module.exports = { secretoIgual, verificarMeta, verificarTwilio, identidadWeb };
