'use strict';

// Cliente compatible con la API de OpenAI. Sirve para OpenAI y para cualquier
// endpoint compatible (DeepSeek, etc.) cambiando baseURL y model. La librería
// 'openai' se carga de forma perezosa. Se crea con createProvider({apiKey,baseURL,model}).

module.exports = function createProvider({ apiKey, baseURL, model }) {
    let client = null;
    function getClient() {
        if (client) return client;
        if (!apiKey) return null;
        const OpenAI = require('openai');
        client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
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
