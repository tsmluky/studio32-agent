'use strict';

// Deriva la conversación a una persona del equipo. Registra el evento y avisa.

const { logs } = require('../store');
const { notificarHandoff } = require('../notify');

module.exports = {
    schema: {
        type: 'function',
        function: {
            name: 'handoffHuman',
            description: 'Deriva la conversación a una persona del equipo. Úsala si el cliente lo pide expresamente o ante un caso que no puedes resolver (queja seria, urgencia, tema fuera de tu alcance).',
            parameters: {
                type: 'object',
                properties: {
                    motivo: { type: 'string', description: 'Por qué se deriva, en una frase.' },
                    resumen: { type: 'string', description: 'Resumen breve de lo hablado.' }
                },
                required: ['motivo']
            }
        }
    },
    async run(args, ctx) {
        const telefono = (ctx.telefono || '').replace('whatsapp:', '');
        await logs.registrar(ctx.tenantId, 'handoff', { telefono, ...args });
        try { await notificarHandoff(ctx.tenant, { telefono, ...args }); }
        catch (err) { console.error('Aviso de handoff falló:', err.message); }
        return 'OK: derivado al equipo. Dile al cliente que una persona le escribirá en breve.';
    }
};
