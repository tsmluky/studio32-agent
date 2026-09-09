'use strict';

// Carga y cachea la configuración de cada cliente (tenant) desde tenants/<id>/.
// Un tenant = un negocio. Su "base de conocimiento" son archivos editables:
// business.json, services.json, faq.md, policies.md, tone.md, handoff.json.

const fs = require('fs');
const path = require('path');
const { PATHS } = require('./config');

const cache = new Map();

function leerJSON(p, fallback) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (_) { return fallback; }
}
function leerTexto(p) {
    try { return fs.readFileSync(p, 'utf8').trim(); }
    catch (_) { return ''; }
}

// Carpeta de un tenant. Runtime (volumen, creados desde /onboarding) tiene
// prioridad sobre el repo, para poder corregir en caliente un tenant de demo sin
// desplegar. Devuelve null si no existe en ninguna de las dos raíces.
function dirDeTenant(tenantId) {
    for (const raiz of [PATHS.tenantsRuntime, PATHS.tenants]) {
        const dir = path.join(raiz, tenantId);
        if (fs.existsSync(dir)) return dir;
    }
    return null;
}

// Todos los ids disponibles, de las dos raíces y sin repetir.
function listarTenantIds() {
    const ids = new Set();
    for (const raiz of [PATHS.tenantsRuntime, PATHS.tenants]) {
        if (!fs.existsSync(raiz)) continue;
        for (const d of fs.readdirSync(raiz, { withFileTypes: true })) {
            if (d.isDirectory()) ids.add(d.name);
        }
    }
    return [...ids];
}

function cargarTenant(tenantId) {
    if (cache.has(tenantId)) return cache.get(tenantId);
    const dir = dirDeTenant(tenantId);
    if (!dir) throw new Error(`Tenant no encontrado: ${tenantId}`);

    const tenant = {
        id: tenantId,
        business: leerJSON(path.join(dir, 'business.json'), {}),
        services: leerJSON(path.join(dir, 'services.json'), { servicios: [] }),
        handoff: leerJSON(path.join(dir, 'handoff.json'), {}),
        menu: leerJSON(path.join(dir, 'menu.json'), null),
        faq: leerTexto(path.join(dir, 'faq.md')),
        policies: leerTexto(path.join(dir, 'policies.md')),
        tone: leerTexto(path.join(dir, 'tone.md'))
    };
    cache.set(tenantId, tenant);
    return tenant;
}

// Resuelve el tenant por el número de WhatsApp del NEGOCIO (el "To" del webhook).
// Así un mismo backend atiende a varios clientes. Si no encuentra, devuelve null
// y el canal usa DEFAULT_TENANT.
function resolverTenantPorNumero(numeroDestino) {
    if (!numeroDestino) return null;
    const objetivo = numeroDestino.replace('whatsapp:', '');
    for (const id of listarTenantIds()) {
        const t = cargarTenant(id);
        const num = (t.business.whatsapp_number || '').replace('whatsapp:', '');
        if (num && objetivo.includes(num)) return t;
    }
    return null;
}

module.exports = { cargarTenant, resolverTenantPorNumero, listarTenantIds, dirDeTenant };
