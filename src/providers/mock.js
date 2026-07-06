'use strict';

// Proveedor LLM SIMULADO. No usa red ni API key. Imita el formato de mensaje de
// OpenAI (content + tool_calls) y hace tool-calling REAL contra la lógica del
// agente (checkAvailability, createBooking, getServices...). Sirve para probar y
// demostrar el flujo completo hoy, sin credenciales. Mañana, al poner
// OPENAI_API_KEY (o LLM_PROVIDER=openai), se usa el modelo real.
//
// Es un motor de reglas para el "happy path" de reservas, no una IA. Cubre:
// saludo, precios, consulta de disponibilidad, propuesta de horas y reserva.

let _id = 0;
const callId = () => 'mock_call_' + (++_id);
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

const DIAS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, 'miércoles': 3, jueves: 4, viernes: 5, sabado: 6, 'sábado': 6 };

function serviciosDeSystem(system) {
    const out = [];
    const re = /^- (.+?)(?:: (\d+) EUR)? \((\d+) min\)/gm;
    let m;
    while ((m = re.exec(system))) out.push({ nombre: m[1], precio: m[2] ? +m[2] : null, dur: +m[3] });
    return out;
}
function profsDeSystem(system) {
    const m = system.match(/Profesionales:\s*(.+?)\./);
    if (!m) return [];
    return m[1].split(',').map(s => s.trim()).filter(x => x && x !== 'el equipo');
}

function parseFecha(txt) {
    if (!txt) return null;
    const t = txt.toLowerCase();
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    if (/\bhoy\b/.test(t)) return fmt(hoy);
    if (/pasado\s+ma(n|ñ)ana/.test(t)) { const d = new Date(hoy); d.setDate(d.getDate() + 2); return fmt(d); }
    if (/\bma(n|ñ)ana\b/.test(t)) { const d = new Date(hoy); d.setDate(d.getDate() + 1); return fmt(d); }
    const md = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (md) { const dd = +md[1], mm = +md[2]; let yy = md[3] ? +md[3] : hoy.getFullYear(); if (yy < 100) yy += 2000; return `${pad(dd)}/${pad(mm)}/${yy}`; }
    for (const [name, dow] of Object.entries(DIAS)) {
        if (new RegExp(`\\b${name}\\b`).test(t)) {
            const d = new Date(hoy); let add = (dow - d.getDay() + 7) % 7; if (add === 0) add = 7;
            d.setDate(d.getDate() + add); return fmt(d);
        }
    }
    return null;
}
function parseHora(txt) {
    if (!txt) return null;
    const t = txt.toLowerCase();
    let m = t.match(/\b(\d{1,2}):(\d{2})\b/);
    if (m) return `${pad(+m[1])}:${m[2]}`;
    m = t.match(/\ba\s+las\s+(\d{1,2})\b/);
    if (m) return `${pad(+m[1])}:00`;
    m = t.match(/\b(\d{1,2})\s*(?:h|hs|horas)\b/);
    if (m) return `${pad(+m[1])}:00`;
    return null;
}
function servicioMencionado(txt, servicios) {
    const t = (txt || '').toLowerCase();
    for (const s of servicios) {
        if (t.includes(s.nombre.toLowerCase())) return s;
        const palabra = s.nombre.toLowerCase().split(' ')[0];
        if (palabra.length > 3 && t.includes(palabra)) return s;
    }
    return null;
}
function profMencionado(txt, profs) {
    const t = (txt || '').toLowerCase();
    return profs.find(p => t.includes(p.toLowerCase())) || null;
}
function nombreMencionado(txt) {
    let m = (txt || '').match(/(?:me llamo|soy|a nombre de|mi nombre es)\s+([a-záéíóúñ]+(?:[ \t]+[a-záéíóúñ]+)?)/i);
    // También "Pancho, 600123456" (nombre seguido de teléfono/email)
    if (!m) m = (txt || '').match(/^\s*([a-záéíóúñ]+(?:[ \t]+[a-záéíóúñ]+)?)\s*[,;]\s*(?:\+?\d[\d .-]{7,}|\S+@\S+)/i);
    if (!m) return null;
    const cand = m[1].replace(/\s+/g, ' ').trim();
    if (cand.includes('@') || /\d/.test(cand)) return null;
    const primera = cand.split(' ')[0].toLowerCase();
    if (['que','qué','el','la','un','una','de','del','para','por','mi','tu','su'].includes(primera)) return null;
    return cand.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
function contactoMencionado(txt) {
    const t = txt || '';
    const email = t.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    if (email) return email[0];
    const tel = t.match(/\b(\d[\d\s]{7,13}\d)\b/);
    if (tel) return tel[0].replace(/\s+/g, '');
    return null;
}

function textoUsuario(messages) {
    return messages.filter(m => m.role === 'user' && typeof m.content === 'string').map(m => m.content).join(' \n ');
}
function huboPropuestaDeHoras(messages) {
    return messages.some(m => m.role === 'assistant' && typeof m.content === 'string' && /\d{1,2}:\d{2}/.test(m.content));
}
function nombreDeToolCall(messages, toolCallId) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
            const c = m.tool_calls.find(tc => tc.id === toolCallId);
            if (c) return c.function.name;
        }
    }
    return null;
}

