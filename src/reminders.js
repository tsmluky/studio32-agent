'use strict';

// Recordatorios opt-in por negocio. Solo marcar éxito si el proveedor lo acepta.
// Las plantillas/ventana de WhatsApp deben validarse antes de activar producción.
const tenants = require('./tenants');
const db = require('./store/_db');
const { zonedDateTimeToIso } = require('./store/bookings');
const { serializar } = require('./bookingLock');
const { puedeResponder } = require('./controlGuard');

function pendientes(reservas, ahora = new Date(), timezone = 'Europe/Madrid') {
    const out = [];
    for (const r of reservas) {
        if (r.estado !== 'confirmada' || !r.fecha || !r.hora) continue;
        let inicio;
        try { inicio = Date.parse(zonedDateTimeToIso(r.fecha, r.hora, timezone)); }
        catch (_) { continue; }
        const h = (inicio - ahora.getTime()) / 3600000;
        if (h > 0 && h <= 2.5 && !r.recordado_2h) out.push({ r, tipo:'2h' });
        else if (h >= 20 && h <= 26 && !r.recordado_24h) out.push({ r, tipo:'24h' });
    }
    return out;
}

function canal(tenant) {
    const settings = tenant.business.recordatorios;
    if (settings?.enabled !== true) return null;
    if (settings.provider === 'whatsapp_meta') {
        const meta = require('./channels/whatsapp.meta');
        if (settings.phone_number_id && settings.phone_number_id === process.env.META_PHONE_NUMBER_ID && meta.configurado()) {
            return (phone, msg) => meta.enviarMensaje(String(phone).replace(/[^0-9]/g, ''), msg);
        }
    }
    if (settings.provider === 'whatsapp_twilio') {
        const twilio = require('./channels/whatsapp.twilio');
        const number = String(tenant.business.whatsapp_number || '').replace(/[^0-9]/g, '');
        const sender = String(process.env.TWILIO_WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '');
        if (number && number === sender && twilio.configurado()) return twilio.enviarMensaje;
    }
    return null;
}

function mensaje(tenant, r, tipo) {
    const cuando = tipo === '2h' ? `hoy a las ${r.hora}` : `el ${r.fecha} a las ${r.hora}`;
    return `Hola ${r.nombre}, te recordamos tu reserva en ${tenant.business.nombre || 'el local'} ${cuando}. Si no puedes venir, respóndenos por aquí y la cambiamos o cancelamos.`;
}

let running = false;
async function revisar() {
    if (running) return;
    running = true;
    try {
        for (const id of tenants.listarTenantIds()) {
            let tenant;
            try { tenant = tenants.cargarTenant(id); } catch (_) { continue; }
            if (tenant.business.demo === true || tenant.business._estado === 'borrador') continue;
            const enviar = canal(tenant);
            if (!enviar) continue;
            const timezone = tenant.business.calendar?.timezone || tenant.business.timezone || 'Europe/Madrid';
            const lista = pendientes(db.leer(id, 'bookings.json', []), new Date(), timezone);
            for (const item of lista) {
                await serializar(id, async () => {
                    const current = db.leer(id, 'bookings.json', []).find(r => r.id === item.r.id);
                    if (!current || current.fecha !== item.r.fecha || current.hora !== item.r.hora) return;
                    if (!/^(?:whatsapp:)?\+?\d{7,15}$/.test(current.telefono_cliente || '')) return;
                    const due = pendientes([current], new Date(), timezone).find(entry => entry.tipo === item.tipo);
                    if (!due || !await puedeResponder({ tenantId:id, telefono:current.telefono_cliente })) return;
                    try {
                        if (await enviar(current.telefono_cliente, mensaje(tenant, current, item.tipo)) !== true) return;
                        // Releer tras el await: no sobrescribir reservas añadidas o modificadas.
                        const latest = db.leer(id, 'bookings.json', []);
                        const record = latest.find(r => r.id === current.id);
                        if (!record || record.estado !== 'confirmada' || record.fecha !== current.fecha || record.hora !== current.hora) return;
                        record[item.tipo === '2h' ? 'recordado_2h' : 'recordado_24h'] = new Date().toISOString();
                        db.escribir(id, 'bookings.json', latest);
                        console.log(`[RECORDATORIO ${item.tipo}] enviado para ${id}`);
                    } catch (error) { console.error(`Recordatorio ${item.tipo} falló (${id}):`, error.message); }
                });
            }
        }
    } finally { running = false; }
}

let timer = null;
function iniciar(intervalMin = 10) {
    if (timer) return;
    const run = () => revisar().catch(error => console.error('Recordatorios:', error.message));
    run(); timer = setInterval(run, intervalMin * 60000); timer.unref?.();
    console.log(`Revisión de recordatorios cada ${intervalMin} min; solo negocios habilitados.`);
}

module.exports = { iniciar, revisar, pendientes };
