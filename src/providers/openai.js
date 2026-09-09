'use strict';

// Cliente compatible con la API de OpenAI. Sirve para OpenAI y para cualquier
// endpoint compatible cambiando baseURL y model. La librería
// 'openai' se carga de forma perezosa. Se crea con createProvider({apiKey,baseURL,model}).

module.exports = function createProvider({ apiKey, baseURL, model }) {
    let client = null;
    function getClient() {
        if (client) return client;
        if (!apiKey) return null;
        const OpenAI = require('openai');
        // Tiempo de espera y reintentos EXPLÍCITOS. Por defecto la librería espera
        // diez minutos: una llamada colgada dejaría al cliente mirando el móvil sin
        // respuesta y al webhook de Twilio agotando su propio plazo. Treinta segundos
        // es de sobra para este tamaño de respuesta; pasado eso, algo va mal y es
        // mejor decirlo que seguir esperando.
        client = new OpenAI({
            apiKey,
            timeout: Number(process.env.LLM_TIMEOUT_MS) || 30000,
            maxRetries: Number(process.env.LLM_MAX_RETRIES) || 2,
            ...(baseURL ? { baseURL } : {})
        });
        return client;
    }
    return {
        async chat({ system, messages, tools }) {
            const c = getClient();
            if (!c) throw new Error('Falta la API key del LLM.');
            const completion = await c.chat.completions.create({
                model,
                max_tokens: 320,
                temperature: 0.85,
                presence_penalty: 0.5,
                frequency_penalty: 0.3,
                messages: [{ role: 'system', content: system }, ...messages],
                tools
            });
            return completion.choices[0].message;
        }
    };
};
