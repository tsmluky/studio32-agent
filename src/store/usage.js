'use strict';
// Uso por tenant (para el panel de Studio32): nº de mensajes y último uso.
const db = require('./_db');
const FILE = 'usage.json';
async function registrar(tenantId) {
    const u = db.leer(tenantId, FILE, { mensajes: 0, ultimo: null });
    u.mensajes = (u.mensajes || 0) + 1;
    u.ultimo = new Date().toISOString();
    db.escribir(tenantId, FILE, u);
}
async function leer(tenantId) { return db.leer(tenantId, FILE, { mensajes: 0, ultimo: null }); }
module.exports = { registrar, leer };
