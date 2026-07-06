'use strict';

// Chequeo de configuración: ¿qué está listo y qué falta para operar?
//   npm run check
// No envía nada ni necesita red. Útil para "pegar las claves mañana y listo".

require('./config'); // carga .env
const fs = require('fs');
const path = require('path');
const llm = require('./llm');
const gcal = require('./integrations/googleCalendar');
const { PATHS } = require('./config');

const V = '\x1b[32m✓\x1b[0m';
const X = '\x1b[31m✗\x1b[0m';
const D = '\x1b[33m–\x1b[0m';
const has = (v) => !!(v && String(v).trim());

function line(ok, label, detalle) {
    const mark = ok === true ? V : ok === false ? X : D;
    console.log(`  ${mark} ${label}${detalle ? '  ' + detalle : ''}`);
}

console.log('\n=== Studio32 Agent · chequeo de configuración ===\n');

console.log('Motor LLM');
line(true, `Proveedor activo: ${llm.PROVIDER}`, llm.PROVIDER === 'mock' ? '(simulación, sin coste)' : `(modelo ${llm.MODEL})`);
line(has(process.env.OPENAI_API_KEY), 'OPENAI_API_KEY');
line(has(process.env.DEEPSEEK_API_KEY), 'DEEPSEEK_API_KEY');

console.log('\nWhatsApp · Twilio (BSP)');
line(has(process.env.TWILIO_ACCOUNT_SID), 'TWILIO_ACCOUNT_SID');
line(has(process.env.TWILIO_AUTH_TOKEN), 'TWILIO_AUTH_TOKEN');
line(has(process.env.TWILIO_WHATSAPP_NUMBER), 'TWILIO_WHATSAPP_NUMBER', process.env.TWILIO_WHATSAPP_NUMBER || '');

console.log('\nWhatsApp · Meta Cloud API (directo)');
line(has(process.env.META_ACCESS_TOKEN), 'META_ACCESS_TOKEN');
line(has(process.env.META_PHONE_NUMBER_ID), 'META_PHONE_NUMBER_ID');
line(has(process.env.META_VERIFY_TOKEN), 'META_VERIFY_TOKEN', has(process.env.META_VERIFY_TOKEN) ? '' : '(elige uno)');

console.log('\nGoogle Calendar (agenda de reservas)');
line(gcal.disponible(), 'Credenciales (GOOGLE_CREDENTIALS_FILE/JSON)', gcal.disponible() ? '' : 'sin credenciales → reservas en JSON');

console.log('\nAvisos por email (SMTP)');
line(has(process.env.SMTP_HOST), 'SMTP_HOST');
line(has(process.env.SMTP_USER), 'SMTP_USER');
line(has(process.env.SMTP_PASS), 'SMTP_PASS');

console.log('\nTenants');
const dirs = fs.existsSync(PATHS.tenants)
    ? fs.readdirSync(PATHS.tenants, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
    : [];
if (!dirs.length) line(false, 'No hay tenants en /tenants');
for (const id of dirs) {
    let business = {}, services = { servicios: [] }, handoff = {};
    try { business = JSON.parse(fs.readFileSync(path.join(PATHS.tenants, id, 'business.json'), 'utf8')); } catch (_) {}
    try { services = JSON.parse(fs.readFileSync(path.join(PATHS.tenants, id, 'services.json'), 'utf8')); } catch (_) {}
    try { handoff = JSON.parse(fs.readFileSync(path.join(PATHS.tenants, id, 'handoff.json'), 'utf8')); } catch (_) {}
    const calId = business.calendar && business.calendar.calendar_id;
    console.log(`  • ${id}`);
    line(true, `  servicios: ${(services.servicios || []).length}`);
    line(has(business.whatsapp_number) && !business.whatsapp_number.includes('600000000'), '  whatsapp_number', business.whatsapp_number || 'sin definir');
    line(has(calId), '  calendar_id', has(calId) ? 'puesto' : 'vacío → reservas en JSON');
    line(has(handoff.email) || has(handoff.whatsapp), '  destino de avisos (handoff)', (handoff.email || handoff.whatsapp || 'sin definir'));
}

console.log('\nResumen');
const listoLLM = has(process.env.OPENAI_API_KEY) || llm.PROVIDER === 'mock';
line(true, 'Probar HOY por webchat/CLI (modo simulación)', listoLLM ? 'listo' : '');
const keyReal = has(process.env.OPENAI_API_KEY) || has(process.env.DEEPSEEK_API_KEY);
line(keyReal, 'Conversación con IA real', keyReal ? `listo (${llm.PROVIDER})` : 'falta una API key (OpenAI o DeepSeek)');
const listoTw = has(process.env.TWILIO_ACCOUNT_SID) && has(process.env.TWILIO_AUTH_TOKEN) && has(process.env.TWILIO_WHATSAPP_NUMBER);
line(listoTw, 'Operar por WhatsApp (Twilio)', listoTw ? 'listo' : 'faltan datos de Twilio');
const listoMeta = has(process.env.META_ACCESS_TOKEN) && has(process.env.META_PHONE_NUMBER_ID);
line(listoMeta, 'Operar por WhatsApp (Meta Cloud API)', listoMeta ? 'listo' : 'faltan META_ACCESS_TOKEN / META_PHONE_NUMBER_ID');
console.log('');
