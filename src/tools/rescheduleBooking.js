'use strict';

// Reprograma (mueve) una cita activa del cliente a nueva fecha/hora. Comprueba
// que el nuevo hueco esté libre y dentro del horario, mueve el evento en Calendar
// (si aplica) y avisa al equipo.

const { bookings } = require('../store');
const { notificarReprogramacion } = require('../notify');

function horaAMin(h) { const [a, b] = h.split(':').map(Number); return a * 60 + (b || 0); }
function parsear(s) { const [d, m, y] = s.split('/').map(Number); return new Date(y, m - 1, d); }

module.exports = {
    schema: {
        type: 'function',
        function: {
            name: 'rescheduleBooking',
            description: 'Cambia una cita existente del cliente a una nueva fecha y hora. Úsala cuando el cliente quiera mover su cita. Si tiene varias, pide la fecha actual para identificarla.',
            parameters: {
                type: 'object',
                properties: {
                    fecha_actual: { type: 'string', description: 'Fecha actual de la cita (DD/MM/YYYY), si se conoce.' },
                    hora_actual: { type: 'string', description: 'Hora actual de la cita (HH:MM), si se conoce.' },
                    nueva_fecha: { type: 'string', description: 'Nueva fecha (DD/MM/YYYY).' },
                    nueva_hora: { type: 'string', description: 'Nueva hora (HH:MM).' },
                    contacto: { type: 'string', description: 'Teléfono o email con el que reservó, si el canal no lo aporta.' }
                },
                required: ['nueva_fecha', 'nueva_hora']
            }
        }
    },
    async run(args, ctx) {
        let candidatas = await bookings.activasDeCliente(ctx.tenant, { telefono: ctx.telefono, contacto: args.contacto });
        if (args.fecha_actual) candidatas = candidatas.filter(r => r.fecha === args.fecha_actual);
        if (args.hora_actual) candidatas = candidatas.filter(r => r.hora === args.hora_actual);

        if (candidatas.length === 0) return 'ERROR: no encuentro la cita a mover. Pide al cliente la fecha de su cita actual.';
        if (candidatas.length > 1) {
            return 'VARIAS: hay varias citas: ' + candidatas.map(r => `${r.fecha} ${r.hora} (${r.servicio})`).join('; ') + '. Pregunta cuál quiere mover.';
        }
        const r = candidatas[0];

        // Validar horario del negocio para la nueva fecha/hora.
        const b = ctx.tenant.business || {};
        const horario = b.horario || {};
        const diasLab = horario.dias_laborables || [1, 2, 3, 4, 5];
        const fechaObj = parsear(args.nueva_fecha);
        if (isNaN(fechaObj.getTime())) return 'ERROR: nueva fecha no válida (DD/MM/YYYY).';
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        if (fechaObj < hoy || !diasLab.includes(fechaObj.getDay())) {
            return 'CERRADO: ese día no abrimos o ya pasó. Ofrece consultar disponibilidad con checkAvailability.';
        }
        const dur = r.duracion_min || 60;
        const ini = horaAMin(args.nueva_hora), fin = ini + dur;
        const franjas = (horario.franjas || []).map(f => ({ inicio: horaAMin(f.inicio), fin: horaAMin(f.fin) }));
        const dentro = franjas.some(f => ini >= f.inicio && fin <= f.fin);
        if (franjas.length && !dentro) return 'FUERA_HORARIO: esa hora está fuera del horario. Ofrece otra con checkAvailability.';

        const libre = await bookings.huecoLibre(ctx.tenant, args.nueva_fecha, args.nueva_hora, dur, r.profesional);
        if (!libre) return 'OCUPADO: esa nueva hora no está libre. Ofrece otras con checkAvailability.';

        const updated = await bookings.reprogramar(ctx.tenant, r.id, args.nueva_fecha, args.nueva_hora);
        try { await notificarReprogramacion(ctx.tenant, updated); } catch (err) { console.error('Aviso reprogramación falló:', err.message); }
        return `OK: cita movida de ${updated.fecha_anterior} ${updated.hora_anterior} a ${updated.fecha} ${updated.hora}.`;
    }
};
