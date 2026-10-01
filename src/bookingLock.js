'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
const queues = new Map();

// Protege comprobación + escritura dentro de UN proceso. No es un lock entre
// réplicas; antes de escalarlas hace falta exclusión transaccional en la DB.
async function serializar(tenantId, work) {
    const held = context.getStore();
    if (held?.get(tenantId)?.active) return work();
    const previous = queues.get(tenantId) || Promise.resolve();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const tail = previous.then(() => gate);
    queues.set(tenantId, tail);
    await previous;
    // Los hijos asíncronos pueden sobrevivir al callback. Comparten un token
    // revocable: no heredan permiso de reentrada una vez liberado el lock.
    const token = { active: true };
    const owned = new Map(held || []); owned.set(tenantId, token);
    try { return await context.run(owned, work); }
    finally { token.active = false; release(); if (queues.get(tenantId) === tail) queues.delete(tenantId); }
}

function proteger(run) {
    return (args, ctx) => serializar(ctx.tenantId, async () => {
        if (ctx.puedeActuar && !await ctx.puedeActuar()) return 'ERROR: el agente ya no tiene el control de la conversación.';
        return run(args, ctx);
    });
}

module.exports = { serializar, proteger };
