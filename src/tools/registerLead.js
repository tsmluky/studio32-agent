'use strict';

// Registra un lead cualificado (heredado de studio32-customerbot) y avisa al
// equipo. Útil para tenants orientados a captación (p. ej. el propio Studio32).

const { leads } = require('../store');
const { notificarLead } = require('../notify');

module.exports = {
    schema: {
        type: 'function',
        function: {
            name: 'registerLead',
            description: 'Registra un lead cualificado y avisa al equipo. Úsala solo cuando el cliente confirme que quiere que le contacten y tengas al menos nombre y contacto.',
            parameters: {
                type: 'object',
                properties: {
                    nombre: { type: 'string' },
                    contacto: { type: 'string', description: 'Teléfono o email. Imprescindible.' },
                    tipo_negocio: { type: 'string' },
                    ciudad: { type: 'string' },
                    necesidad: { type: 'string', description: 'Resumen en una frase, con las palabras del cliente.' },
                    preferencia_contacto: { type: 'string' }
                },
                required: ['nombre', 'contacto']
            }
        }
    },
    async run(args, ctx) {
        if (!args.nombre || !args.contacto) return 'ERROR: faltan nombre o contacto.';
        const lead = await leads.crear(ctx.tenantId, {
            ...args,
            telefono_cliente: (ctx.telefono || '').replace('whatsapp:', '')
        });
        try { await notificarLead(ctx.tenant, lead); }
        catch (err) { console.error('Aviso de lead falló:', err.message); }
        return `OK: lead registrado (id ${lead.id}).`;
    }
};
