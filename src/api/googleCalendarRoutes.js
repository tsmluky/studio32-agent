'use strict';

// "Conectar Google Calendar" (DECISIONS 14/09).
//
//   GET  /api/google-calendar                estado (cualquier miembro)
//   POST /api/google-calendar/connect        URL de Google para autorizar (dueño/admin)
//   GET  /api/google-calendar/calendars      calendarios propios de la cuenta (dueño/admin)
//   POST /api/google-calendar/calendar       elegir en cuál trabaja el asistente (dueño/admin)
//   POST /api/google-calendar/disconnect     desconectar y revocar (dueño/admin)
//   GET  /google/callback                    vuelta de Google (pública, sin sesión: la
//                                            identidad viaja firmada en `state`)

const remote = require('../store/supabase');
const conexiones = require('../store/calendarConnections');
const bookings = require('../store/bookings');
const gcal = require('../integrations/googleCalendar');
const oauth = require('../integrations/googleOAuth');
const secretBox = require('../secretBox');
const { cargarTenant } = require('../tenants');

const ADMIN_ROLES = ['owner', 'admin'];

function asyncRoute(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function activado() {
    return oauth.disponible() && secretBox.disponible();
}

function refDeOrganizacion(organizationId) {
    return { provider: 'google_oauth', organization_id: organizationId };
}

async function slugDeOrganizacion(organizationId) {
    const result = await remote.getClient().from('organizations').select('slug').eq('id', organizationId).maybeSingle();
    if (result.error) throw result.error;
    return result.data ? result.data.slug : null;
}

// Un negocio solo se conecta si tiene asistente y no es de demostración.
async function motivoParaNoConectar(organizationId) {
    const slug = await slugDeOrganizacion(organizationId);
    let tenant;
    try { tenant = cargarTenant(slug); }
    catch (_) { return 'Este negocio todavía no tiene el asistente configurado.'; }
    if (bookings.esDemo(await remote.hydrateTenant(tenant))) return 'Los negocios de demostración no se conectan a Google Calendar.';
    return null;
}

function montar(router, { requireOrganization }) {
    router.get('/google-calendar', asyncRoute(async (req, res) => {
        const scope = requireOrganization(req, res);
        if (!scope) return;
        const [row, motivo] = await Promise.all([conexiones.obtener(scope.organizationId), motivoParaNoConectar(scope.organizationId)]);
        const conectada = row && row.status !== 'disabled' ? conexiones.vistaPublica(row) : null;
        res.json({ available: activado(), supported: !motivo, can_manage: ADMIN_ROLES.includes(scope.role), connection: conectada });
    }));

    router.post('/google-calendar/connect', asyncRoute(async (req, res) => {
        const scope = requireOrganization(req, res, ADMIN_ROLES);
        if (!scope) return;
        if (!activado()) return res.status(503).json({ error: 'La conexión con Google todavía no está activada. Escríbenos y la dejamos lista.' });
        const motivo = await motivoParaNoConectar(scope.organizationId);
        if (motivo) return res.status(409).json({ error: motivo });
        const state = secretBox.firmar({ o: scope.organizationId, u: req.apiAuth.user.id });
        res.json({ url: oauth.urlDeAutorizacion(state, { loginHint: req.apiAuth.user.email }) });
    }));

    router.get('/google-calendar/calendars', asyncRoute(async (req, res) => {
        const scope = requireOrganization(req, res, ADMIN_ROLES);
        if (!scope) return;
        if (!(await conexiones.refreshTokenDe(scope.organizationId))) return res.status(409).json({ error: 'Primero conecta Google Calendar.' });
        res.json({ calendars: await gcal.listOwnedCalendars(refDeOrganizacion(scope.organizationId)) });
    }));

    router.post('/google-calendar/calendar', asyncRoute(async (req, res) => {
        const scope = requireOrganization(req, res, ADMIN_ROLES);
        if (!scope) return;
        const calendars = await gcal.listOwnedCalendars(refDeOrganizacion(scope.organizationId));
        const elegido = calendars.find(item => item.id === req.body.calendar_id);
        if (!elegido) return res.status(400).json({ error: 'Ese calendario no es de la cuenta conectada.' });
        const connection = await conexiones.elegirCalendario(scope.organizationId, elegido);
        await remote.getClient().from('audit_logs').insert({ organization_id: scope.organizationId, actor_user_id: req.apiAuth.user.id, actor_type: 'user', action: 'google_calendar.select', entity_type: 'integration', data: { calendar: elegido.summary } });
        res.json({ connection });
    }));

    router.post('/google-calendar/disconnect', asyncRoute(async (req, res) => {
        const scope = requireOrganization(req, res, ADMIN_ROLES);
        if (!scope) return;
        const token = await conexiones.desconectar(scope.organizationId);
        if (token) await oauth.revocar(token);
        await remote.getClient().from('audit_logs').insert({ organization_id: scope.organizationId, actor_user_id: req.apiAuth.user.id, actor_type: 'user', action: 'google_calendar.disconnect', entity_type: 'integration' });
        res.json({ connection: null });
    }));
}

// Vuelta desde Google. No hay sesión del dashboard en esta petición (la hace el
// navegador al volver de Google), así que la identidad sale del `state` firmado, y
// se vuelve a comprobar que esa persona sigue siendo dueña o admin del negocio.
async function callback(req, res) {
    const panel = String(process.env.PANEL_URL || 'https://dashboard.studio32.es').replace(/\/$/, '');
    const volver = (params) => res.redirect(303, `${panel}/?${new URLSearchParams(params)}`);
    const state = secretBox.disponible() ? secretBox.verificar(req.query.state) : null;
    if (!state) return volver({ google: 'error', motivo: 'caducado' });
    const organizationId = state.o;
    if (req.query.error) return volver({ google: 'cancelado', org: organizationId });
    if (!req.query.code) return volver({ google: 'error', motivo: 'google', org: organizationId });

    try {
        const db = remote.getClient();
        const miembro = await db.from('organization_members').select('role').eq('organization_id', organizationId).eq('user_id', state.u).maybeSingle();
        if (miembro.error) throw miembro.error;
        if (!miembro.data || !ADMIN_ROLES.includes(miembro.data.role)) return volver({ google: 'error', motivo: 'permiso', org: organizationId });
        const motivo = await motivoParaNoConectar(organizationId);
        if (motivo) return volver({ google: 'error', motivo: 'negocio', org: organizationId });

        const { refreshToken, email, scopes } = await oauth.canjearCodigo(req.query.code);
        if (!oauth.permisosSuficientes(scopes)) {
            // Desmarcó algún permiso: sin él el asistente no puede trabajar. No se guarda
            // un acceso a medias.
            await oauth.revocar(refreshToken);
            return volver({ google: 'error', motivo: 'permisos', org: organizationId });
        }

        // Si ya había otra cuenta conectada, se revoca: un negocio, un acceso.
        const anterior = await conexiones.refreshTokenDe(organizationId).catch(() => null);
        await conexiones.guardarConexion({ organizationId, email, scopes, refreshToken, userId: state.u, calendar: null });
        if (anterior && anterior !== refreshToken) await oauth.revocar(anterior);

        const calendars = await gcal.listOwnedCalendars(refDeOrganizacion(organizationId));
        const principal = calendars.find(item => item.primary) || calendars[0];
        if (principal) await conexiones.elegirCalendario(organizationId, principal);

        await db.from('audit_logs').insert({ organization_id: organizationId, actor_user_id: state.u, actor_type: 'user', action: 'google_calendar.connect', entity_type: 'integration', data: { google_email: email, calendar: principal ? principal.summary : null } });
        return volver({ google: 'conectado', org: organizationId });
    } catch (err) {
        console.error('[Google OAuth] La vuelta de Google falló:', err.message);
        return volver({ google: 'error', motivo: 'google', org: organizationId });
    }
}

module.exports = { montar, callback };
