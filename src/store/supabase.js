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

function _setClientForTests(value) { client = value; warned = false; }

module.exports = {
    enabled,
    getClient,
    report,
    normalizedPhone,
    organizationForTenant,
    contactForPhone,
    conversationForPhone,
    _setClientForTests
};
