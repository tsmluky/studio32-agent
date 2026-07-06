'use strict';

// Cancela una cita activa del cliente. La identifica por su teléfono (o contacto)
// y, si hace falta, por fecha/hora. Da de baja en Calendar (si aplica) y avisa.

const { bookings } = require('../store');
const { notificarCancelacion } = require('../notify');

module.exports = {
    schema: {
        type: 'function',
        function: {
            name: 'cancelBooking',
            description: 'Cancela una cita ya existente del cliente. Úsala cuando el cliente quiera anular su cita. Si el cliente tiene varias, pide la fecha para identificarla.',
            parameters: {
                type: 'object',
                properties: {
                    fecha: { type: 'string', description: 'Fecha de la cita a cancelar (DD/MM/YYYY), si se conoce.' },
                    hora: { type: 'string', description: 'Hora de la cita (HH:MM), si se conoce.' },
                    contacto: { type: 'string', description: 'Teléfono o email con el que reservó, si el canal no lo aporta.' }
                }
            }
        }
    },
    async run(args, ctx) {
        let candidatas = await bookings.activasDeCliente(ctx.tenant, { telefono: ctx.telefono, contacto: args.contacto });
        if (args.fecha) candidatas = candidatas.filter(r => r.fecha === args.fecha);
        if (args.hora) candidatas = candidatas.filter(r => r.hora === args.hora);

        if (candidatas.length === 0) return 'ERROR: no encuentro ninguna cita activa con esos datos. Pide al cliente la fecha de su cita.';
        if (candidatas.length > 1) {
            return 'VARIAS: hay varias citas: ' + candidatas.map(r => `${r.fecha} ${r.hora} (${r.servicio})`).join('; ') + '. Pregunta al cliente cuál quiere cancelar.';
        }
        const r = await bookings.cancelar(ctx.tenant, candidatas[0].id);
        try { await notificarCancelacion(ctx.tenant, r); } catch (err) { console.error('Aviso cancelación falló:', err.message); }
        return `OK: cita del ${r.fecha} ${r.hora} (${r.servicio}) cancelada.`;
    }
};
