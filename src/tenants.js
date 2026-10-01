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
    if (typeof tenantId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(tenantId)) {
        throw new Error('Identificador de tenant no válido.');
    }
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

// Nombre de la variable de entorno con el token de dueño de un tenant:
// `barberia_demo` → OWNER_TOKEN_BARBERIA_DEMO.
function varDeToken(tenantId) {
    return 'OWNER_TOKEN_' + String(tenantId).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

// El token de dueño NO vive en business.json cuando el tenant está versionado: este
// repositorio es público y ese token da permisos de dueño (ver la agenda completa,
// entre otras cosas). Manda el entorno; el archivo solo se usa para los tenants del
// volumen, que se crean en caliente desde /onboarding y nunca se versionan.
// Si no hay ni lo uno ni lo otro, el tenant se queda sin modo dueño, que es el fallo
// seguro: nadie entra, en vez de entrar cualquiera.
function aplicarTokenDeDueno(tenantId, business) {
    const delEntorno = process.env[varDeToken(tenantId)];
    if (!delEntorno) return;
    business.owner = business.owner || {};
    business.owner.token = delEntorno;
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
    aplicarTokenDeDueno(tenantId, tenant.business);
    cache.set(tenantId, tenant);
    return tenant;
}

// Tenant por defecto para CLI/utilidades. Los webhooks no usan este fallback:
// un destino desconocido debe descartarse, sin atenderlo como otro negocio.
//
// Antes esto era `cargarTenant(process.env.DEFAULT_TENANT)` a pelo, y si esa
// variable apuntaba a un tenant que ya no existe —pasó: quedó apuntando a un
// cliente cuyos archivos salieron del repo— el canal entero dejaba de responder,
// en silencio y solo en producción. Un ajuste de configuración no puede tumbar
// WhatsApp: si el de la variable no está, se usa cualquier tenant de demostración
// y se avisa por consola, bien fuerte.
let avisadoPorDefecto = false;
function tenantPorDefecto() {
    const pedido = process.env.DEFAULT_TENANT || 'barberia_demo';
    if (dirDeTenant(pedido)) return cargarTenant(pedido);

    const alternativa = listarTenantIds().find(id => /demo|cobalto/i.test(id));
    if (!avisadoPorDefecto) {
        avisadoPorDefecto = true;
        console.error(`[tenants] DEFAULT_TENANT="${pedido}" no existe. ` +
            (alternativa ? `Atendiendo con "${alternativa}" mientras tanto. Corrige la variable.`
                : 'Y no hay ningún tenant de demostración al que caer.'));
    }
    if (!alternativa) throw new Error(`Tenant por defecto no encontrado: ${pedido}`);
    return cargarTenant(alternativa);
}

// Resuelve el tenant por el número de WhatsApp del NEGOCIO (el "To" del webhook).
// Así un mismo backend atiende a varios clientes. Si no encuentra, devuelve null
// El canal descarta números no asignados o ambiguos.
function resolverTenantPorNumero(numeroDestino) {
    if (!numeroDestino) return null;
    const objetivo = String(numeroDestino).replace(/[^0-9]/g, '');
    if (!objetivo) return null;
    let encontrado = null;
    for (const id of listarTenantIds()) {
        const t = cargarTenant(id);
        const num = String(t.business.whatsapp_number || '').replace(/[^0-9]/g, '');
        if (num && objetivo === num) {
            if (encontrado) return null; // Configuración ambigua: no elegir una clínica arbitraria.
            encontrado = t;
        }
    }
    return encontrado;
}

module.exports = { cargarTenant, resolverTenantPorNumero, listarTenantIds, dirDeTenant, tenantPorDefecto };
