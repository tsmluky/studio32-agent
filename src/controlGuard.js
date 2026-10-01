'use strict';

const conversations = require('./store/conversations');

// Una lectura desconocida o fallida no autoriza al agente a actuar.
async function puedeResponder(ctx) {
    try { return await conversations.controlMode(ctx.tenantId, ctx.telefono) === 'agent'; }
    catch (error) {
        console.error('[Control no verificable]', error.message);
        return false;
    }
}

module.exports = { puedeResponder };
