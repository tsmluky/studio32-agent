'use strict';

// Registro central de herramientas. Las marcadas en OWNER_ONLY solo se ofrecen y
// ejecutan en modo dueño (ctx.esOwner) — defensa en profundidad para no exponer
// datos del negocio a un cliente cualquiera. getMenu solo se ofrece si el tenant
// tiene carta (menu.json).

const REGISTRO = {
    getServices: require('./getServices'),
    getMenu: require('./getMenu'),
    checkAvailability: require('./checkAvailability'),
    createBooking: require('./createBooking'),
    cancelBooking: require('./cancelBooking'),
    rescheduleBooking: require('./rescheduleBooking'),
    registerLead: require('./registerLead'),
    handoffHuman: require('./handoffHuman'),
    getAgenda: require('./getAgenda')
};
const OWNER_ONLY = ['getAgenda'];

function schemas(opts = {}) {
    return Object.entries(REGISTRO)
        .filter(([nombre]) => !OWNER_ONLY.includes(nombre) || opts.owner)
        .filter(([nombre]) => nombre !== 'getMenu' || (opts.tenant && opts.tenant.menu))
        .map(([, t]) => t.schema);
}

async function ejecutar(nombre, args, ctx) {
    const tool = REGISTRO[nombre];
    if (!tool) return 'ERROR: herramienta desconocida.';
    if (OWNER_ONLY.includes(nombre) && !ctx.esOwner) return 'ERROR: solo el dueño puede usar esta herramienta.';
    return tool.run(args, ctx);
}

module.exports = { schemas, ejecutar };
