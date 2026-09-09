'use strict';

// Guard de confirmación de cita.
//
// El peor fallo que puede cometer este producto no es contestar mal: es decir "listo,
// ya tienes tu cita" cuando no hay ninguna cita. El paciente se presenta, no le espera
// nadie, y el negocio nos echa a nosotros. Pasó de verdad, con esta misma frase:
//
//   "Listo, Marta: ya tienes tu cita para la revisión general el jueves a las 09:30."
//   ...y en la agenda no había absolutamente nada.
//
// El system prompt ya lo prohíbe ("no confirmes una cita sin haberla creado con la
// herramienta") y el modelo se lo saltó igualmente. Un aviso escrito no es una
// garantía: por eso esto vive aquí, en código, después del modelo y antes del cliente.
//
// Comprueba dos cosas, y solo actúa si algo no cuadra:
//   1. Si el mensaje da la cita por hecha, tiene que existir en la agenda.
//   2. Si además dice una hora, esa hora tiene que ser la que está guardada.
//
// Lo segundo también pasó: reservó a las 10:00 y despidió al cliente con "confirmada
// para mañana a las 09:30". Media hora de diferencia entre lo que cree el cliente y lo
// que verá el negocio al abrir la agenda.

const { bookings } = require('./store');

// "reservada", "apuntada", "confirmada", "hecho", "listo"… junto a "cita", "hora",
// "visita", "reserva", una hora concreta o un día. Se piden las dos partes a
// propósito: un "¡listo!" suelto tras resolver una duda no confirma ninguna cita.
//
// Dos trampas aprendidas escribiendo esto:
//  - "queda" a secas valía para "queda reservada", pero también para "hoy ya no queda
//    hueco", que es una respuesta perfectamente correcta. Fuera: "queda reservada" ya
//    casa por "reservada".
//  - "de hecho, mañana tenemos sitio" no confirma nada. De ahí el (?<!de ).
const VERBO = /\b(reservad[ao]|apuntad[ao]|confirmad[ao]|agendad[ao]|guardad[ao]|(?<!de )hecho|listo|ya tienes)\b/i;
const OBJETO = /\b(cita|citas|reserva|hora|visita)\b/i;
const HORA = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g;
// "Te la he apuntado, nos vemos el jueves": ni dice "cita" ni dice una hora, y está
// confirmando igual.
const CUANDO = /\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[áa]bado|domingo|ma[ñn]ana|hoy)\b/i;

// Una pregunta no afirma nada: "¿te la reservo para las 10:00?" es exactamente lo que
// queremos que haga, y no puede disparar el guard.
function frasesAfirmativas(texto) {
    return String(texto)
        .split(/(?<=[.!?\n])\s+/)
        .filter(f => f.trim() && !f.includes('?') && !f.includes('¿'));
}

// Da la cita por hecha si afirma haberla dejado cerrada y además nombra el objeto
// ("tu cita") o una hora concreta. Lo segundo hace falta: el agente despachó una
// reserva con un escueto "Hecho, Marta: el jueves a las 10:00", sin decir "cita".
function daLaCitaPorHecha(texto) {
    return frasesAfirmativas(texto).some(f => {
        if (!VERBO.test(f)) return false;
        HORA.lastIndex = 0;
        return OBJETO.test(f) || HORA.test(f) || CUANDO.test(f);
    });
}

function horasMencionadas(texto) {
    HORA.lastIndex = 0;
    return [...String(texto).matchAll(HORA)].map(m => `${m[1].padStart(2, '0')}:${m[2]}`);
}

const NO_CONSTA = 'Perdona, me he adelantado: no me consta que haya quedado registrada. Dime la hora que te viene bien y te la dejo cerrada ahora mismo.';

function confirmacionCorrecta(cita) {
    return `Te confirmo lo que hay apuntado: ${cita.servicio} el ${cita.fecha} a las ${cita.hora}. Si prefieres otra hora, dímelo y la cambio.`;
}

// Devuelve el texto tal cual, o uno corregido. Nunca lanza: un fallo aquí no puede
// dejar al cliente sin respuesta, así que ante la duda pasa el original.
async function revisarConfirmacion(ctx, texto) {
    try {
        if (!texto || !daLaCitaPorHecha(texto)) return texto;

        const activas = await bookings.activasDeCliente(ctx.tenant, { telefono: ctx.telefono });

        if (!activas.length) {
            console.error('[GUARD RESERVA] Confirmaba una cita inexistente |', ctx.tenantId, ctx.telefono, '|', texto.slice(0, 120));
            return NO_CONSTA;
        }

        const dichas = horasMencionadas(texto);
        if (!dichas.length) return texto;
        if (dichas.some(h => activas.some(c => c.hora === h))) return texto;

        console.error('[GUARD RESERVA] La hora que decía no era la reservada |', ctx.tenantId, ctx.telefono,
            '| decía', dichas.join(', '), '| guardada', activas.map(c => c.hora).join(', '));
        return confirmacionCorrecta(activas[activas.length - 1]);
    } catch (err) {
        console.error('[GUARD RESERVA] no se pudo comprobar:', err.message);
        return texto;
    }
}

module.exports = { revisarConfirmacion, daLaCitaPorHecha, horasMencionadas, NO_CONSTA };
