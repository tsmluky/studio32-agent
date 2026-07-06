'use strict';

// Devuelve el catálogo de servicios del tenant (nombre, precio, duración).

module.exports = {
    schema: {
        type: 'function',
        function: {
            name: 'getServices',
            description: 'Devuelve la lista de servicios del negocio con precio y duración. Úsala si el cliente pregunta qué servicios hay, precios o cuánto dura algo.',
            parameters: { type: 'object', properties: {} }
        }
    },
    async run(_args, ctx) {
        const arr = (ctx.tenant.services.servicios || []).map(s => ({
            nombre: s.nombre, precio_eur: s.precio_eur, duracion_min: s.duracion_min
        }));
        return JSON.stringify({ servicios: arr });
    }
};
