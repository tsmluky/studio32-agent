'use strict';

// Selector de proveedor LLM. Interfaz única para el orchestrator:
//   chat({ system, messages, tools })  y  disponible().
//
// Proveedor (LLM_PROVIDER=openai|deepseek|mock). Si no se indica:
//   - 'openai'   si hay OPENAI_API_KEY
//   - 'deepseek' si hay DEEPSEEK_API_KEY
//   - 'mock'     si no hay ninguna (modo simulación, sin coste)
//
// DeepSeek es compatible con la API de OpenAI: se usa el mismo cliente con
// baseURL https://api.deepseek.com y modelo deepseek-chat.

const cfg = require('./config');

const PROVIDER = (cfg.LLM_PROVIDER || (cfg.OPENAI_API_KEY ? 'openai' : (cfg.DEEPSEEK_API_KEY ? 'deepseek' : 'mock'))).toLowerCase();

let impl, MODEL, _disponible;

if (PROVIDER === 'mock') {
    impl = require('./providers/mock');
    MODEL = 'mock (simulación)';
    _disponible = true;
} else if (PROVIDER === 'deepseek') {
    const create = require('./providers/openai');
    MODEL = cfg.DEEPSEEK_MODEL;
    const apiKey = cfg.DEEPSEEK_API_KEY || cfg.OPENAI_API_KEY;
    impl = create({ apiKey, baseURL: cfg.OPENAI_BASE_URL || 'https://api.deepseek.com', model: MODEL });
    _disponible = !!apiKey;
} else {
    const create = require('./providers/openai');
    MODEL = cfg.OPENAI_MODEL;
    impl = create({ apiKey: cfg.OPENAI_API_KEY, baseURL: cfg.OPENAI_BASE_URL || undefined, model: MODEL });
    _disponible = !!cfg.OPENAI_API_KEY;
}

function disponible() { return _disponible; }
async function chat(opts) { return impl.chat(opts); }

module.exports = { chat, disponible, MODEL, PROVIDER };
