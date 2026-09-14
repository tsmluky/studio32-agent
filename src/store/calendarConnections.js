'use strict';

// Conexiones de Google Calendar por organización (DECISIONS 14/09).
//
// Dos sitios, a propósito:
//   integrations (provider 'google_calendar')  estado visible: cuenta conectada,
//       calendario elegido, si funciona. Lo puede leer el dashboard.
//   integration_credentials                     el refresh token, cifrado. Solo el
//       servidor lo lee (sin políticas RLS para usuarios).

const remote = require('./supabase');
const secretBox = require('../secretBox');

const PROVIDER = 'google_calendar';
const CACHE_MS = 5 * 60 * 1000;
const cacheTokens = new Map(); // organization_id → { token, hasta }

function db() {
    const client = remote.getClient();
    if (!client) throw new Error('Supabase no está configurado en el servidor.');
    return client;
}

function vistaPublica(row) {
    if (!row) return null;
    const config = row.config || {};
    return {
        status: row.status,
        google_email: row.external_account_id || null,
        calendar_id: config.calendar_id || null,
        calendar_name: config.calendar_name || null,
        timezone: config.timezone || null,
        connected_at: config.connected_at || null,
        last_error: row.last_error || null
    };
}

async function obtener(organizationId) {
    const result = await db().from('integrations').select('*').eq('organization_id', organizationId).eq('provider', PROVIDER).maybeSingle();
    if (result.error) throw result.error;
    return result.data || null;
}

async function guardarConexion({ organizationId, email, scopes, refreshToken, userId, calendar }) {
    const client = db();
    const cred = await client.from('integration_credentials').upsert({
        organization_id: organizationId, provider: PROVIDER, secret_ciphertext: secretBox.cifrar(refreshToken)
    }, { onConflict: 'organization_id,provider' });
    if (cred.error) throw cred.error;
    const result = await client.from('integrations').upsert({
        organization_id: organizationId,
        provider: PROVIDER,
        status: calendar ? 'active' : 'pending',
        external_account_id: email,
        last_error: null,
        config: {
            auth: 'oauth',
            scopes,
            connected_by: userId,
            connected_at: new Date().toISOString(),
            calendar_id: calendar ? calendar.id : null,
            calendar_name: calendar ? calendar.summary : null,
            timezone: calendar ? calendar.timeZone : null
        }
    }, { onConflict: 'organization_id,provider' }).select('*').single();
    if (result.error) throw result.error;
    cacheTokens.set(organizationId, { token: refreshToken, hasta: Date.now() + CACHE_MS });
    return vistaPublica(result.data);
}

async function elegirCalendario(organizationId, calendar) {
    const actual = await obtener(organizationId);
    if (!actual) throw new Error('No hay ninguna cuenta de Google conectada.');
    const result = await db().from('integrations').update({
        status: 'active',
        last_error: null,
        config: { ...(actual.config || {}), calendar_id: calendar.id, calendar_name: calendar.summary, timezone: calendar.timeZone || null }
    }).eq('id', actual.id).select('*').single();
    if (result.error) throw result.error;
    return vistaPublica(result.data);
}

async function refreshTokenDe(organizationId) {
    const cached = cacheTokens.get(organizationId);
    if (cached && cached.hasta > Date.now()) return cached.token;
    const result = await db().from('integration_credentials').select('secret_ciphertext').eq('organization_id', organizationId).eq('provider', PROVIDER).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return null;
    const token = secretBox.descifrar(result.data.secret_ciphertext);
    cacheTokens.set(organizationId, { token, hasta: Date.now() + CACHE_MS });
    return token;
}

// Google dejó de aceptar el acceso (la clínica lo retiró, o caducó). Se marca para
// que el dashboard pida reconectar, en vez de fallar en silencio cada vez.
async function marcarError(organizationId, mensaje) {
    cacheTokens.delete(organizationId);
    const result = await db().from('integrations').update({ status: 'error', last_error: mensaje }).eq('organization_id', organizationId).eq('provider', PROVIDER);
    if (result.error) console.error('[Calendar] No se pudo marcar el error de conexión:', result.error.message);
}

// Borra el acceso guardado y deja la integración desactivada. Devuelve el refresh
// token que había, para poder revocarlo en Google.
async function desconectar(organizationId) {
    const token = await refreshTokenDe(organizationId).catch(() => null);
    cacheTokens.delete(organizationId);
    const client = db();
    const del = await client.from('integration_credentials').delete().eq('organization_id', organizationId).eq('provider', PROVIDER);
    if (del.error) throw del.error;
    const actual = await obtener(organizationId);
    if (actual) {
        const upd = await client.from('integrations').update({
            status: 'disabled', last_error: null, external_account_id: null,
            config: { disconnected_at: new Date().toISOString() }
        }).eq('id', actual.id);
        if (upd.error) throw upd.error;
    }
    return token;
}

function _clearCacheForTests() { cacheTokens.clear(); }

module.exports = { PROVIDER, obtener, vistaPublica, guardarConexion, elegirCalendario, refreshTokenDe, marcarError, desconectar, _clearCacheForTests };