const texto = (s) => ({ role: 'assistant', content: s });
const toolCall = (name, args) => ({
    role: 'assistant', content: '',
    tool_calls: [{ id: callId(), type: 'function', function: { name, arguments: JSON.stringify(args) } }]
});

function respuestaTrasTool(nombreTool, data) {
    if (nombreTool === 'checkAvailability') {
        if (data && data.error) return `Mmm, ${data.error}`;
        if (data && data.disponible === false && data.fecha_sugerida) return `Ese día no abrimos o ya pasó. ¿Te viene bien el ${data.fecha_sugerida}?`;
        const slots = [...new Set([].concat(...Object.values((data && data.huecos) || {})))];
        if (!slots.length) return `Pues ese día no me queda hueco para ${data.servicio}. ¿Probamos otro día?`;
        return `Para ${data.servicio} el ${data.fecha} tengo: ${slots.slice(0, 4).join(', ')}. ¿Cuál te viene bien?`;
    }
    if (nombreTool === 'createBooking') {
        return (typeof data === 'string' && data.startsWith('OK'))
            ? '¡Listo! Mesa apuntada. Si necesitas cambiarla o cancelarla, dímelo por aquí. ¡Te esperamos!'
            : 'Uf, no he podido cerrar la reserva. ¿Probamos de nuevo?';
    }
    if (nombreTool === 'cancelBooking') {
        if (typeof data === 'string' && data.startsWith('OK')) return 'Hecho, te he cancelado la cita. Cuando quieras volvemos a verte.';
        if (typeof data === 'string' && data.startsWith('VARIAS')) return 'Veo que tienes más de una cita. ¿Cuál quieres cancelar (dime el día)?';
        return 'No encuentro esa cita. ¿Me confirmas el día que la tenías?';
    }
    if (nombreTool === 'rescheduleBooking') {
        if (typeof data === 'string' && data.startsWith('OK')) return '¡Listo! Te he movido la cita. ¡Te esperamos!';
        if (typeof data === 'string' && (data.startsWith('OCUPADO') || data.startsWith('FUERA_HORARIO') || data.startsWith('CERRADO'))) return 'Esa hora no me cuadra. ¿Te miro otras?';
        if (typeof data === 'string' && data.startsWith('VARIAS')) return '¿Cuál de tus citas quieres mover (dime el día)?';
        return 'No encuentro la cita a mover. ¿Me dices el día que la tenías?';
    }
    if (nombreTool === 'getAgenda') {
        if (typeof data === 'string') return 'Eso solo se lo puedo decir al dueño del negocio.';
        if (!data.total) return `No hay citas entre el ${data.desde} y el ${data.hasta}.`;
        const lin = data.citas.map(c => `${c.fecha} ${c.hora} · ${c.servicio} (${c.nombre})`).join('; ');
        return `Hay ${data.total} cita(s): ${lin}.`;
    }
    if (nombreTool === 'getServices') {
        const arr = ((data && data.servicios) || []).map(s => `${s.nombre} ${s.precio_eur}€`).join(', ');
        return `Esto es lo que hacemos: ${arr}.`;
    }
    if (nombreTool === 'registerLead') return 'Genial, se lo paso al equipo y te escriben enseguida.';
    if (nombreTool === 'handoffHuman') return 'Te paso con una persona del equipo, ahora te escriben.';
    return 'Hecho.';
}

