'use strict';

// "Conectar Google Calendar" desde el dashboard (DECISIONS 14/09).
//
// La clínica autoriza a Studio32 con su propia cuenta de Google, sin compartir
// calendarios a mano. Configuración del servidor:
//   GOOGLE_OAUTH_CLIENT_FILE  ruta al JSON del cliente OAuth (tipo "Aplicación web")
//   GOOGLE_OAUTH_CLIENT_JSON  o el JSON entero en una variable (Railway)
//   GOOGLE_OAUTH_REDIRECT_URI la vuelta registrada en Google (…/google/callback)
//   PANEL_URL                 adónde se devuelve a la clínica al terminar
//
// Permisos: los mínimos para lo que hace el producto. Cada uno hay que justificarlo
// ante Google en la verificación, así que no se amplían sin motivo escrito.

const fs = require('fs');

const SCOPES = [
    'openid',
    'email',
    // Elegir en qué calendario trabaja el asistente.
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    // Ver huecos y crear, mover y cancelar citas, solo en calendarios propios.
    'https://www.googleapis.com/auth/calendar.events.owned'
];

let _cliente;

function credencialesCliente() {
    if (_cliente !== undefined) return _cliente;
    let raw = process.env.GOOGLE_OAUTH_CLIENT_JSON;
    if (!raw && process.env.GOOGLE_OAUTH_CLIENT_FILE) {
        try { raw = fs.readFileSync(process.env.GOOGLE_OAUTH_CLIENT_FILE, 'utf8'); }
        catch (err) { console.error('[Google OAuth] No se pudo leer GOOGLE_OAUTH_CLIENT_FILE:', err.message); }
    }
    if (!raw) return (_cliente = null);
    const parsed = JSON.parse(raw);
    const datos = parsed.web || parsed.installed || parsed;
    _cliente = datos.client_id && datos.client_secret ? { clientId: datos.client_id, clientSecret: datos.client_secret } : null;
    return _cliente;
}

function redirectUri() {
    return process.env.GOOGLE_OAUTH_REDIRECT_URI || `http://localhost:${process.env.PORT || 3000}/google/callback`;
}

function disponible() {
    return Boolean(credencialesCliente());
}

function nuevoCliente() {
    const cred = credencialesCliente();
    if (!cred) throw new Error('Google OAuth no está configurado en el servidor.');
    const { google } = require('googleapis');
    return new google.auth.OAuth2(cred.clientId, cred.clientSecret, redirectUri());
}

// URL a la que se manda a la clínica. `prompt: consent` garantiza que Google entrega
// refresh token también cuando la cuenta ya había autorizado antes.
function urlDeAutorizacion(state, { loginHint } = {}) {
    return nuevoCliente().generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: false,
        scope: SCOPES,
        state,
        ...(loginHint ? { login_hint: loginHint } : {})
    });
}

// Canjea el código de la vuelta. Devuelve el refresh token, el correo de la cuenta y
// los permisos que la clínica concedió de verdad (puede desmarcar alguno).
async function canjearCodigo(code) {
    const client = nuevoCliente();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) throw new Error('Google no ha devuelto acceso permanente. Vuelve a conectar y acepta todos los permisos.');
    let email = null;
    if (tokens.id_token) {
        const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: credencialesCliente().clientId });
        email = ticket.getPayload().email || null;
    }
    const concedidos = String(tokens.scope || '').split(/\s+/).filter(Boolean);
    return { refreshToken: tokens.refresh_token, email, scopes: concedidos };
}

function permisosSuficientes(scopes) {
    return SCOPES.filter(s => s.startsWith('https://')).every(s => scopes.includes(s));
}

// Cliente autenticado como la clínica, a partir de su refresh token.
function clienteConRefreshToken(refreshToken) {
    const client = nuevoCliente();
    client.setCredentials({ refresh_token: refreshToken });
    return client;
}

async function revocar(refreshToken) {
    try { await nuevoCliente().revokeToken(refreshToken); }
    catch (err) { console.error('[Google OAuth] Revocar falló (se desconecta igual):', err.message); }
}

// Google responde invalid_grant cuando la clínica retiró el acceso desde su cuenta, o
// cuando el token caducó (en modo "Testing", a los 7 días).
function accesoRetirado(err) {
    const detalle = err && ((err.response && err.response.data && err.response.data.error) || err.message);
    return /invalid_grant/i.test(String(detalle || ''));
}

function _resetForTests() { _cliente = undefined; }

module.exports = { SCOPES, disponible, urlDeAutorizacion, canjearCodigo, permisosSuficientes, clienteConRefreshToken, revocar, accesoRetirado, redirectUri, _resetForTests };
