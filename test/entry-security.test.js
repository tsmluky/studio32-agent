'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Entorno sintético, sin credenciales ni peticiones a servicios externos.
for (const name of ['OPENAI_API_KEY','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','META_ACCESS_TOKEN','META_PHONE_NUMBER_ID','META_VERIFY_TOKEN','META_APP_SECRET','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_WEBHOOK_URL','TWILIO_WHATSAPP_NUMBER','TWILIO_SANDBOX_TENANT','ONBOARDING_TOKEN','SMOKE_TOKEN','RESEND_API_KEY','SMTP_USER','SMTP_PASS','GOOGLE_CREDENTIALS_FILE','GOOGLE_CREDENTIALS_JSON']) process.env[name] = '';
process.env.LLM_PROVIDER = 'mock';
process.env.RECORDATORIOS = 'off';
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'studio32-entry-test-'));
process.env.DATA_DIR = isolated;
const cfg = require('../src/config');
cfg.PATHS.tenants = path.join(isolated, 'source-tenants');
const orq = require('../src/orchestrator');
const seen = [];
orq.responder = async (ctx, msg) => { seen.push({ ctx, msg }); return 'Respuesta sintética'; };
const { app } = require('../src/server');
const tenants = require('../src/tenants');
const onboarding = require('../src/onboarding');
const twilio = require('twilio');

function fixture(id, business) {
    const dir = path.join(cfg.PATHS.tenants, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'business.json'), JSON.stringify(business));
}
fixture('clinica_test', { demo: false, owner: { token: 'owner-sintetico' }, whatsapp_number: '+34600000101' });
fixture('demo_test', { demo: true, whatsapp_number: '+34600000102' });
fixture('studio32', { demo: false });
fixture('duplicado_a', { demo: true, whatsapp_number: '+34600000103' });
fixture('duplicado_b', { demo: true, whatsapp_number: '+34600000103' });
let server, base;
test.before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    // Solo la carpeta creada por mkdtemp para esta prueba.
    fs.rmSync(isolated, { recursive: true, force: true });
});
test.beforeEach(() => {
    seen.length = 0;
    for (const key of ['META_APP_SECRET','META_VERIFY_TOKEN','ONBOARDING_TOKEN','SMOKE_TOKEN','TWILIO_WHATSAPP_NUMBER','TWILIO_SANDBOX_TENANT']) process.env[key] = '';
    process.env.TWILIO_AUTH_TOKEN = 'twilio-sintetico';
    process.env.TWILIO_WEBHOOK_URL = 'https://backend.example.test/whatsapp/webhook';
});

async function post(route, body, headers = {}) {
    return fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}
function payload(number = '34600000101') {
    return { entry: [{ changes: [{ value: { metadata: { display_phone_number: number }, messages: [{ id: 'wamid.sintetico', from: '34600000999', type: 'text', text: { body: 'Hola clínica' } }] } }] }] };
}
function metaSignature(body) {
    return 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(body).digest('hex');
}
async function settled() { await new Promise(resolve => setImmediate(resolve)); }

test('chat público no puede acceder a clínica ni suplantar su teléfono', async () => {
    const response = await post('/chat', { tenant: 'clinica_test', sesion: '+34600000999', mensaje: 'Cancela mi cita' });
    assert.equal(response.status, 403);
    assert.equal(seen.length, 0);
    assert.equal((await post('/chat', { tenant: 'clinica_test', sesion: 'x', mensaje: 'Hola', ownerToken: 'incorrecto' })).status, 403);
});

test('widget Studio32 y demo siguen públicos, con identidad web separada en negocio real', async () => {
    assert.equal((await post('/chat', { tenant: 'studio32', sesion: '+34600000999', mensaje: 'Hola' })).status, 200);
    assert.equal(seen[0].ctx.telefono, 'web:+34600000999');
    assert.equal(seen[0].ctx.esOwner, false);
    assert.equal((await post('/chat', { tenant: 'demo_test', sesion: 'sesion-demo', mensaje: 'Hola' })).status, 200);
    assert.equal(seen[1].ctx.telefono, 'sesion-demo');
    assert.equal((await fetch(base + '/demo/estado?tenant=demo_test&sesion=sesion-demo')).status, 200);
    assert.equal((await fetch(base + '/widget.js')).status, 200);
});

