'use strict';

// Proveedor de promptfoo que habla con el agente REAL de un tenant.
//
// Reutiliza las piezas de verdad —el system prompt, las herramientas, el filtro de
// seguridad— para que lo que se evalúa sea el agente y no una imitación. Lo único
// que NO reutiliza es `src/orchestrator.js`, a propósito:
//
//   - `responder()` persiste la conversación, reclama el webhook y contabiliza uso.
//     Un banco de pruebas no debe escribir en el historial real ni sumar consumo.
//   - `responder()` hidrata el tenant desde Supabase. Aquí se lee solo la config de
//     `tenants/<id>/`, que es la que está versionada. Así el resultado es el mismo
//     en el portátil, en el sobremesa y en CI, sin depender de la base de datos.
//
// El bucle de tool-calling sí es el mismo que el del orchestrator. Si ese bucle
// cambia allí, hay que reflejarlo aquí — está marcado más abajo.

const path = require('path');

// Aislar los datos ANTES de cargar config.js, que resuelve DATA_DIR al requerirse.
// Las reservas que cree el agente durante una evaluación caen en .eval-data/ y no
// tocan data/ ni la agenda real de ningún cliente.
process.env.DATA_DIR = process.env.EVAL_DATA_DIR
    || path.join(__dirname, '..', '.eval-data');

const llm = require('../src/llm');
const { construirSystemPrompt } = require('../src/prompt');
const tools = require('../src/tools');
const { cargarTenant } = require('../src/tenants');
const {
    inspeccionarRespuesta,
    limpiarParaWhatsApp,
    MENSAJE_SEGURO_FALLBACK
} = require('../src/safety');

const MAX_VUELTAS = 5;

let avisado = false;
function avisarSiMock() {
    if (avisado) return;
    avisado = true;
    if (llm.PROVIDER === 'mock' || !llm.disponible()) {
        console.error(
            '\n[evals] AVISO: no hay OPENAI_API_KEY, se está usando el proveedor "mock".\n' +
            '        Los resultados NO valen: el mock no razona. Pon la clave en .env\n' +
            '        y vuelve a lanzar `npm run eval`.\n'
        );
    }
}

class AgenteStudio32 {
    constructor(options = {}) {
        this.config = options.config || {};
        this.tenantId = this.config.tenant || 'gh-dent';
        this.esOwner = !!this.config.owner;
        this.providerId = options.id
            || `studio32:${this.tenantId}${this.esOwner ? ':owner' : ''}`;
    }

    id() { return this.providerId; }

    // prompt = el mensaje que escribe el cliente por WhatsApp.
    async callApi(prompt, context = {}) {
        avisarSiMock();

        let tenant;
        try {
            tenant = cargarTenant(this.tenantId);
        } catch (err) {
            return { error: `No se pudo cargar el tenant "${this.tenantId}": ${err.message}` };
        }

        // Un teléfono distinto por caso: dos pruebas nunca comparten estado.
        const telefono = `eval-${this.tenantId}-${(context.test && context.test.description) || Math.random().toString(36).slice(2)}`;
        const ctx = { tenant, tenantId: tenant.id, telefono, esOwner: this.esOwner, channel: 'eval' };

        const system = construirSystemPrompt(tenant, { owner: this.esOwner });
        const schemas = tools.schemas({ owner: this.esOwner, tenant });

        // Historial: solo el mensaje del caso. Para probar una conversación de
        // varios turnos, pásale `vars.historial` desde el YAML.
        const previos = (context.vars && context.vars.historial) || [];
        const mensajes = [...previos, { role: 'user', content: prompt }];

        const herramientasUsadas = [];
        let message;
        try {
            message = await llm.chat({ system, messages: mensajes, tools: schemas });

            // ── Mismo bucle que src/orchestrator.js ──
            let vueltas = 0;
            while (message.tool_calls && message.tool_calls.length && vueltas < MAX_VUELTAS) {
                vueltas++;
                mensajes.push(message);
                for (const call of message.tool_calls) {
                    let resultado;
                    try {
                        const args = JSON.parse(call.function.arguments || '{}');
                        herramientasUsadas.push(call.function.name);
                        resultado = await tools.ejecutar(call.function.name, args, ctx);
                    } catch (err) {
                        herramientasUsadas.push(`${call.function.name}:ERROR`);
                        resultado = 'ERROR: no se pudo completar.';
                    }
                    mensajes.push({ role: 'tool', tool_call_id: call.id, content: resultado });
                }
                message = await llm.chat({ system, messages: mensajes, tools: schemas });
            }
        } catch (err) {
            return { error: `Fallo llamando al modelo: ${err.message}` };
        }

        let texto = limpiarParaWhatsApp((message.content || '').trim());
        const insp = inspeccionarRespuesta(texto);
        const bloqueado = !insp.seguro;
        if (bloqueado) texto = MENSAJE_SEGURO_FALLBACK;
        if (!texto) texto = 'Perdona, me lo repites?';

        return {
            output: texto,
            metadata: {
                tenant: this.tenantId,
                owner: this.esOwner,
                herramientas: herramientasUsadas,
                bloqueadoPorSeguridad: bloqueado,
                motivoBloqueo: bloqueado ? insp.motivo : null,
                modelo: llm.MODEL
            }
        };
    }
}

module.exports = AgenteStudio32;
