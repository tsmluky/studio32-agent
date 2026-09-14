'use strict';
// Resumen de agenda para el DUEÑO del negocio. Solo accesible en modo dueño
// (ctx.esOwner). Permite "¿qué tengo hoy/mañana/esta semana?".

const { bookings } = require('../store');
const gcal = require('../integrations/googleCalendar');

function parse(s) { const [d, m, y] = s.split('/').map(Number); return new Date(y, m - 1, d); }
function fmt(d) { const p = n => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; }

// Con Google conectado, la agenda del dueño es la de Google: incluye lo que apuntó él
// mismo en el móvil, no solo lo que reservó el agente. Las del agente llevan además
// el nombre y el contacto del paciente.
async function agendaDeGoogle(cfg, tenantId, desde, hasta) {
    const tz = cfg.timezone || 'Europe/Madrid';
    const fin = new Date(hasta); fin.setDate(fin.getDate() + 1);
    const inicio = new Date(desde); inicio.setDate(inicio.getDate() - 1);
    const eventos = await gcal.listEvents(cfg, inicio.toISOString(), fin.toISOString());
    const reservas = new Map((await bookings.listar(tenantId)).filter(r => r.calendar_event_id).map(r => [r.calendar_event_id, r]));
    const citas = [];
    for (const ev of eventos) {
        const cuando = bookings.fechaHoraDeEvento(ev, tz);
        const fecha = cuando ? cuando.fecha : ev.start.date.split('-').reverse().join('/');
        const f = parse(fecha);
        if (f < desde || f > hasta) continue;
        const r = reservas.get(ev.id);
        citas.push(r
            ? { fecha, hora: cuando.hora, servicio: r.servicio, nombre: r.nombre, contacto: r.contacto, profesional: r.profesional || null, origen: 'agente' }
            : { fecha, hora: cuando ? cuando.hora : 'todo el día', titulo: ev.summary || 'Sin título', origen: 'apuntada en el calendario' });
    }
    return JSON.stringify({ total: citas.length, desde: fmt(desde), hasta: fmt(hasta), citas });
}

module.exports = {
    schema: {
        type: 'function',
        function: {
            name: 'getAgenda',
            description: 'Resumen de la agenda del negocio para el dueño: devuelve las citas confirmadas de un día o periodo. Úsala cuando el dueño pregunte qué tiene hoy, mañana, esta semana o en una fecha.',
            parameters: {
                type: 'object',
                properties: {
                    fecha: { type: 'string', description: 'Fecha concreta (DD/MM/YYYY), si la pide.' },
                    rango: { type: 'string', enum: ['hoy', 'manana', 'semana'], description: 'Periodo si no da fecha concreta.' }
                }
            }
        }
    },
    async run(args, ctx) {
        if (!ctx.esOwner) return 'ERROR: solo el dueño del negocio puede consultar la agenda.';
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        let desde, hasta;
        if (args.fecha) { desde = hasta = parse(args.fecha); }
        else if (args.rango === 'manana') { const d = new Date(hoy); d.setDate(d.getDate() + 1); desde = hasta = d; }
        else if (args.rango === 'semana') { desde = hoy; hasta = new Date(hoy); hasta.setDate(hasta.getDate() + 6); }
        else { desde = hasta = hoy; }

        const cfg = bookings.calCfg(ctx.tenant);
        if (cfg) return agendaDeGoogle(cfg, ctx.tenantId, desde, hasta);

        const all = (await bookings.listar(ctx.tenantId)).filter(r => r.estado === 'confirmada');
        const citas = all.filter(r => { const f = parse(r.fecha); return f >= desde && f <= hasta; })
            .sort((a, b) => (parse(a.fecha) - parse(b.fecha)) || (a.hora > b.hora ? 1 : -1))
            .map(r => ({ fecha: r.fecha, hora: r.hora, servicio: r.servicio, nombre: r.nombre, contacto: r.contacto, profesional: r.profesional || null }));
        return JSON.stringify({ total: citas.length, desde: fmt(desde), hasta: fmt(hasta), citas });
    }
};