test('el teléfono elegido en widget no permite encontrar ni cancelar la cita WhatsApp real', async () => {
    const bookings = require('../src/store/bookings');
    const cancel = require('../src/tools/cancelBooking');
    const dir = path.join(isolated, 'studio32');
    fs.mkdirSync(dir, { recursive: true });
    const cita = { id: 'cita-real-sintetica', estado: 'confirmada', fecha: '04/10/2030', hora: '10:00', servicio: 'Revisión', telefono_cliente: '+34600000999', contacto: '+34600000999' };
    fs.writeFileSync(path.join(dir, 'bookings.json'), JSON.stringify([cita]));
    assert.equal((await post('/chat', { tenant: 'studio32', sesion: '+34600000999', mensaje: 'Cancela mi cita' })).status, 200);
    const ctx = seen[0].ctx;
    assert.deepEqual(await bookings.activasDeCliente(ctx.tenant, { telefono: ctx.telefono }), []);
    assert.match(await cancel.run({}, ctx), /^ERROR/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'bookings.json')))[0].estado, 'confirmada');
});

test('owner y smoke autorizan prueba de clínica sin adoptar identidad WhatsApp', async () => {
    process.env.SMOKE_TOKEN = 'smoke-sintetico';
    assert.equal((await post('/chat', { tenant: 'clinica_test', sesion: '+34600000999', mensaje: 'Hola', ownerToken: 'owner-sintetico' })).status, 200);
    assert.equal(seen[0].ctx.esOwner, true);
    assert.equal(seen[0].ctx.telefono, 'web:+34600000999');
    assert.equal((await post('/chat', { tenant: 'clinica_test', sesion: '+34600000999', mensaje: 'Hola' }, { 'X-Smoke-Token': 'smoke-sintetico' })).status, 200);
    assert.equal(seen[1].ctx.esOwner, false);
    process.env.SMOKE_TOKEN = '';
});

test('rechaza traversal y sesiones estructuradas sin invocar agente', async () => {
    assert.equal((await post('/chat', { tenant: '../outside', sesion: 'x', mensaje: 'Hola' })).status, 400);
    assert.equal((await post('/chat', { tenant: 'studio32', sesion: { phone: '600000999' }, mensaje: 'Hola' })).status, 400);
    assert.equal((await post('/chat', { tenant: 'demo_test', sesion: '__proto__', mensaje: 'Hola' })).status, 400);
    assert.throws(() => tenants.dirDeTenant('../outside'), /no válido/);
    assert.throws(() => onboarding.cargarPlantilla('../tenants'), /no válido/);
    assert.equal(seen.length, 0);
});

test('alta interna exige configuración y token válido', async (t) => {
    process.env.ONBOARDING_TOKEN = '';
    assert.equal((await post('/onboarding/api/crear', {})).status, 503);
    process.env.ONBOARDING_TOKEN = 'alta-sintetica';
    assert.equal((await post('/onboarding/api/crear', {})).status, 401);
    t.mock.method(onboarding, 'crearTenant', () => ({ tenantId: 'nueva-demo', owner_token: 'sintetico' }));
    assert.equal((await post('/onboarding/api/crear', { token: 'alta-sintetica' })).status, 200);
    process.env.ONBOARDING_TOKEN = '';
});

test('Meta rechaza sin secreto, sin firma o con cuerpo manipulado antes de procesar', async () => {
    const body = JSON.stringify(payload());
    process.env.META_APP_SECRET = '';
    assert.equal((await post('/whatsapp/meta/webhook', body)).status, 503);
    process.env.META_APP_SECRET = 'meta-sintetico';
    assert.equal((await post('/whatsapp/meta/webhook', body)).status, 403);
    assert.equal((await post('/whatsapp/meta/webhook', body, { 'X-Hub-Signature-256': 'sha256=xyz' })).status, 403);
    assert.equal((await post('/whatsapp/meta/webhook', body + ' ', { 'X-Hub-Signature-256': metaSignature(body) })).status, 403);
    assert.equal(seen.length, 0);
});

test('Meta acepta firma del cuerpo original con espacios y UTF-8', async () => {
    process.env.META_APP_SECRET = 'meta-sintetico';
    const p = payload(); p.entry[0].changes[0].value.messages[0].text.body = '¡Hola, revisión!';
    const body = JSON.stringify(p, null, 2);
    assert.equal((await post('/whatsapp/meta/webhook', body, { 'X-Hub-Signature-256': metaSignature(body) })).status, 200);
    await settled();
    assert.equal(seen[0].ctx.tenantId, 'clinica_test');
    assert.equal(seen[0].msg, '¡Hola, revisión!');
});

