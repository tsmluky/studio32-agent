'use strict';

// Capa de persistencia mínima en archivos JSON, por tenant, dentro de /data.
// IMPORTANTE: es deliberadamente simple para v0.1. Toda la app habla con los
// módulos store/* (no con esto directamente), así que migrar a PostgreSQL más
// adelante solo implica reescribir esta capa, sin tocar tools ni orchestrator.

const fs = require('fs');
const path = require('path');
const { PATHS } = require('../config');

function archivo(tenantId, nombre) {
    const dir = path.join(PATHS.data, tenantId);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, nombre);
}
function leer(tenantId, nombre, fallback) {
    try { return JSON.parse(fs.readFileSync(archivo(tenantId, nombre), 'utf8')); }
    catch (_) { return fallback; }
}
function escribir(tenantId, nombre, data) {
    fs.writeFileSync(archivo(tenantId, nombre), JSON.stringify(data, null, 2));
}
function id() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

module.exports = { leer, escribir, id };
