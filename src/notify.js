'use strict';

// Avisos al equipo del NEGOCIO: email (Nodemailer) y, si está configurado,
// WhatsApp por el canal disponible (Meta Cloud API o Twilio). nodemailer y el canal Meta se cargan
// de forma perezosa. El destino va por tenant en handoff.json.
//
// Nota: enviar WhatsApp iniciado por el negocio fuera de la ventana de 24h
// requiere plantilla aprobada en Meta; el email no tiene esa limitación.

const { SMTP_HOST, SMTP_PORT = 587, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

let _mailer = null, _mailerTried = false;
function getMailer() {
    if (_mailerTried) return _mailer;
    _mailerTried = true;
    if (!SMTP_HOST) return null;
    const nodemailer = require('nodemailer');
    _mailer = nodemailer.createTransport({
        host: SMTP_HOST, port: Number(SMTP_PORT), secure: Number(SMTP_PORT) === 465,
        auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
    });
    return _mailer;
}

async function enviar(tenant, asunto, cuerpo) {
    const dest = tenant.handoff || {};
    const tareas = [];
    const mailer = getMailer();
    if (mailer && dest.email) tareas.push(mailer.sendMail({ from: SMTP_FROM || SMTP_USER, to: dest.email, subject: asunto, text: cuerpo }));
    if (dest.whatsapp) {
        const msg = `${asunto}\n\n${cuerpo}`;
        try {
            const meta = require('./channels/whatsapp.meta');
            const tw = require('./channels/whatsapp.twilio');
            if (meta.configurado()) tareas.push(meta.enviarMensaje(dest.whatsapp.replace(/[^0-9]/g, ''), msg));
            else if (tw.configurado()) tareas.push(tw.enviarMensaje(dest.whatsapp, msg));
        } catch (_) { /* canal no disponible */ }
    }
    if (tareas.length === 0) { console.log(`[NOTIFY · sin canales configurados]\n${asunto}\n${cuerpo}`); return; }
    const r = await Promise.allSettled(tareas);
    r.forEach((x, i) => { if (x.status === 'rejected') console.error(`Aviso ${i} falló:`, x.reason?.message || x.reason); });
}

async function notificarLead(tenant, lead) {
    const c = `Nuevo LEAD · ${tenant.business.nombre || ''}\n\nNombre: ${lead.nombre}\nContacto: ${lead.contacto}\nTipo de negocio: ${lead.tipo_negocio || '-'}\nCiudad: ${lead.ciudad || '-'}\nNecesidad: ${lead.necesidad || '-'}\nPrefiere contacto: ${lead.preferencia_contacto || '-'}\nWhatsApp del cliente: ${lead.telefono_cliente || '-'}`;
    return enviar(tenant, `Nuevo lead · ${lead.nombre}`, c);
}
async function notificarReserva(tenant, r) {
    const c = `Nueva RESERVA · ${tenant.business.nombre || ''}\n\nCliente: ${r.nombre}\nContacto: ${r.contacto}\nServicio: ${r.servicio}\nDía: ${r.fecha} ${r.hora}${r.comensales ? `\nComensales: ${r.comensales}` : ``}\nProfesional: ${r.profesional || '-'}\nWhatsApp del cliente: ${r.telefono_cliente || '-'}\nID: ${r.id}`;
    return enviar(tenant, `Nueva reserva · ${r.fecha} ${r.hora} · ${r.nombre}`, c);
}
async function notificarCancelacion(tenant, r) {
    const c = `CITA CANCELADA · ${tenant.business.nombre || ''}\n\nCliente: ${r.nombre}\nContacto: ${r.contacto}\nServicio: ${r.servicio}\nEra: ${r.fecha} ${r.hora}\nProfesional: ${r.profesional || '-'}\nID: ${r.id}`;
    return enviar(tenant, `Cita cancelada · ${r.fecha} ${r.hora} · ${r.nombre}`, c);
}
async function notificarReprogramacion(tenant, r) {
    const c = `CITA REPROGRAMADA · ${tenant.business.nombre || ''}\n\nCliente: ${r.nombre}\nContacto: ${r.contacto}\nServicio: ${r.servicio}\nAntes: ${r.fecha_anterior} ${r.hora_anterior}\nAhora: ${r.fecha} ${r.hora}\nProfesional: ${r.profesional || '-'}\nID: ${r.id}`;
    return enviar(tenant, `Cita reprogramada · ${r.fecha} ${r.hora} · ${r.nombre}`, c);
}
async function notificarHandoff(tenant, h) {
    const c = `DERIVAR A HUMANO · ${tenant.business.nombre || ''}\n\nMotivo: ${h.motivo}\nResumen: ${h.resumen || '-'}\nWhatsApp del cliente: ${h.telefono || '-'}`;
    return enviar(tenant, `Handoff · ${tenant.business.nombre || ''}`, c);
}

module.exports = { notificarLead, notificarReserva, notificarCancelacion, notificarReprogramacion, notificarHandoff };
