'use strict';

// Leads captados por tenant.

const db = require('./_db');
const remote = require('./supabase');
const FILE = 'leads.json';

async function listar(tenantId) {
    if (remote.enabled()) {
        try {
            const organization = await remote.organizationForTenant(tenantId);
            const result = await remote.getClient().from('leads').select('*, contacts(name, phone, email)').eq('organization_id', organization.id).order('created_at', { ascending: false });
            if (result.error) throw result.error;
            return (result.data || []).map(row => ({ id: row.id, creado: row.created_at, estado: row.status, necesidad: row.need, ciudad: row.city, ...(row.metadata || {}), contacto: row.contacts?.phone || row.contacts?.email, nombre: row.contacts?.name }));
        } catch (error) { remote.report(error, 'read leads; using JSON'); }
    }
    return db.leer(tenantId, FILE, []);
}
async function crear(tenantId, datos) {
    const all = await listar(tenantId);
    const lead = { id: db.id(), creado: new Date().toISOString(), ...datos };
    all.push(lead);
    db.escribir(tenantId, FILE, all);
    if (remote.enabled()) {
        try {
            const organization = await remote.organizationForTenant(tenantId);
            const phone = datos.telefono_cliente || datos.contacto;
            const contact = await remote.contactForPhone(organization.id, phone, { source: 'lead' });
            await remote.getClient().from('contacts').update({ name: datos.nombre || null, email: String(datos.contacto || '').includes('@') ? datos.contacto : null }).eq('id', contact.id);
            const result = await remote.getClient().from('leads').insert({
                organization_id: organization.id,
                contact_id: contact.id,
                need: datos.necesidad || null,
                city: datos.ciudad || null,
                preferred_contact_method: datos.preferencia_contacto || null,
                metadata: { ...datos, legacy_id: lead.id }
            });
            if (result.error) throw result.error;
        } catch (error) { remote.report(error, 'write lead; JSON retained'); }
    }
    return lead;
}

module.exports = { listar, crear };
