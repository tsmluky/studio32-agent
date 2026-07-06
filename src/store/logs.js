'use strict';

// Log de eventos por tenant (handoffs, errores de negocio, etc.). Persistente.

const db = require('./_db');
const FILE = 'logs.json';

async function registrar(tenantId, tipo, datos) {
    const all = db.leer(tenantId, FILE, []);
    all.push({ ts: new Date().toISOString(), tipo, ...datos });
    db.escribir(tenantId, FILE, all);
}
async function listar(tenantId) {
    return db.leer(tenantId, FILE, []);
}

module.exports = { registrar, listar };
