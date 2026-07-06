'use strict';

// Punto de entrada HTTP: healthcheck, canal WhatsApp, webchat de demo, widget
// embebible, onboarding, panel interno de Studio32 y canal de pruebas JSON (/chat).

const path = require('path');
const fs = require('fs');
const express = require('express');
const cfg = require('./config');
const llm = require('./llm');
const whatsappMeta = require('./channels/whatsapp.meta');
const whatsapp = require('./channels/whatsapp.twilio');
const { responder } = require('./orchestrator');
const { cargarTenant } = require('./tenants');
const onboarding = require('./onboarding');
const store = require('./store');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PUBLIC = path.join(__dirname, '..', 'public');
const MAX_MENSAJE = 1000;

// ───────── CORS (widget en otros dominios) ─────────
const ORIGINS = (cfg.CORS_ORIGINS || '*').split(',').map(s => s.trim());
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (ORIGINS.includes('*')) res.set('Access-Control-Allow-Origin', '*');
    else if (origin && ORIGINS.includes(origin)) res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Panel-Token');
    res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ───────── Rate limit en memoria para /chat ─────────
const HITS = new Map();
const RL_MAX = 30, RL_WINDOW = 5 * 60 * 1000;
function rateLimit(req, res, next) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'x';
    const now = Date.now();
    const arr = (HITS.get(ip) || []).filter(t => now - t < RL_WINDOW);
    if (arr.length >= RL_MAX) return res.status(429).json({ respuesta: 'Vas muy rápido, espera un momento y seguimos.' });
    arr.push(now); HITS.set(ip, arr);
    next();
}

// ───────── Auth opcional del panel ─────────
function panelAuth(req, res, next) {
    const t = process.env.PANEL_TOKEN;
    // Fail-closed: sin PANEL_TOKEN configurado, el panel NO sirve datos (evita
    // exponer tokens de dueño y datos de clientes si el servidor es público).
    if (!t) return res.status(403).json({ error: 'Panel deshabilitado: define PANEL_TOKEN en .env para usarlo.' });
    const got = req.headers['x-panel-token'] || req.query.token || (req.body && req.body.token);
    if (got !== t) return res.status(401).json({ error: 'Token de panel no válido.' });
    next();
}

app.get('/', (_req, res) => res.send('Studio32 Agent · OK · /demo · /widget-demo · /onboarding · /panel'));

// Webchat de demo (acepta ?tenant= y ?owner=)
app.use('/demo', express.static(PUBLIC));

// Widget embebible
app.get('/widget.js', (_req, res) => { res.type('application/javascript'); res.sendFile(path.join(PUBLIC, 'widget.js')); });
app.get('/widget-demo', (_req, res) => res.sendFile(path.join(PUBLIC, 'widget-demo.html')));

// ───────── Onboarding ─────────
app.get('/onboarding', (_req, res) => res.sendFile(path.join(PUBLIC, 'onboarding.html')));
app.get('/onboarding/api/verticales', (_req, res) => res.json({ verticales: onboarding.listarVerticales() }));
app.get('/onboarding/api/plantilla/:vertical', (req, res) => {
    try { res.json(onboarding.cargarPlantilla(req.params.vertical)); }
    catch (err) { res.status(404).json({ error: err.message }); }
});
app.post('/onboarding/api/crear', (req, res) => {
    const token = process.env.ONBOARDING_TOKEN;
    if (token && req.body.token !== token) return res.status(401).json({ error: 'Token de onboarding no válido.' });
    try {
        const r = onboarding.crearTenant(req.body);
        res.json({
            ...r,
            preview_url: `/demo/?tenant=${encodeURIComponent(r.tenantId)}`,
            owner_url: `/demo/?tenant=${encodeURIComponent(r.tenantId)}&owner=${encodeURIComponent(r.owner_token)}`
        });
    } catch (err) { console.error('Onboarding:', err); res.status(400).json({ error: err.message }); }
});