async function chat({ system, messages }) {
    const servicios = serviciosDeSystem(system);
    const profs = profsDeSystem(system);
    const last = messages[messages.length - 1];

    // 1) Respuesta tras el resultado de una tool
    if (last && last.role === 'tool') {
        const nombre = nombreDeToolCall(messages, last.tool_call_id);
        let data; try { data = JSON.parse(last.content); } catch (_) { data = last.content; }
        return texto(respuestaTrasTool(nombre, data));
    }

    // 2) Turno de usuario
    const userText = (last && typeof last.content === 'string') ? last.content : '';
    const conv = textoUsuario(messages);
    const t = userText.toLowerCase();

    const svc = servicioMencionado(conv, servicios);
    const fecha = parseFecha(userText) || parseFecha(conv);
    const hora = parseHora(userText) || parseHora(conv);
    const prof = profMencionado(conv, profs);
    const nombre = nombreMencionado(userText) || nombreMencionado(conv);
    const contacto = contactoMencionado(conv);

    const preguntaPrecio = /(precio|cu[aá]nto|cuesta|vale|tarifa)/.test(t);
    const intencionReserva = /(cita|reserv|hueco|agenda|apunt|coger hora|pedir hora|quiero ir|mesa|cenar|\bcomer\b)/.test(conv.toLowerCase()) || (!!svc && !!fecha);

    // Vocabulario de restaurante (modo aforo): comensales + turno Comida/Cena
    const esRestaurante = /n[uú]mero de comensales/i.test(system || '');
    const mCom = conv.toLowerCase().match(/(?:somos|mesa para|para)\s+(\d{1,2})(?!\d|[:/])|(\d{1,2})\s*(?:personas|comensales|pax)/);
    const comensales = mCom ? parseInt(mCom[1] || mCom[2], 10) : null;
    let svcR = svc;
    if (!svcR && esRestaurante && servicios.length) {
        const c = conv.toLowerCase();
        const buscado = /(cena|cenar|noche)/.test(c) ? 'cena' : (/(comida|\bcomer\b|mediod)/.test(c) ? 'comida' : null);
        if (buscado) svcR = servicios.find(x => x.nombre.toLowerCase().includes(buscado)) || null;
    }

    // Saludo simple
    if (/^\s*(hola|buenas|buenos dias|buenos días|hey|qué tal|que tal)\b/.test(t) && t.length < 30 && !svc) {
        return texto('¡Hola! ¿En qué te ayudo? ¿Quieres info de algún servicio o te busco una cita?');
    }

    // Precio / info
    if (preguntaPrecio && svc && svc.precio != null) return texto(`${svc.nombre} cuesta ${svc.precio} € y dura unos ${svc.dur} min. ¿Te busco hueco?`);
    if (preguntaPrecio && svc && svc.precio == null) return texto(`Para ${svc.nombre} te reservo mesa sin más. ¿Qué día quieres venir?`);
    if (preguntaPrecio && !svc) {
        const lista = servicios.map(s => `${s.nombre} (${s.precio}€)`).join(', ');
        return texto(`Tenemos: ${lista}. ¿De cuál quieres saber o te reservo algo?`);
    }

    // Agenda del dueño (la tool valida que sea el dueño)
    if (/(mi agenda|qu[eé] tengo|que tengo|cu[aá]ntas?\s+(citas|reservas)|agenda de|tengo (hoy|ma[nñ]ana|esta semana))/.test(t)) {
        if (fecha) return toolCall('getAgenda', { fecha });
        const rango = /semana/.test(t) ? 'semana' : (/ma(n|ñ)ana/.test(t) ? 'manana' : 'hoy');
        return toolCall('getAgenda', { rango });
    }
    // Cancelar (cita, reserva o mesa). La hora solo si viene en el ÚLTIMO mensaje:
    // usar horas de turnos anteriores cancela la reserva equivocada (o ninguna).
    if (/\b(cancel|anul|quitar la (cita|reserva|mesa)|borrar la (cita|reserva|mesa))/.test(t)) {
        if (!fecha) return texto('Claro. ¿Para qué día tienes la reserva que quieres cancelar?');
        const horaUlt = parseHora(userText);
        return toolCall('cancelBooking', { fecha, ...(horaUlt ? { hora: horaUlt } : {}) });
    }
    // Reprogramar / mover (cita, reserva o mesa)
    if (/(reprogram|mover (la|mi) (cita|reserva|mesa)|cambiar (la|mi) (cita|reserva|mesa)|cambiar la hora|cambiar el d[ií]a|otra hora|otro d[ií]a|aplazar)/.test(t)) {
        if (!fecha) return texto('Sin problema. ¿A qué día quieres moverla?');
        const horaUlt = parseHora(userText);
        if (!horaUlt) return texto('¿Y a qué hora te viene mejor?');
        return toolCall('rescheduleBooking', { nueva_fecha: fecha, nueva_hora: horaUlt });
    }

    // Reserva
    if (intencionReserva) {
        const sv = svcR || svc;
        if (!sv) return texto(esRestaurante ? '¿La mesa la quieres para comer o para cenar?' : '¿Para qué servicio quieres la cita?');
        if (!fecha) return texto(esRestaurante ? `Genial, ${sv.nombre.toLowerCase()}. ¿Qué día te viene bien?` : `Genial, ${sv.nombre}. ¿Qué día te viene bien?`);
        if (!huboPropuestaDeHoras(messages)) {
            return toolCall('checkAvailability', { fecha, servicio: sv.nombre, ...(prof ? { profesional: prof } : {}) });
        }
        if (!hora) return texto('¿A qué hora te apunto?');
        if (esRestaurante && !comensales) return texto('¿Para cuántas personas?');
        if (!nombre) return texto(esRestaurante ? '¿A nombre de quién pongo la mesa?' : 'Perfecto. ¿A nombre de quién la pongo?');
        if (!contacto) return texto('¿Y un teléfono o email de contacto?');
        return toolCall('createBooking', { nombre, contacto, servicio: sv.nombre, fecha, hora, ...(comensales ? { comensales } : {}), ...(prof ? { profesional: prof } : {}) });
    }

    return texto('Cuéntame, ¿quieres info de un servicio o te busco una cita?');
}

module.exports = { chat };
