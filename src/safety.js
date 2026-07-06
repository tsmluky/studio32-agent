'use strict';

// Guardrails de salida: última línea de defensa antes de enviar al cliente.
// Aunque el modelo se equivoque, evita filtrar "texto interno" (notas al
// sistema, nombres de herramientas, que es una IA) o referencias a otros
// clientes. Si detecta algo, sustituye por un mensaje neutro.

const PATRONES_PROHIBIDOS = [
    /nota\s+(importante\s+)?(para|al)\s+(el\s+)?sistema/i,
    /para\s+el\s+(sistema|backend|desarrollador)/i,
    /\b(checkAvailability|createBooking|cancelBooking|rescheduleBooking|registerLead|handoffHuman|getServices)\b/i,
    /\bla\s+herramienta\b/i,
    /seg[uú]n\s+la\s+herramienta/i,
    /\b(tool|tool_call|function call|api|backend|endpoint|system\s*prompt)\b/i,
    /\b(openai|gpt|chatgpt|modelo de lenguaje|language model|soy una ia|como ia)\b/i,
    /(otros?|los\s+dem[aá]s)\s+(clientes|leads)/i
];

const MENSAJE_SEGURO_FALLBACK =
    'Perdona, se me ha cruzado un cable un momento. Me repites lo último y seguimos?';

function inspeccionarRespuesta(texto) {
    for (const patron of PATRONES_PROHIBIDOS) {
        if (patron.test(texto)) return { seguro: false, motivo: patron.toString() };
    }
    return { seguro: true, motivo: null };
}

// Sanea para WhatsApp: quita markdown accidental y recorta saltos.
function limpiarParaWhatsApp(texto) {
    return texto
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

module.exports = { inspeccionarRespuesta, limpiarParaWhatsApp, MENSAJE_SEGURO_FALLBACK };
