'use strict';

// Crea una reserva EN FIRME mediante herramienta. Valida por su cuenta (no confía
// solo en que el modelo haya consultado antes): día laborable, dentro de horario y
// hueco realmente libre. Así NUNCA se cuela una doble-reserva ni una cita fuera de
// horario, pase lo que pase con el modelo. Persiste en la agenda (Calendar si está
// configurado, con respaldo JSON) y avisa al equipo.

const { bookings } = require('../store');
const { notificarReserva } = require('../notify');

function horaAMin(h) { const [a, b] = h.split(':').map(Number); return a * 60 + (b || 0); }
function parsear(s) { const [d, m, y] = s.split('/').map(Number); return new Date(y, m - 1, d); }

// Modo aforo: si el servicio se llama Comida/Cena, solo valen las franjas de su
// turno (cena = franjas que empiezan a las 19:00 o después). Si el nombre no
// sugiere turno, valen todas.
function franjasDelTurno(franjas, nombreServicio) {
    const n = String(nombreServicio || '').toLowerCase();
    const esCena = /cena/.test(n);
    const esComida = /comida|almuerzo|mediod/.test(n);
    if (!esCena && !esComida) return franjas;
    const f = franjas.filter(fr => esCena ? fr.inicio >= 19 * 60 : fr.inicio < 19 * 60);
    return f.length ? f : franjas;
}


module.exports = {
    schema: {
        type: 'function',
        function: {
            name: 'createBooking',
            description: 'Crea una reserva en firme. Úsala SOLO cuando tengas confirmados servicio, fecha (DD/MM/YYYY), hora (HH:MM), nombre y un contacto, y el cliente haya dicho que sí. No confirmes una cita sin llamar a esta herramienta.',
            parameters: {
                type: 'object',
                properties: {
                    nombre: { type: 'string' },
                    contacto: { type: 'string', description: 'Teléfono o email del cliente.' },
                    servicio: { type: 'string' },
                    fecha: { type: 'string', description: 'DD/MM/YYYY' },
                    hora: { type: 'string', description: 'HH:MM' },
                    comensales: { type: 'integer', description: 'Número de personas. OBLIGATORIO en restaurantes: pregúntalo antes de reservar.' },
                    profesional: { type: 'string', description: 'Opcional.' },
                    notas: { type: 'string', description: 'Resumen breve (1-2 frases) de lo entendido en la conversación antes de reservar: negocio, necesidad concreta, herramientas que ya usa, volumen aproximado. Para que el equipo llegue informado a la cita. Opcional pero muy recomendable.' }
                },
                required: ['nombre', 'contacto', 'servicio', 'fecha', 'hora']
            }
        }
    },
    async run(args, ctx) {
        if (!args.nombre || !args.contacto || !args.servicio || !args.fecha || !args.hora) {
            return 'ERROR: faltan datos de la reserva, pídelos antes de reservar.';
        }

        const servicios = ctx.tenant.services.servicios || [];
        const svc = servicios.find(s => s.nombre.toLowerCase() === String(args.servicio).toLowerCase());
        const servicioNombre = svc ? svc.nombre : args.servicio;
        const duracion = svc ? svc.duracion_min : 60;

        // 1) Validar fecha y horario del negocio.
        const b = ctx.tenant.business || {};
        const horario = b.horario || {};
        const diasLab = horario.dias_laborables || [1, 2, 3, 4, 5];
        const fechaObj = parsear(args.fecha);
        if (isNaN(fechaObj.getTime())) return 'ERROR: fecha no válida (usa DD/MM/YYYY).';
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        if (fechaObj < hoy || !diasLab.includes(fechaObj.getDay())) {
            return 'CERRADO: ese día no abrimos o ya pasó. Ofrece otra fecha con checkAvailability.';
        }
        const ini = horaAMin(args.hora), fin = ini + duracion;
        const franjas = (horario.franjas || []).map(f => ({ inicio: horaAMin(f.inicio), fin: horaAMin(f.fin) }));
        if (franjas.length && !franjas.some(f => ini >= f.inicio && fin <= f.fin)) {
            return 'FUERA_HORARIO: esa hora está fuera del horario. Ofrece otra con checkAvailability.';
        }

        // 1.b) Modo AFORO (restaurantes): comensales obligatorio y con tope.
        const cap = bookings.capacidadDe(ctx.tenant);
        const comensales = args.comensales ? parseInt(args.comensales, 10) : null;
        if (cap) {
            if (!comensales || comensales < 1) {
                return 'ERROR: falta el número de comensales. Pregúntaselo al cliente antes de reservar.';
            }
            const max = Number(cap.max_comensales_por_reserva || 0);
            if (max && comensales > max) {
                return `GRUPO_GRANDE: reservas de más de ${max} personas no se confirman por chat. Toma los datos y usa handoffHuman para que el equipo lo gestione.`;
            }
            const frTurno = franjasDelTurno(franjas, servicioNombre);
            if (frTurno.length && !frTurno.some(f => ini >= f.inicio && fin <= f.fin)) {
                return `FUERA_HORARIO: esa hora no corresponde al turno de ${servicioNombre}. Ofrece otra con checkAvailability.`;
            }
        }

        // 2) Dedup de reserva idéntica (mismo cliente, mismo hueco).
        const existentes = await bookings.listarJSONPorFecha(ctx.tenantId, args.fecha);
        const duplicada = existentes.some(r =>
            r.estado !== 'cancelada' && r.hora === args.hora && r.servicio === servicioNombre &&
            r.contacto === args.contacto && (!args.profesional || r.profesional === args.profesional)
        );
        if (duplicada) return 'OK: esa reserva ya estaba registrada, no se duplica.';

        // 3) Disponibilidad real: evita doble-booking del hueco (o aforo lleno).
        const libre = await bookings.huecoLibre(ctx.tenant, args.fecha, args.hora, duracion, args.profesional || null);
        if (!libre) return 'OCUPADO: ese hueco ya está cogido. Ofrece otra hora con checkAvailability.';

        // 4) Crear.
        const reserva = await bookings.crear(ctx.tenant, {
            nombre: args.nombre,
            contacto: args.contacto,
            servicio: servicioNombre,
            fecha: args.fecha,
            hora: args.hora,
            comensales: comensales,
            profesional: args.profesional || null,
            duracion_min: duracion,
            notas: args.notas || null,
            telefono_cliente: (ctx.telefono || '').replace('whatsapp:', '')
        });

        try { await notificarReserva(ctx.tenant, reserva); }
        catch (err) { console.error('Aviso de reserva falló:', err.message); }

        return reserva.calendar_link
            ? `OK: reserva creada y añadida al calendario (id ${reserva.id}).`
            : `OK: reserva creada (id ${reserva.id}).`;
    }
};
