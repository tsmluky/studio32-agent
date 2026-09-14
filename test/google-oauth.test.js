'use strict';

// "Conectar Google Calendar" desde el dashboard (DECISIONS 14/09).
//
// Lo que no se puede romper: el acceso de la clínica solo lo lee el servidor, una
// vuelta de Google falsificada no engancha nada a ningún negocio, y la conexión de
// la clínica manda sobre cualquier calendario puesto a mano.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const secretBox = require('../src/secretBox');
const remote = require('../src/store/supabase');
const oauth = require('../src/integrations/googleOAuth');
const bookings = require('../src/store/bookings');
const { callback } = require('../src/api/googleCalendarRoutes');

const CLAVE = crypto.randomBytes(32).toString('base64');

function conClave(fn) {
    return async () => {
        const previa = process.env.INTEGRATION_SECRET_KEY;
        process.env.INTEGRATION_SECRET_KEY = CLAVE;
        try { await fn(); }
        finally { if (previa === undefined) delete process.env.INTEGRATION_SECRET_KEY; else process.env.INTEGRATION_SECRET_KEY = previa; }
    };
}

// ─── Cifrado y firma ───

test('el acceso cifrado solo se recupera con la clave del servidor', conClave(() => {
    const sobre = secretBox.cifrar('1//refresh-token-de-la-clinica');
    assert.ok(!sobre.includes('refresh-token'), 'no se ve en claro');
    assert.equal(secretBox.descifrar(sobre), '1//refresh-token-de-la-clinica');
    process.env.INTEGRATION_SECRET_KEY = crypto.randomBytes(32).toString('base64');
    assert.throws(() => secretBox.descifrar(sobre), 'con otra clave no se abre');
}));

test('un cifrado manipulado no se abre', conClave(() => {
    const [v, iv, tag, datos] = secretBox.cifrar('secreto').split('.');
    const otro = Buffer.from(datos, 'base64url'); otro[0] ^= 1;
    assert.throws(() => secretBox.descifrar([v, iv, tag, otro.toString('base64url')].join('.')));
}));

test('la vuelta firmada se reconoce; manipulada o caducada, no', conClave(() => {
    const state = secretBox.firmar({ o: 'org-1', u: 'user-1' });
    assert.equal(secretBox.verificar(state).o, 'org-1');

    const [cuerpo, firma] = state.split('.');
    const cambiado = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(cuerpo, 'base64url')), o: 'org-de-otro' })).toString('base64url');
    assert.equal(secretBox.verificar(`${cambiado}.${firma}`), null, 'cambiar la organización invalida la firma');
    assert.equal(secretBox.verificar('basura'), null);
    assert.equal(secretBox.verificar(secretBox.firmar({ o: 'org-1' }, { caducaEnSegundos: -1 })), null, 'caducada');
}));

test('sin clave en el servidor, la conexión no está disponible', () => {
    const previa = process.env.INTEGRATION_SECRET_KEY;
    delete process.env.INTEGRATION_SECRET_KEY;
    try { assert.equal(secretBox.disponible(), false); }
    finally { if (previa !== undefined) process.env.INTEGRATION_SECRET_KEY = previa; }
});

// ─── La conexión de la clínica en la configuración del negocio ───

const TENANT = { id: 'clinica-real', business: { demo: false, calendar: { calendar_id: 'puesto-a-mano@group.calendar.google.com', timezone: 'Europe/Madrid' } }, services: { servicios: [] }, handoff: {} };

test('la conexión de la clínica manda sobre el calendario puesto a mano', () => {
    const integration = { status: 'active', config: { calendar_id: 'clinica@gmail.com', timezone: 'Europe/Madrid', scopes: ['x'], connected_by: 'user-1' } };
    const t = remote.mergeRuntimeTenant(TENANT, [], null, integration, 'org-1');
    assert.deepEqual(t.business.calendar, { calendar_id: 'clinica@gmail.com', timezone: 'Europe/Madrid', provider: 'google_oauth', organization_id: 'org-1' });
});

test('el acceso de Google nunca entra en la configuración del negocio', () => {
    const integration = { status: 'active', config: { calendar_id: 'clinica@gmail.com', refresh_token: 'NO-DEBE-VIAJAR' } };
    const t = remote.mergeRuntimeTenant(TENANT, [], null, integration, 'org-1');
    assert.ok(!JSON.stringify(t).includes('NO-DEBE-VIAJAR'));
});

test('una conexión desactivada o sin calendario elegido no cambia nada', () => {
    for (const integration of [{ status: 'disabled', config: { calendar_id: 'x' } }, { status: 'pending', config: {} }, null]) {
        const t = remote.mergeRuntimeTenant(TENANT, [], null, integration, 'org-1');
        assert.equal(t.business.calendar.calendar_id, 'puesto-a-mano@group.calendar.google.com');
    }
});

test('un calendario conectado solo se usa si el servidor tiene cliente OAuth y clave', conClave(() => {
    const cal = { calendar_id: 'clinica@gmail.com', provider: 'google_oauth', organization_id: 'org-1' };
    const tenant = { id: 't', business: { demo: false, calendar: cal } };
    const previo = process.env.GOOGLE_OAUTH_CLIENT_JSON;
    delete process.env.GOOGLE_OAUTH_CLIENT_JSON;
    oauth._resetForTests();
    const fichero = process.env.GOOGLE_OAUTH_CLIENT_FILE;
    delete process.env.GOOGLE_OAUTH_CLIENT_FILE;
    try {
        assert.equal(bookings.calCfg(tenant), null, 'sin cliente OAuth no se intenta');
        process.env.GOOGLE_OAUTH_CLIENT_JSON = JSON.stringify({ web: { client_id: 'id', client_secret: 'secret' } });
        oauth._resetForTests();
        assert.equal(bookings.calCfg(tenant), cal);
    } finally {
        if (previo === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_JSON; else process.env.GOOGLE_OAUTH_CLIENT_JSON = previo;
        if (fichero !== undefined) process.env.GOOGLE_OAUTH_CLIENT_FILE = fichero;
        oauth._resetForTests();
    }
}));

test('si la clínica desmarca un permiso necesario, no se da por conectada', () => {
    const todos = oauth.SCOPES.filter(s => s.startsWith('https://'));
    assert.equal(oauth.permisosSuficientes([...todos, 'openid', 'email']), true);
    assert.equal(oauth.permisosSuficientes(todos.slice(1)), false);
});

// ─── La vuelta de Google ───

function respuesta() {
    return { destino: null, redirect(_status, url) { this.destino = new URL(url); } };
}

test('una vuelta de Google con state falsificado no conecta nada', conClave(async () => {
    const res = respuesta();
    await callback({ query: { code: 'codigo', state: 'inventado.firma' } }, res);
    assert.equal(res.destino.searchParams.get('google'), 'error');
    assert.equal(res.destino.searchParams.get('org'), null, 'ni siquiera dice a qué negocio iba');
}));

test('si la clínica cancela en Google, vuelve al dashboard avisada', conClave(async () => {
    const res = respuesta();
    await callback({ query: { error: 'access_denied', state: secretBox.firmar({ o: 'org-1', u: 'user-1' }) } }, res);
    assert.equal(res.destino.searchParams.get('google'), 'cancelado');
    assert.equal(res.destino.searchParams.get('org'), 'org-1');
}));
