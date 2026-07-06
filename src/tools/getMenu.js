'use strict';

// Devuelve la carta del restaurante (secciones, platos, precios, alérgenos).
// Solo disponible si el tenant tiene menu.json. El agente NUNCA debe inventar
// platos ni alérgenos: lo que no esté aquí, no existe.

module.exports = {
    schema: {
        type: 'function',
        function: {
            name: 'getMenu',
            description: 'Devuelve la carta del restaurante: secciones, platos, precios y alérgenos. Úsala SIEMPRE que pregunten por la carta, un plato, precios de comida o alérgenos. No inventes platos: responde solo con lo que devuelva.',
            parameters: {
                type: 'object',
                properties: {
                    seccion: { type: 'string', description: 'Sección concreta (ej. Entrantes, Postres). Opcional.' },
                    busqueda: { type: 'string', description: 'Texto a buscar en nombres y descripciones de platos (ej. "arroz", "sin gluten"). Opcional.' }
                }
            }
        }
    },
    async run(args, ctx) {
        const menu = ctx.tenant.menu;
        if (!menu || !Array.isArray(menu.secciones) || !menu.secciones.length) {
            return JSON.stringify({ error: 'Este negocio no tiene carta cargada. Responde con la información de servicios y FAQ, sin inventar platos.' });
        }

        let secciones = menu.secciones;
        if (args && args.seccion) {
            const q = String(args.seccion).toLowerCase();
            const filtradas = secciones.filter(s => (s.nombre || '').toLowerCase().includes(q));
            if (filtradas.length) secciones = filtradas;
        }
        if (args && args.busqueda) {
            const q = String(args.busqueda).toLowerCase();
            secciones = secciones
                .map(s => ({
                    ...s,
                    platos: (s.platos || []).filter(p =>
                        (p.nombre || '').toLowerCase().includes(q) ||
                        (p.descripcion || '').toLowerCase().includes(q) ||
                        (Array.isArray(p.alergenos) && p.alergenos.some(a => String(a).toLowerCase().includes(q)))
                    )
                }))
                .filter(s => s.platos.length);
            if (!secciones.length) {
                return JSON.stringify({ resultado: 'sin_coincidencias', nota: 'Nada en la carta coincide con esa búsqueda. Dilo con naturalidad y ofrece la carta completa o derivar la duda al equipo.' });
            }
        }

        return JSON.stringify({ menu_del_dia: menu.menu_del_dia || null, secciones });
    }
};
