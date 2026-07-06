'use strict';

// Onboarding: genera un tenant (borrador) a partir de los datos de un formulario,
// partiendo de una PLANTILLA por vertical. Es la herramienta comercial: el dueño
// rellena lo básico y su agente queda listo para probar en la misma reunión.
//
// El tenant se marca como borrador (_estado: "borrador"); Studio32 lo revisa y
// activa. handoff.email = email del dueño → en la demo, al reservar, le llega el
// aviso (requiere SMTP configurado en .env; si no, sale por consola).

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { PATHS } = require('./config');

const TEMPLATES = path.join(__dirname, '..', 'templates');

function leerJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fb; } }
function leerTexto(p) { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } }

function listarVerticales() {
    if (!fs.existsSync(TEMPLATES)) return [];
    return fs.readdirSync(TEMPLATES, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
}

// Carga una plantilla completa (para prerrellenar el formulario).
function cargarPlantilla(vertical) {
    const dir = path.join(TEMPLATES, vertical);
    if (!fs.existsSync(dir)) throw new Error(`Vertical desconocido: ${vertical}`);
    return {
        vertical,
        business: leerJSON(path.join(dir, 'business.json'), {}),
        services: leerJSON(path.join(dir, 'services.json'), { servicios: [] }),
        menu: leerJSON(path.join(dir, 'menu.json'), null),
        faq: leerTexto(path.join(dir, 'faq.md')),
        policies: leerTexto(path.join(dir, 'policies.md')),
        tone: leerTexto(path.join(dir, 'tone.md'))
    };
}

function slug(str) {
    return String(str || 'cliente')
        .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'cliente';
}
function idCorto() { return Math.random().toString(36).slice(2, 6); }

function faqDesdePares(pares) {
    if (!Array.isArray(pares) || !pares.length) return null;
    return pares.filter(p => p && p.p).map(p => `- ${p.p} ${p.r || ''}`.trim()).join('\n') + '\n';
}

// Crea el tenant en /tenants/<id>/ a partir de los datos del formulario.
// data: { vertical, nombre, agente_nombre, ciudad, email_avisos, whatsapp_number,
//         servicios[], profesionales[], horario, tono, faq[] }
function crearTenant(data) {
    if (!data || !data.vertical) throw new Error('Falta el vertical.');
    if (!data.nombre) throw new Error('Falta el nombre del negocio.');
    if (!data.email_avisos) throw new Error('Falta el email de avisos del dueño.');

    const tpl = cargarPlantilla(data.vertical);
    const tenantId = `${slug(data.nombre)}-${idCorto()}`;
    const dir = path.join(PATHS.tenants, tenantId);
    fs.mkdirSync(dir, { recursive: true });

    const business = {
        ...tpl.business,
        nombre: data.nombre,
        agente_nombre: data.agente_nombre || tpl.business.agente_nombre || 'Recepción',
        ciudad: data.ciudad || tpl.business.ciudad || '',
        whatsapp_number: data.whatsapp_number || '',
        profesionales: (Array.isArray(data.profesionales) && data.profesionales.length) ? data.profesionales : tpl.business.profesionales,
        horario: data.horario || tpl.business.horario,
        horario_texto: data.horario_texto || tpl.business.horario_texto,
        ...(data.capacidad || tpl.business.capacidad ? { capacidad: data.capacidad || tpl.business.capacidad } : {}),
        calendar: { calendar_id: '', timezone: (tpl.business.calendar && tpl.business.calendar.timezone) || 'Europe/Madrid' },
        owner: { nombre: data.owner_nombre || '', token: crypto.randomBytes(24).toString('hex'), whatsapp: data.whatsapp_avisos || '' },
        _estado: 'borrador',
        _vertical: data.vertical,
        _creado: new Date().toISOString()
    };

    const services = (Array.isArray(data.servicios) && data.servicios.length)
        ? { servicios: data.servicios }
        : tpl.services;

    fs.writeFileSync(path.join(dir, 'business.json'), JSON.stringify(business, null, 2));
    fs.writeFileSync(path.join(dir, 'services.json'), JSON.stringify(services, null, 2));
    fs.writeFileSync(path.join(dir, 'faq.md'), faqDesdePares(data.faq) || tpl.faq || '');
    fs.writeFileSync(path.join(dir, 'policies.md'), tpl.policies || '');
    fs.writeFileSync(path.join(dir, 'tone.md'), (data.tono && data.tono.trim()) ? data.tono : tpl.tone || '');
    const menu = data.menu || tpl.menu;
    if (menu) fs.writeFileSync(path.join(dir, 'menu.json'), JSON.stringify(menu, null, 2));
    fs.writeFileSync(path.join(dir, 'handoff.json'), JSON.stringify({
        email: data.email_avisos,
        whatsapp: data.whatsapp_avisos || '',
        _nota: 'Aquí llegan avisos de reservas, cancelaciones y leads. Email del dueño capturado en el onboarding.'
    }, null, 2));

    return { tenantId, estado: 'borrador', owner_token: business.owner.token };
}

module.exports = { listarVerticales, cargarPlantilla, crearTenant };
