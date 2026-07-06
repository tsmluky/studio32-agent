'use strict';

// Leads captados por tenant.

const db = require('./_db');
const FILE = 'leads.json';

async function listar(tenantId) {
    return db.leer(tenantId, FILE, []);
}
async function crear(tenantId, datos) {
    const all = await listar(tenantId);
    const lead = { id: db.id(), creado: new Date().toISOString(), ...datos };
    all.push(lead);
    db.escribir(tenantId, FILE, all);
    return lead;
}

module.exports = { listar, crear };
