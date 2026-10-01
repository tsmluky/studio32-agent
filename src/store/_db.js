'use strict';

// Capa de persistencia mínima en archivos JSON, por tenant, dentro de /data.
// IMPORTANTE: es deliberadamente simple para v0.1. Toda la app habla con los
// módulos store/* (no con esto directamente), así que migrar a PostgreSQL más
// adelante solo implica reescribir esta capa, sin tocar tools ni orchestrator.

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const { PATHS } = require('../config');

function archivo(tenantId, nombre) {
    if (typeof tenantId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(tenantId) || typeof nombre !== 'string' || !/^[a-zA-Z0-9_-]+\.json$/.test(nombre)) {
        throw new Error('Ruta de persistencia no válida.');
    }
    const dir = path.join(PATHS.data, tenantId);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, nombre);
}
function leer(tenantId, nombre, fallback) {
    try { return JSON.parse(fs.readFileSync(archivo(tenantId, nombre), 'utf8')); }
    catch (error) {
        if (error.code === 'ENOENT') return fallback;
        throw error; // Un archivo corrupto no es una agenda vacía.
    }
}
function escribir(tenantId, nombre, data) {
    const destination = archivo(tenantId, nombre);
    const temporary = destination + '.' + crypto.randomUUID() + '.tmp';
    let descriptor;
    try {
        descriptor = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(descriptor, JSON.stringify(data, null, 2));
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor); descriptor = undefined;
        fs.renameSync(temporary, destination);
    } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}
function id() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

module.exports = { leer, escribir, id };
