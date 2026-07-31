'use strict';

// Límites de uso para tenants de DEMOSTRACIÓN (business.demo === true).
//
// La demo de la landing es un endpoint público con un modelo detrás: sin tope, el
// coste lo decide quien pase por ahí. El rate limit por IP de server.js sigue
// vigente y cubre las RÁFAGAS, pero vive en memoria y se pierde en cada
// despliegue. Esto acota el uso SOSTENIDO y persiste en el volumen de /data.
//
// Las IP no se guardan en claro: solo un hash. Para contar no hace falta la IP
// real, y así este fichero no contiene datos personales.

const crypto = require('crypto');
const db = require('./_db');

const FILE = 'demo-limits.json';

const MAX_MENSAJES_SESION = 40;   // una conversación de demo no necesita más
const MAX_MENSAJES_IP_DIA = 150;  // margen para una oficina tras un mismo NAT
const MAX_SESIONES_IP_DIA = 12;   // recargar la página abre sesión nueva
const RETENCION_H = 48;

function hoy() {
    return new Date().toISOString().slice(0, 10);
}

function huella(ip) {
    return crypto.createHash('sha256').update(String(ip || 'desconocida')).digest('hex').slice(0, 16);
}

function vacio() {
    return { sesiones: {}, ips: {} };
}

// Tira lo viejo en cada escritura: sin esto el fichero crece sin fin.
function podar(estado) {
    const corte = Date.now() - RETENCION_H * 60 * 60 * 1000;
    const dia = hoy();

    for (const [clave, valor] of Object.entries(estado.sesiones)) {
        if (!(valor.ultimo >= corte)) delete estado.sesiones[clave];
    }
    for (const [clave, valor] of Object.entries(estado.ips)) {
        if (valor.dia !== dia) delete estado.ips[clave];
    }
    return estado;
}

/**
 * Cuenta un mensaje entrante y dice si se puede atender.
 * @returns {{ok: true} | {ok: false, motivo: string, respuesta: string}}
 */
function registrar(tenantId, { sesion, ip }) {
    const estado = podar(db.leer(tenantId, FILE, vacio()));
    const ahora = Date.now();
    const dia = hoy();
    const clave = String(sesion || 'sin-sesion');
    const ipKey = huella(ip);

    const s = estado.sesiones[clave] || { n: 0, primero: ahora, ultimo: ahora };
    const i = estado.ips[ipKey] || { n: 0, sesiones: [], dia };

    if (i.dia !== dia) { i.n = 0; i.sesiones = []; i.dia = dia; }
    if (!i.sesiones.includes(clave)) i.sesiones.push(clave);

    const excede =
        s.n >= MAX_MENSAJES_SESION
            ? { motivo: 'sesion', respuesta: 'Hasta aquí llega la demostración. Recarga la página para empezar otra conversación, o escríbenos y te la enseñamos con tu propio negocio.' }
            : i.n >= MAX_MENSAJES_IP_DIA
                ? { motivo: 'ip-dia', respuesta: 'Has usado bastante la demostración por hoy. Si quieres verla con los datos de tu negocio, escríbenos y la preparamos.' }
                : i.sesiones.length > MAX_SESIONES_IP_DIA
                    ? { motivo: 'ip-sesiones', respuesta: 'Has abierto muchas conversaciones de demostración hoy. Escríbenos y te la enseñamos con tu propio negocio.' }
                    : null;

    // El intento se contabiliza aunque se rechace: si no, reintentar sale gratis.
    s.n += 1;
    s.ultimo = ahora;
    i.n += 1;
    estado.sesiones[clave] = s;
    estado.ips[ipKey] = i;
    db.escribir(tenantId, FILE, estado);

    return excede ? { ok: false, ...excede } : { ok: true };
}

module.exports = { registrar, MAX_MENSAJES_SESION, MAX_MENSAJES_IP_DIA, MAX_SESIONES_IP_DIA };
