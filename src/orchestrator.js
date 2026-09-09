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
const remote = require('./store/supabase');
const { inspeccionarRespuesta, limpiarParaWhatsApp, MENSAJE_SEGURO_FALLBACK } = require('./safety');
const { revisarConfirmacion } = require('./confirmacion');

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
        if (!inbound.persisted) await conversations.push(ctx.tenantId, ctx.telefono, { role: 'user', content: mensajeUsuario, provider: ctx.channel });
        console.log('[Agente en pausa]', ctx.tenantId, ctx.telefono, controlMode);
        return null;
    }
    try { await usage.registrar(ctx.tenantId); } catch (_) { /* uso best-effort */ }

    const runtimeTenant = await remote.hydrateTenant(ctx.tenant);
    const runtimeCtx = { ...ctx, tenant: runtimeTenant };
    const system = construirSystemPrompt(runtimeTenant, { owner: !!ctx.esOwner });
    const schemas = tools.schemas({ owner: !!ctx.esOwner, tenant: runtimeTenant });

    // Historial limpio (solo user/assistant de texto) + el mensaje nuevo.
    const previo = await conversations.get(ctx.tenantId, ctx.telefono);
    // A provider webhook is claimed and persisted before invoking the LLM. Webchat
    // messages have no provider ID and are appended only in the working copy.
    const mensajes = inbound.persisted
        ? [...previo]
        : [...previo, { role: 'user', content: mensajeUsuario }];

    let message = await llm.chat({ system, messages: mensajes, tools: schemas });

    const MAX_VUELTAS = 5;
    let vueltas = 0;
    while (message.tool_calls && message.tool_calls.length && vueltas < MAX_VUELTAS) {
        vueltas++;
        mensajes.push(message); // copia de trabajo (NO se persiste)
        for (const call of message.tool_calls) {
            let resultado;
            try {
                const args = JSON.parse(call.function.arguments || '{}');
                resultado = await tools.ejecutar(call.function.name, args, runtimeCtx);
            } catch (err) {
                console.error('Error ejecutando tool:', err);
                resultado = 'ERROR: no se pudo completar.';
            }
            mensajes.push({ role: 'tool', tool_call_id: call.id, content: resultado });
        }
        message = await llm.chat({ system, messages: mensajes, tools: schemas });
    }

    // El modelo se quedó dando vueltas entre herramientas y se acabó el margen. Antes
    // esto terminaba en un "Perdona, me lo repites?" indistinguible de cualquier otro
    // fallo; ahora se ve en el log, que es la única forma de saber si pasa a menudo.
    if (message.tool_calls && message.tool_calls.length) {
        console.error('[BUCLE DE HERRAMIENTAS]', ctx.tenantId, ctx.telefono, '| se agotaron las', MAX_VUELTAS, 'vueltas | últimas:', message.tool_calls.map(c => c.function.name).join(', '));
    }

    let texto = limpiarParaWhatsApp((message.content || '').trim());

    // Respuesta vacía: el modelo "piensa" y no escribe nada. Pasa de verdad según el
    // modelo que haya detrás, y sin este aviso solo se descubre trazando a mano.
    if (!texto) {
        console.error('[RESPUESTA VACÍA]', ctx.tenantId, ctx.telefono, '| modelo:', llm.MODEL, '| herramientas en la última vuelta:', (message.tool_calls || []).length);
    }

    const insp = inspeccionarRespuesta(texto);
    if (!insp.seguro) { console.error('[BLOQUEADO POR SEGURIDAD]', ctx.telefono, '| Motivo:', insp.motivo); texto = MENSAJE_SEGURO_FALLBACK; }
    // Antes de que salga: si da la cita por hecha, que la cita exista y sea a la hora
    // que dice. Ver src/confirmacion.js — no es paranoia, es un fallo observado.
    texto = await revisarConfirmacion(runtimeCtx, texto);
    // Última red. No promete un mensaje futuro (no puede enviarlo) ni echa la culpa al
    // cliente: le pide que lo repita, que es lo único que sí desbloquea la situación.
    if (!texto) texto = 'Perdona, se me ha cruzado algo y no te he contestado bien. ¿Me lo repites?';

    // Persistir SOLO el turno limpio: mensaje del usuario + respuesta final.
    if (!inbound.persisted) await conversations.push(ctx.tenantId, ctx.telefono, { role: 'user', content: mensajeUsuario, provider: ctx.channel });
    await conversations.push(ctx.tenantId, ctx.telefono, { role: 'assistant', content: texto, provider: ctx.channel });
    return texto;
}

module.exports = { responder };
