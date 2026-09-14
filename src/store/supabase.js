'use strict';

let client = null;
let warned = false;

function enabled() {
    return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getClient() {
    if (!enabled()) return null;
    if (!client) {
        const { createClient } = require('@supabase/supabase-js');
        client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
            global: { headers: { 'x-application-name': 'studio32-agent' } }
        });
    }
    return client;
}

function report(error, operation) {
    if (!warned) {
        warned = true;
        console.error(`[Supabase] ${operation}:`, error.message || error);
    }
}

async function organizationForTenant(tenantId) {
    const db = getClient();
    if (!db) return null;

    let result = await db.from('organizations').select('id, slug').eq('slug', tenantId).maybeSingle();
    if (result.error) throw result.error;
    if (result.data) return result.data;

    result = await db.from('organizations').insert({ slug: tenantId, name: tenantId, status: 'active' }).select('id, slug').single();
    if (!result.error) return result.data;

    // A concurrent webhook may have created the organization first.
    result = await db.from('organizations').select('id, slug').eq('slug', tenantId).single();
    if (result.error) throw result.error;
    return result.data;
}

function normalizedPhone(value) {
    return String(value || '').replace(/^whatsapp:/, '').trim();
}

async function contactForPhone(organizationId, phone, attributes = {}) {
    const db = getClient();
    const normalized = normalizedPhone(phone);
    if (!normalized) throw new Error('A phone or session identifier is required');

    let result = await db.from('contacts').select('*').eq('organization_id', organizationId).eq('phone', normalized).maybeSingle();
    if (result.error) throw result.error;
    if (result.data) {
        await db.from('contacts').update({ last_seen_at: new Date().toISOString(), attributes: { ...(result.data.attributes || {}), ...attributes } }).eq('id', result.data.id);
        return result.data;
    }

    result = await db.from('contacts').insert({ organization_id: organizationId, phone: normalized, source: attributes.source || 'agent', attributes }).select('*').single();
    if (!result.error) return result.data;
    result = await db.from('contacts').select('*').eq('organization_id', organizationId).eq('phone', normalized).single();
    if (result.error) throw result.error;
    return result.data;
}

async function conversationForPhone(tenantId, phone, options = {}) {
    const db = getClient();
    if (!db) return null;
    const organization = await organizationForTenant(tenantId);
    const contact = await contactForPhone(organization.id, phone, options.contactAttributes);

    let result = await db.from('conversations')
        .select('*')
        .eq('organization_id', organization.id)
        .eq('contact_id', contact.id)
        .in('status', ['open', 'waiting'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) {
        result = await db.from('conversations').insert({
            organization_id: organization.id,
            contact_id: contact.id,
            external_thread_id: normalizedPhone(phone),
            status: 'open',
            control_mode: 'agent'
        }).select('*').single();
        if (result.error) throw result.error;
    }
    return { db, organization, contact, conversation: result.data };
}

// Calendario conectado por la clínica desde el dashboard. Manda sobre cualquier
// calendar_id puesto a mano en archivo o en agent_configs. En la config del negocio
// solo viaja a qué organización pertenece: el acceso de Google no entra nunca en el
// objeto del tenant (llega hasta el prompt y los logs), se pide aparte cuando hace
// falta (integrations/googleCalendar).
function calendarioConectado(integration, organizationId, base) {
    const config = (integration && integration.config) || {};
    if (!integration || !['active', 'error'].includes(integration.status) || !config.calendar_id) return null;
    return {
        ...(base || {}),
        calendar_id: config.calendar_id,
        timezone: config.timezone || (base && base.timezone) || 'Europe/Madrid',
        provider: 'google_oauth',
        organization_id: organizationId
    };
}

function mergeRuntimeTenant(tenant, services, config, calendarIntegration = null, organizationId = null) {
    const mappedServices = (services || []).map(service => ({
        ...(service.settings || {}),
        id: service.external_key || service.id,
        nombre: service.name,
        descripcion: service.description || '',
        duracion_min: service.duration_minutes,
        precio_eur: service.price_amount === null ? null : Number(service.price_amount),
        activo: service.active
    })).filter(service => service.activo !== false);
    const business = { ...(tenant.business || {}), ...(config?.business || {}) };
    const conectado = calendarioConectado(calendarIntegration, organizationId, business.calendar);
    if (conectado) business.calendar = conectado;
    return {
        ...tenant,
        business,
        services: mappedServices.length ? { servicios: mappedServices } : tenant.services,
        faq: config?.faq ?? tenant.faq,
        policies: config?.policies ?? tenant.policies,
        tone: config?.tone ?? tenant.tone,
        handoff: { ...(tenant.handoff || {}), ...(config?.handoff_config || {}) }
    };
}

async function hydrateTenant(tenant) {
    if (!enabled()) return tenant;
    try {
        const organization = await organizationForTenant(tenant.id);
        const [services, config, calendar] = await Promise.all([
            getClient().from('services').select('*').eq('organization_id', organization.id).order('name'),
            getClient().from('agent_configs').select('business,faq,policies,tone,handoff_config').eq('organization_id', organization.id).eq('status', 'active').order('version', { ascending: false }).limit(1).maybeSingle(),
            getClient().from('integrations').select('status,config').eq('organization_id', organization.id).eq('provider', 'google_calendar').maybeSingle()
        ]);
        if (services.error) throw services.error;
        if (config.error) throw config.error;
        if (calendar.error) throw calendar.error;
        return mergeRuntimeTenant(tenant, services.data || [], config.data || null, calendar.data || null, organization.id);
    } catch (error) {
        report(error, 'hydrate tenant configuration; using files');
        return tenant;
    }
}

function _setClientForTests(value) { client = value; warned = false; }

module.exports = {
    enabled,
    getClient,
    report,
    normalizedPhone,
    organizationForTenant,
    contactForPhone,
    conversationForPhone,
    mergeRuntimeTenant,
    hydrateTenant,
    _setClientForTests
};
