'use strict';

// Configuración central. Lee .env si está disponible (sin romper si no lo está,
// para que el smoke test funcione antes de `npm install`).
try { require('dotenv').config(); } catch (_) { /* dotenv aún no instalado */ }

const path = require('path');

const DATA_DIR = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, '..', 'data');

module.exports = {
    PORT: process.env.PORT || 3000,

    // Motor LLM (v0.1: OpenAI GPT-4o-mini). Aislado en src/llm.js para poder
    // cambiar de proveedor sin tocar el resto del agente.
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    // Endpoint compatible con OpenAI (opcional, para apuntar a otro proveedor).
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    // Twilio (canal WhatsApp alternativo a Meta).
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_WHATSAPP_NUMBER: process.env.TWILIO_WHATSAPP_NUMBER,
    // CORS para el widget embebido (coma-separado, o * para todos).
    CORS_ORIGINS: process.env.CORS_ORIGINS || '*',


    // Tenant usado por la CLI y como fallback si no se resuelve por número.
    DEFAULT_TENANT: process.env.DEFAULT_TENANT || 'barberia_demo',

    PATHS: {
        // Dos raíces a propósito:
        // - `tenants`: los versionados en el repo (demos y plantillas). Railway los
        //   despliega con el código, y sin ellos se cae la demo de studio32.es.
        // - `tenantsRuntime`: los creados en caliente desde /onboarding. Cuelgan del
        //   volumen (DATA_DIR → /app/data en Railway) porque el contenedor es
        //   efímero: escritos junto al código, desaparecerían en el siguiente deploy.
        // Al resolver, runtime tiene prioridad (ver src/tenants.js).
        tenants: path.join(__dirname, '..', 'tenants'),
        tenantsRuntime: path.join(DATA_DIR, 'tenants'),
        data: DATA_DIR
    }
};
