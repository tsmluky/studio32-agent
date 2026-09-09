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
const { cargarTenant, listarTenantIds, dirDeTenant } = require('./tenants');
const onboarding = require('./onboarding');
const store = require('./store');
const api = require('./api/router');

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
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Panel-Token');
    res.set('Access-Control-Allow-Methods', 'POST, GET, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ───────── Rate limit en memoria para /chat ─────────
const HITS = new Map();
const RL_MAX = 30, RL_WINDOW = 5 * 60 * 1000;

// El smoke conversa a la velocidad de una máquina, no de una persona: veinte
// mensajes y sus lecturas de agenda en un minuto. Con el token acordado no se le
// aplican los frenos pensados para visitantes —ni este ni el cupo de la demo—,
// porque si no, la propia prueba se autodeniega y parece un fallo del agente.
function esSmoke(req) {
    return !!(process.env.SMOKE_TOKEN && req.headers['x-smoke-token'] === process.env.SMOKE_TOKEN);
}

function rateLimit(req, res, next) {
    if (esSmoke(req)) return next();
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

// Salud del servicio. Existe para poder preguntar DESDE FUERA si esto está vivo y
// con qué está funcionando, sin entrar al panel del hosting. Hasta ahora, si el
// agente dejaba de responder un domingo, lo descubría el cliente.
// No devuelve ningún secreto: nombres de proveedor y síes/noes, nada de claves ni
// de datos de negocios.
app.get('/health', async (_req, res) => {
    const salud = {
        ok: true,
        arrancado_hace_s: Math.round(process.uptime()),
        modelo: { proveedor: llm.PROVIDER, modelo: llm.MODEL },
        tenants: 0,
        volumen: { ruta: cfg.PATHS.data, escribible: false },
        supabase: require('./store/supabase').enabled(),
        avisos: !!(process.env.RESEND_API_KEY || process.env.SMTP_USER),
        whatsapp: {
            twilio: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
            meta: !!(process.env.META_ACCESS_TOKEN && process.env.META_PHONE_NUMBER_ID)
        }
    };
    try { salud.tenants = listarTenantIds().length; } catch (_) { salud.ok = false; }
    // El volumen es el punto donde más duele que falle: sin él, las citas se
    // borran en cada despliegue y se puede citar a dos personas a la misma hora.
    try {
        const prueba = path.join(cfg.PATHS.data, '.health');
        fs.mkdirSync(cfg.PATHS.data, { recursive: true });
        fs.writeFileSync(prueba, String(Date.now()));
        fs.unlinkSync(prueba);
        salud.volumen.escribible = true;
    } catch (_) { salud.ok = false; }
    res.status(salud.ok ? 200 : 503).json(salud);
});

// Webchat de demo (acepta ?tenant= y ?owner=)
// Estado de una sesión de demostración, para que la landing pinte en su panel
// lo que el agente ha hecho de verdad (citas creadas). SOLO LECTURA y acotado a
// la sesión que se pide: el identificador es aleatorio y solo lo conoce quien lo
// generó, así que nadie ve las conversaciones de otro. Restringido a tenants de
// demo — nunca puede devolver datos de un cliente real.
app.get('/demo/estado', rateLimit, async (req, res) => {
    try {
        const tenantId = String(req.query.tenant || '');
        const sesion = String(req.query.sesion || '');
        if (!tenantId || !sesion) return res.status(400).json({ error: 'Faltan los parámetros tenant y sesion.' });

        const tenant = cargarTenant(tenantId);
        if (!store.bookings.esDemo(tenant)) return res.status(403).json({ error: 'Solo disponible en tenants de demostración.' });

        const activas = await store.bookings.activasDeCliente(tenant, { telefono: sesion });
        res.json({
            citas: activas.map(r => ({
                fecha: r.fecha,
                hora: r.hora,
                servicio: r.servicio,
                nombre: r.nombre || null,
                creada: r.creada || null
            }))
        });
    } catch (err) {
        console.error('Error en /demo/estado:', err.message);
        res.status(500).json({ error: 'No se pudo leer el estado de la demostración.' });
    }
});

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
    return listarTenantIds();
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
        const dir = dirDeTenant(req.params.id);
        if (!dir) return res.status(404).json({ error: 'Agente no encontrado.' });
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

// Authenticated API consumed by the independent Studio32 panel.
app.use('/api', api.createRouter());

// Canal web / pruebas (JSON). Body: { tenant, sesion, mensaje, ownerToken }
app.post('/chat', rateLimit, async (req, res) => {
    try {
        const tenantId = req.body.tenant || cfg.DEFAULT_TENANT || 'barberia_demo';
        const { sesion, ownerToken } = req.body;
        let mensaje = req.body.mensaje;
        if (!sesion || !mensaje) return res.status(400).json({ error: 'Faltan los campos sesion y mensaje.' });
        mensaje = String(mensaje).slice(0, MAX_MENSAJE);
        const tenant = cargarTenant(tenantId);

        // Tenants de demostración (landing pública): el rateLimit de arriba cubre
        // ráfagas pero vive en memoria. Esto acota el uso sostenido y persiste en
        // el volumen, así que un despliegue no regala el contador.
        // Ver `esSmoke`: la prueba no le gasta la demo a nadie.
        if (store.bookings.esDemo(tenant) && !esSmoke(req)) {
            const ipCliente = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
            const permiso = store.demoLimits.registrar(tenant.id, { sesion, ip: ipCliente });
            if (!permiso.ok) return res.status(429).json({ respuesta: permiso.respuesta });
            store.bookings.purgarDemo(tenant).catch(err => console.error('Purga de demo falló:', err.message));
        }

        const ownerCfg = tenant.business.owner || {};
        const esOwner = !!(ownerToken && ownerCfg.token && ownerToken === ownerCfg.token);
        const ctx = { tenant, tenantId: tenant.id, telefono: String(sesion), esOwner, channel: 'web' };
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
