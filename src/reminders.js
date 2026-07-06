'use strict';

// Recordatorios de reserva al CLIENTE (24h y 2h antes) por WhatsApp.
// Solo envía si hay canal configurado (Meta o Twilio) y la reserva tiene
// telefono_cliente; si no, deja constancia en el log y marca la reserva para
// no reintentar en bucle.
//
// Nota Meta/WhatsApp: un mensaje iniciado por el negocio fuera de la ventana de
// 24h desde el último mensaje del cliente requiere PLANTILLA aprobada. El
// recordatorio de 24h puede chocar con esto en producción (pendiente de alta de
// plantilla); el de 2h suele caer dentro de la ventana si la reserva es del día.

const fs = require('fs');
const { PATHS } = require('./config');
const { cargarTenant } = require('./tenants');
const db = require('./store/_db');

function aFecha(fecha, hora) {
    const [d, m, y] = fecha.split('/').map(Number);
    const [H, M] = hora.split(':').map(Number);
    return new Date(y, m - 1, d, H, M || 0);
}

// Pura (testeable): qué recordatorios tocan ahora.
// 2h: faltan 0–2,5h y no avisado. 24h: faltan 20–26h y no avisado.
function pendientes(reservas, ahora = new Date()) {
    const out = [];
    for (const r of reservas) {
        if (r.estado !== 'confirmada' || !r.fecha || !r.hora) continue;
        const h = (aFecha(r.fecha, r.hora).getTime() - ahora.getTime()) / 3600000;
        if (h > 0 && h <= 2.5 && !r.recordado_2h) out.push({ r, tipo: '2h' });
        else if (h >= 20 && h <= 26 && !r.recordado_24h) out.push({ r, tipo: '24h' });
    }
    return out;
}

function canal() {
    try {
        const meta = require('./channels/whatsapp.meta');
        if (meta.configurado()) return (tel, msg) => meta.enviarMensaje(String(tel).replace(/[^0-9]/g, ''), msg);
    } catch (_) { /* no disponible */ }
    try {
        const tw = require('./channels/whatsapp.twilio');
        if (tw.configurado()) return (tel, msg) => tw.enviarMensaje(tel, msg);
    } catch (_) { /* no disponible */ }
    return null;
}

function mensaje(tenant, r, tipo) {
    const cuando = tipo === '2h' ? `hoy a las ${r.hora}` : `el ${r.fecha} a las ${r.hora}`;
    const pax = r.comensales ? ` (${r.comensales} personas)` : '';
    return `Hola ${r.nombre}, te recordamos tu reserva en ${tenant.business.nombre || 'el local'}${pax} ${cuando}. Si no puedes venir, respóndenos por aquí y la cambiamos o cancelamos. ¡Hasta pronto!`;
}

async function revisar() {
    const enviar = canal();
    let dirs = [];
    try {
        dirs = fs.readdirSync(PATHS.tenants, { withFileTypes: true })
            .filter(d => d.isDirectory()).map(d => d.name);
    } catch (_) { return; }

    for (const id of dirs) {
        let tenant;
        try { tenant = cargarTenant(id); } catch (_) { continue; }
        if ((tenant.business._estado || '') === 'borrador') continue;

        const all = db.leer(id, 'bookings.json', []);
        const lista = pendientes(all);
        if (!lista.length) continue;

        for (const { r, tipo } of lista) {
            r[tipo === '2h' ? 'recordado_2h' : 'recordado_24h'] = new Date().toISOString();
            if (enviar && r.telefono_cliente) {
                try {
                    await enviar(r.telefono_cliente, mensaje(tenant, r, tipo));
                    console.log(`[RECORDATORIO ${tipo}] ${id} · ${r.fecha} ${r.hora} → ${r.telefono_cliente}`);
                } catch (err) {
                    console.error(`Recordatorio ${tipo} falló (${id} ${r.id}):`, err.message);
                }
            } else {
                console.log(`[RECORDATORIO ${tipo} · sin canal WhatsApp o sin teléfono] ${id} · ${r.fecha} ${r.hora} (${r.nombre})`);
            }
        }
        db.escribir(id, 'bookings.json', all);
    }
}

let _timer = null;
function iniciar(intervalMin = 10) {
    if (_timer) return;
    revisar().catch(e => console.error('Recordatorios:', e.message));
    _timer = setInterval(() => revisar().catch(e => console.error('Recordatorios:', e.message)), intervalMin * 60000);
    if (_timer.unref) _timer.unref();
    console.log(`Recordatorios de reserva activos (cada ${intervalMin} min).`);
}

module.exports = { iniciar, revisar, pendientes };
