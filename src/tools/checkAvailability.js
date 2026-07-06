'use strict';

// Motor de disponibilidad. Dirigido por la config del tenant (horario, franjas,
// profesionales, servicios). Los huecos OCUPADOS los aporta store/bookings, que
// decide la fuente: Google Calendar (si está configurado) o JSON. Nunca inventa
// huecos.

const { bookings } = require('../store');

function horaAMin(h) { const [a, b] = h.split(':').map(Number); return a * 60 + (b || 0); }
function minAHora(m) { const h = Math.floor(m / 60), x = m % 60; return `${String(h).padStart(2, '0')}:${String(x).padStart(2, '0')}`; }
function parsear(s) { const [d, m, y] = s.split('/').map(Number); return new Date(y, m - 1, d); }
function fmt(d) { const p = n => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; }

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
            name: 'checkAvailability',
            description: 'Consulta los huecos libres para un servicio y una fecha (y opcionalmente un profesional). Llama SIEMPRE a esta herramienta antes de ofrecer o confirmar una hora.',
            parameters: {
                type: 'object',
                properties: {
                    fecha: { type: 'string', description: 'Fecha en formato DD/MM/YYYY. Interpreta tú "mañana", "el lunes", etc. usando la fecha de hoy.' },
                    servicio: { type: 'string', description: 'Nombre del servicio solicitado.' },
                    profesional: { type: 'string', description: 'Profesional concreto, si el cliente lo pide. Opcional.' }
                },
                required: ['fecha', 'servicio']
            }
        }
    },
    async run(args, ctx) {
        const b = ctx.tenant.business || {};
        const servicios = ctx.tenant.services.servicios || [];
        const svc = servicios.find(s => s.nombre.toLowerCase() === String(args.servicio || '').toLowerCase());
        if (!svc) {
            return JSON.stringify({ error: `Servicio no reconocido. Disponibles: ${servicios.map(s => s.nombre).join(', ')}` });
        }
        const duracion = svc.duracion_min;

        const horario = b.horario || {};
        const franjas = (horario.franjas || []).map(f => ({ inicio: horaAMin(f.inicio), fin: horaAMin(f.fin) }));
        const diasLab = horario.dias_laborables || [1, 2, 3, 4, 5];
        const profesionales = b.profesionales || [];

        let prof = args.profesional;
        if (prof && profesionales.length && !profesionales.some(p => p.toLowerCase() === prof.toLowerCase())) {
            return JSON.stringify({ error: `Profesional no reconocido. Disponibles: ${profesionales.join(', ')}` });
        }

        let fecha;
        try { fecha = parsear(args.fecha); if (isNaN(fecha.getTime())) throw new Error('x'); }
        catch (_) { return JSON.stringify({ error: 'Fecha no válida, usa DD/MM/YYYY.' }); }

        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        if (fecha < hoy || !diasLab.includes(fecha.getDay())) {
            const prox = new Date(Math.max(fecha.getTime(), hoy.getTime()));
            do { prox.setDate(prox.getDate() + 1); } while (!diasLab.includes(prox.getDay()));
            return JSON.stringify({
                disponible: false,
                motivo: fecha < hoy ? 'fecha_pasada' : 'dia_no_laborable',
                fecha_sugerida: fmt(prox)
            });
        }

        const intervals = await bookings.busyIntervals(ctx.tenant, args.fecha);
        const PASO = 30;

        // Modo AFORO (restaurantes): un hueco admite tantas reservas solapadas
        // como mesas. Se ignora "profesional".
        const cap = bookings.capacidadDe(ctx.tenant);
        if (cap) {
            const mesas = Number(cap.mesas);
            const libres = [];
            for (const fr of franjasDelTurno(franjas, svc.nombre)) {
                for (let t = fr.inicio; t + duracion <= fr.fin; t += PASO) {
                    const solapadas = intervals.filter(o => t < o.fin && (t + duracion) > o.ini).length;
                    if (solapadas < mesas) libres.push(minAHora(t));
                }
            }
            return JSON.stringify({
                disponible: libres.length > 0,
                fecha: args.fecha,
                servicio: svc.nombre,
                duracion_min: duracion,
                huecos: { cualquiera: libres }
            });
        }

        const candidatos = prof
            ? [profesionales.find(p => p.toLowerCase() === prof.toLowerCase())]
            : (profesionales.length ? profesionales : [null]);

        const huecosPorProf = {};

        for (const p of candidatos) {
            // Para un profesional concreto, lo bloquean sus eventos y los eventos
            // sin profesional asignado (bloqueos de todo el local).
            const ocupados = intervals.filter(o => p ? (o.profesional === p || o.profesional == null) : true);
            const libres = [];
            for (const fr of franjas) {
                for (let t = fr.inicio; t + duracion <= fr.fin; t += PASO) {
                    const ini = t, fin = t + duracion;
                    if (!ocupados.some(o => ini < o.fin && fin > o.ini)) libres.push(minAHora(ini));
                }
            }
            huecosPorProf[p || 'cualquiera'] = libres;
        }

        return JSON.stringify({
            disponible: Object.values(huecosPorProf).some(h => h.length > 0),
            fecha: args.fecha,
            servicio: svc.nombre,
            duracion_min: duracion,
            huecos: huecosPorProf
        });
    }
};
