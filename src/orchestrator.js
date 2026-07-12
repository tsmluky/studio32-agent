'use strict';

// Studio32 Agent Core: el cerebro del agente. Independiente del canal y del tenant.
// ctx = { tenant, tenantId, telefono, esOwner }
//
// IMPORTANTE (robustez): el bucle de tool-calling trabaja sobre una COPIA temporal
// de los mensajes. En el historial PERSISTENTE solo se guarda lo limpio: el mensaje
// del usuario y el texto final del asistente. Así nunca se rompe la secuencia
// "assistant(tool_calls) → tool" al recortar el historial, que es lo que hacía
// fallar al modelo (error 400 invalid_request_error).

const llm = require('./llm');
const { construirSystemPrompt } = require('./prompt');
const tools = require('./tools');
const { conversations, usage } = require('./store');
const { inspeccionarRespuesta, limpiarParaWhatsApp, MENSAJE_SEGURO_FALLBACK } = require('./safety');

async function responder(ctx, mensajeUsuario) {
    const inbound = await conversations.claimInbound(
        ctx.tenantId,
        ctx.telefono,
        mensajeUsuario,
        ctx.providerMessageId,
        ctx.channel
    );
    if (!inbound.accepted) {
        console.log('[Webhook duplicado ignorado]', ctx.channel || 'unknown', ctx.providerMessageId);
        return null;
    }
    const controlMode = inbound.controlMode || await conversations.controlMode(ctx.tenantId, ctx.telefono);
    if (controlMode !== 'agent') {
        if (!inbound.persisted) await conversations.push(ctx.tenantId, ctx.telefono, { role: 'user', content: mensajeUsuario });
        console.log('[Agente en pausa]', ctx.tenantId, ctx.telefono, controlMode);
        return null;
    }
    try { await usage.registrar(ctx.tenantId); } catch (_) { /* uso best-effort */ }

    const system = construirSystemPrompt(ctx.tenant, { owner: !!ctx.esOwner });
    const schemas = tools.schemas({ owner: !!ctx.esOwner, tenant: ctx.tenant });

    // Historial limpio (solo user/assistant de texto) + el mensaje nuevo.
    const previo = await conversations.get(ctx.tenantId, ctx.telefono);
    // A provider webhook is claimed and persisted before invoking the LLM. Webchat
    // messages have no provider ID and are appended only in the working copy.
    const mensajes = inbound.persisted
        ? [...previo]
        : [...previo, { role: 'user', content: mensajeUsuario }];

    let message = await llm.chat({ system, messages: mensajes, tools: schemas });

    let vueltas = 0;
    while (message.tool_calls && message.tool_calls.length && vueltas < 5) {
        vueltas++;
        mensajes.push(message); // copia de trabajo (NO se persiste)
        for (const call of message.tool_calls) {
            let resultado;
            try {
                const args = JSON.parse(call.function.arguments || '{}');
                resultado = await tools.ejecutar(call.function.name, args, ctx);
            } catch (err) {
                console.error('Error ejecutando tool:', err);
                resultado = 'ERROR: no se pudo completar.';
            }
            mensajes.push({ role: 'tool', tool_call_id: call.id, content: resultado });
        }
        message = await llm.chat({ system, messages: mensajes, tools: schemas });
    }

    let texto = limpiarParaWhatsApp((message.content || '').trim());
    const insp = inspeccionarRespuesta(texto);
    if (!insp.seguro) { console.error('[BLOQUEADO POR SEGURIDAD]', ctx.telefono, '| Motivo:', insp.motivo); texto = MENSAJE_SEGURO_FALLBACK; }
    if (!texto) texto = 'Perdona, me lo repites?';

    // Persistir SOLO el turno limpio: mensaje del usuario + respuesta final.
    if (!inbound.persisted) await conversations.push(ctx.tenantId, ctx.telefono, { role: 'user', content: mensajeUsuario });
    await conversations.push(ctx.tenantId, ctx.telefono, { role: 'assistant', content: texto });
    return texto;
}

module.exports = { responder };
