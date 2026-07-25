'use strict';

// Selector de proveedor LLM. Interfaz única para el orchestrator:
//   chat({ system, messages, tools })  y  disponible().
//
// Proveedor (LLM_PROVIDER=openai|mock). Si no se indica:
//   - 'openai'   si hay OPENAI_API_KEY
//   - 'mock'     si no hay ninguna (modo simulación, sin coste)
//
// Para un endpoint compatible con OpenAI (otro proveedor), usar
// LLM_PROVIDER=openai con OPENAI_BASE_URL.

const cfg = require('./config');

const PROVIDER = (cfg.LLM_PROVIDER || (cfg.OPENAI_API_KEY ? 'openai' : 'mock')).toLowerCase();

let impl, MODEL, _disponible;

if (PROVIDER === 'mock') {
    impl = require('./providers/mock');
    MODEL = 'mock (simulación)';
    _disponible = true;
} else {
    const create = require('./providers/openai');
    MODEL = cfg.OPENAI_MODEL;
    impl = create({ apiKey: cfg.OPENAI_API_KEY, baseURL: cfg.OPENAI_BASE_URL || undefined, model: MODEL });
    _disponible = !!cfg.OPENAI_API_KEY;
}

function disponible() { return _disponible; }
async function chat(opts) { return impl.chat(opts); }

module.exports = { chat, disponible, MODEL, PROVIDER };
