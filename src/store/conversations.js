'use strict';

// Historial de conversación PERSISTENTE por tenant + teléfono (formato OpenAI).
// A diferencia de los prototipos (Map en memoria), sobrevive a reinicios.

const db = require('./_db');
const FILE = 'conversations.json';
const MAX_HISTORIAL = 20;

async function get(tenantId, telefono) {
    const all = db.leer(tenantId, FILE, {});
    const h = all[telefono] || [];
    // Solo turnos limpios (user/assistant de texto). Filtra restos antiguos de
    // tool_calls/tool para no romper la validación del modelo.
    return h.filter(m => m && (
        (m.role === 'user' && typeof m.content === 'string') ||
        (m.role === 'assistant' && typeof m.content === 'string' && m.content && !m.tool_calls)
    ));
}

async function push(tenantId, telefono, mensaje) {
    const all = db.leer(tenantId, FILE, {});
    const h = all[telefono] || [];
    h.push(mensaje);
    if (h.length > MAX_HISTORIAL) h.splice(0, h.length - MAX_HISTORIAL);
    all[telefono] = h;
    db.escribir(tenantId, FILE, all);
    return h;
}

module.exports = { get, push };