test('Meta no envía al proveedor una respuesta generada si recepción ya tomó el control', async t => {
    const conversations = require('../src/store/conversations');
    t.mock.method(conversations, 'controlMode', async () => 'human');
    process.env.META_APP_SECRET = 'meta-sintetico';
    process.env.META_ACCESS_TOKEN = 'token-envio-sintetico';
    process.env.META_PHONE_NUMBER_ID = 'phone-test';
    const originalFetch = global.fetch;
    let sends = 0;
    t.mock.method(global, 'fetch', async (url, options) => {
        if (String(url).startsWith('https://graph.facebook.com/')) { sends++; return { ok:true }; }
        if (String(url).startsWith(base)) return originalFetch(url, options);
        throw new Error('Red externa bloqueada');
    });
    try {
        const body = JSON.stringify(payload());
        assert.equal((await post('/whatsapp/meta/webhook', body, { 'X-Hub-Signature-256':metaSignature(body) })).status, 200);
        await settled();
        assert.equal(seen.length, 1);
        assert.equal(sends, 0);
    } finally {
        process.env.META_ACCESS_TOKEN = ''; process.env.META_PHONE_NUMBER_ID = '';
    }
});

test('chat no entrega texto pendiente cuando recepción tomó el control', async t => {
    const conversations = require('../src/store/conversations');
    t.mock.method(conversations, 'controlMode', async () => 'human');
    const response = await post('/chat', { tenant:'studio32', sesion:'prueba-takeover', mensaje:'Hola' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).respuesta, null);
});

test('Meta no verifica GET sin token configurado ni enruta números desconocidos', async () => {
    process.env.META_APP_SECRET = 'meta-sintetico';
    process.env.META_VERIFY_TOKEN = '';
    assert.equal((await fetch(base + '/whatsapp/meta/webhook?hub.mode=subscribe&hub.challenge=abc')).status, 403);
    process.env.META_VERIFY_TOKEN = 'verify-sintetico';
    const verified = await fetch(base + '/whatsapp/meta/webhook?hub.mode=subscribe&hub.challenge=abc&hub.verify_token=verify-sintetico');
    assert.equal(verified.status, 200); assert.equal(await verified.text(), 'abc');
    for (const number of ['34600000101extra9', '34600000103']) {
        const body = JSON.stringify(payload(number));
        assert.equal((await post('/whatsapp/meta/webhook', body, { 'X-Hub-Signature-256': metaSignature(body) })).status, 200);
    }
    await settled(); assert.equal(seen.length, 0);
});

test('resolución por número exige coincidencia exacta y asignación única', () => {
    assert.equal(tenants.resolverTenantPorNumero('whatsapp:+34 600 000 101').id, 'clinica_test');
    assert.equal(tenants.resolverTenantPorNumero('+346000001019'), null);
    assert.equal(tenants.resolverTenantPorNumero('+34600000103'), null);
});

async function twilioPost(fields, signature, route = '/whatsapp/webhook', extra = {}) {
    return fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(signature ? { 'X-Twilio-Signature': signature } : {}), ...extra }, body: new URLSearchParams(fields).toString() });
}

test('Twilio exige firma, URL configurada y formulario; no confía en proxy o Host', async () => {
    const fields = { From: 'whatsapp:+34600000999', To: 'whatsapp:+34600000101', Body: 'Hola', MessageSid: 'SMsintetico' };
    process.env.TWILIO_AUTH_TOKEN = 'twilio-sintetico'; process.env.TWILIO_WEBHOOK_URL = '';
    assert.equal((await twilioPost(fields)).status, 503);
    process.env.TWILIO_WEBHOOK_URL = 'https://backend.example.test/whatsapp/webhook';
    assert.equal((await twilioPost(fields)).status, 403);
    assert.equal((await post('/whatsapp/webhook', fields)).status, 415);
    const signature = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, process.env.TWILIO_WEBHOOK_URL, fields);
    assert.equal((await twilioPost({ ...fields, Body: 'Cambió' }, signature)).status, 403);
    assert.equal((await twilioPost(fields, signature, '/whatsapp/webhook?otro=1')).status, 403);
    assert.equal(seen.length, 0);
    assert.equal((await twilioPost(fields, signature, '/whatsapp/webhook', { 'X-Forwarded-Host': 'atacante.example' })).status, 200);
    await settled(); assert.equal(seen[0].ctx.tenantId, 'clinica_test');
});

test('Twilio descarta desconocidos y sandbox solo puede elegir demo explícita', async () => {
    const fields = { From: 'whatsapp:+34600000999', To: 'whatsapp:+34600000777', Body: 'Hola' };
    process.env.TWILIO_WHATSAPP_NUMBER = fields.To;
    const signature = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, process.env.TWILIO_WEBHOOK_URL, fields);
    assert.equal((await twilioPost(fields, signature)).status, 200);
    await settled(); assert.equal(seen.length, 0);
    process.env.TWILIO_SANDBOX_TENANT = 'clinica_test';
    assert.equal((await twilioPost(fields, signature)).status, 200);
    await settled(); assert.equal(seen.length, 0);
    process.env.TWILIO_SANDBOX_TENANT = 'demo_test';
    assert.equal((await twilioPost(fields, signature)).status, 200);
    await settled(); assert.equal(seen[0].ctx.tenantId, 'demo_test');
});