// ───────── Panel interno de Studio32 ─────────
function listaTenants() {
    return fs.readdirSync(cfg.PATHS.tenants, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
}
app.get('/panel', (_req, res) => res.sendFile(path.join(PUBLIC, 'panel.html')));

app.get('/panel/api/agentes', panelAuth, async (_req, res) => {
    const out = [];
    for (const id of listaTenants()) {
        let t; try { t = cargarTenant(id); } catch (_) { continue; }
        const bk = await store.bookings.listar(id);
        const lds = await store.leads.listar(id);
        const u = await store.usage.leer(id);
        out.push({
            id,
            nombre: t.business.nombre || id,
            vertical: t.business._vertical || '-',
            estado: t.business._estado || 'activo',
            calendar: !!(t.business.calendar && t.business.calendar.calendar_id),
            email_avisos: (t.handoff && t.handoff.email) || '',
            reservas: bk.filter(r => r.estado === 'confirmada').length,
            reservas_total: bk.length,
            leads: lds.length,
            mensajes: u.mensajes || 0,
            ultimo_uso: u.ultimo || null,
            owner_token: (t.business.owner && t.business.owner.token) || ''
        });
    }
    out.sort((a, b) => (b.mensajes - a.mensajes));
    res.json({ total: out.length, agentes: out });
});

app.get('/panel/api/agente/:id', panelAuth, async (req, res) => {
    try {
        const t = cargarTenant(req.params.id);
        res.json({
            id: t.id,
            business: t.business,
            servicios: t.services.servicios || [],
            faq: t.faq, tone: t.tone, handoff: t.handoff,
            bookings: await store.bookings.listar(t.id),
            leads: await store.leads.listar(t.id),
            usage: await store.usage.leer(t.id)
        });
    } catch (err) { res.status(404).json({ error: err.message }); }
});

// Editar detalles ligeros del contexto (email avisos, tono, estado, servicios).
app.post('/panel/api/agente/:id', panelAuth, (req, res) => {
    try {
        const dir = path.join(cfg.PATHS.tenants, req.params.id);
        if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Agente no encontrado.' });
        const bp = path.join(dir, 'business.json');
        const business = JSON.parse(fs.readFileSync(bp, 'utf8'));
        if (req.body.estado) business._estado = req.body.estado;
        fs.writeFileSync(bp, JSON.stringify(business, null, 2));
        if (typeof req.body.tono === 'string' && req.body.tono.trim()) fs.writeFileSync(path.join(dir, 'tone.md'), req.body.tono);
        if (Array.isArray(req.body.servicios)) fs.writeFileSync(path.join(dir, 'services.json'), JSON.stringify({ servicios: req.body.servicios }, null, 2));
        if (typeof req.body.email_avisos === 'string') {
            const hp = path.join(dir, 'handoff.json');
            const h = (() => { try { return JSON.parse(fs.readFileSync(hp, 'utf8')); } catch (_) { return {}; } })();
            h.email = req.body.email_avisos;
            fs.writeFileSync(hp, JSON.stringify(h, null, 2));
        }
        res.json({ ok: true, _aviso: 'Cambios guardados. Reinicia el servidor para recargar la caché del tenant.' });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Canales WhatsApp. Meta primero para que /whatsapp/meta no lo capture Twilio.
app.use('/whatsapp/meta', whatsappMeta.router());  // Meta Cloud API: /whatsapp/meta/webhook
app.use('/whatsapp', whatsapp.router());           // Twilio (BSP):    /whatsapp/webhook

// Canal web / pruebas (JSON). Body: { tenant, sesion, mensaje, ownerToken }
app.post('/chat', rateLimit, async (req, res) => {
    try {
        const tenantId = req.body.tenant || cfg.DEFAULT_TENANT || 'barberia_demo';
        const { sesion, ownerToken } = req.body;
        let mensaje = req.body.mensaje;
        if (!sesion || !mensaje) return res.status(400).json({ error: 'Faltan los campos sesion y mensaje.' });
        mensaje = String(mensaje).slice(0, MAX_MENSAJE);
        const tenant = cargarTenant(tenantId);
        const ownerCfg = tenant.business.owner || {};
        const esOwner = !!(ownerToken && ownerCfg.token && ownerToken === ownerCfg.token);
        const ctx = { tenant, tenantId: tenant.id, telefono: String(sesion), esOwner };
        const respuesta = await responder(ctx, mensaje);
        res.json({ respuesta });
    } catch (err) {
        console.error('Error en /chat | status:', err.status, '| code:', err.code || (err.error && err.error.code), '| message:', err.message);
        res.status(500).json({ respuesta: 'Uf, se me ha cruzado algo. Me lo repites?' });
    }
});

app.listen(cfg.PORT, () => {
    console.log(`Studio32 Agent escuchando en el puerto ${cfg.PORT}`);
    console.log(`LLM: ${llm.MODEL} (${llm.PROVIDER})`);
    console.log(`Webchat: /demo · Widget: /widget-demo · Onboarding: /onboarding · Panel: /panel`);
    if (process.env.RECORDATORIOS !== 'off') {
        require('./reminders').iniciar(Number(process.env.RECORDATORIOS_MIN) || 10);
    }
});
