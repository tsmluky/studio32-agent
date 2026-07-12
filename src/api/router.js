'use strict';

const express = require('express');
const remote = require('../store/supabase');
const auth = require('./auth');
const twilio = require('../channels/whatsapp.twilio');
const meta = require('../channels/whatsapp.meta');

const WRITE_ROLES = ['owner', 'admin', 'operator'];

function asyncRoute(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireOrganization(req, res, allowedRoles = null) {
    const organizationId = req.query.organization_id || req.body?.organization_id;
    if (!organizationId) {
        res.status(400).json({ error: 'organization_id is required.' });
        return null;
    }
    const access = auth.membership(req, organizationId, allowedRoles);
    if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return null;
    }
    return { organizationId, role: access.role };
}

async function conversationForMember(req, res, allowedRoles = null) {
    const db = remote.getClient();
    const result = await db.from('conversations').select('*').eq('id', req.params.id).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) {
        res.status(404).json({ error: 'Conversation not found.' });
        return null;
    }
    const access = auth.membership(req, result.data.organization_id, allowedRoles);
    if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return null;
    }
    return { db, conversation: result.data, role: access.role };
}

async function contactMap(db, organizationId, ids) {
    if (!ids.length) return new Map();
    const result = await db.from('contacts').select('id,name,phone,email,status,last_seen_at').eq('organization_id', organizationId).in('id', ids);
    if (result.error) throw result.error;
    return new Map((result.data || []).map(row => [row.id, row]));
}

async function serviceMap(db, organizationId, ids) {
    if (!ids.length) return new Map();
    const result = await db.from('services').select('id,name,duration_minutes,price_amount,currency').eq('organization_id', organizationId).in('id', ids);
    if (result.error) throw result.error;
    return new Map((result.data || []).map(row => [row.id, row]));
}

async function entityForMember(req, res, table, allowedRoles = null) {
    const db = remote.getClient();
    const result = await db.from(table).select('*').eq('id', req.params.id).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) {
        res.status(404).json({ error: `${table.slice(0, -1)} not found.` });
        return null;
    }
    const access = auth.membership(req, result.data.organization_id, allowedRoles);
    if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return null;
    }
    return { db, entity: result.data, role: access.role };
}

function createRouter() {
    const router = express.Router();
    router.use(auth.authenticate);

    router.get('/me', asyncRoute(async (req, res) => {
        const db = remote.getClient();
        const ids = [...req.apiAuth.memberships.keys()];
        let organizations = [];
        if (ids.length) {
            const result = await db.from('organizations').select('id,slug,name,status,timezone,locale').in('id', ids).order('name');
            if (result.error) throw result.error;
            organizations = (result.data || []).map(org => ({ ...org, role: req.apiAuth.memberships.get(org.id) }));
        }
        res.json({ user: { id: req.apiAuth.user.id, email: req.apiAuth.user.email }, organizations });
    }));

    router.get('/inbox', asyncRoute(async (req, res) => {
        const scope = requireOrganization(req, res);
        if (!scope) return;
        const db = remote.getClient();
        let query = db.from('conversations')
            .select('id,contact_id,status,control_mode,assigned_user_id,subject,last_message_at,created_at,updated_at')
            .eq('organization_id', scope.organizationId)
            .order('last_message_at', { ascending: false, nullsFirst: false })
            .limit(Math.min(Number(req.query.limit) || 50, 100));
        if (req.query.status) query = query.eq('status', req.query.status);
        if (req.query.control_mode) query = query.eq('control_mode', req.query.control_mode);
        const result = await query;
        if (result.error) throw result.error;
        const contacts = await contactMap(db, scope.organizationId, [...new Set((result.data || []).map(row => row.contact_id))]);
        res.json({ conversations: (result.data || []).map(row => ({ ...row, contact: contacts.get(row.contact_id) || null })) });
    }));

    router.get('/summary', asyncRoute(async (req, res) => {
        const scope = requireOrganization(req, res);
        if (!scope) return;
        const db = remote.getClient();
        const now = new Date();
        const dayStart = req.query.from || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
        const dayEnd = req.query.to || new Date(new Date(dayStart).getTime() + 86400000).toISOString();
        const [open, human, handoffs, appointments, nextAppointments] = await Promise.all([
            db.from('conversations').select('id', { count: 'exact', head: true }).eq('organization_id', scope.organizationId).in('status', ['open', 'waiting']),
            db.from('conversations').select('id', { count: 'exact', head: true }).eq('organization_id', scope.organizationId).eq('control_mode', 'human').in('status', ['open', 'waiting']),
            db.from('handoffs').select('id', { count: 'exact', head: true }).eq('organization_id', scope.organizationId).in('status', ['open', 'accepted']),
            db.from('appointments').select('id', { count: 'exact', head: true }).eq('organization_id', scope.organizationId).gte('starts_at', dayStart).lt('starts_at', dayEnd).neq('status', 'cancelled'),
            db.from('appointments').select('id,starts_at,status,resource_name,contact_id,service_id').eq('organization_id', scope.organizationId).gte('starts_at', new Date().toISOString()).neq('status', 'cancelled').order('starts_at').limit(5)
        ]);
        const failed = [open, human, handoffs, appointments, nextAppointments].find(item => item.error);
        if (failed) throw failed.error;
        const contacts = await contactMap(db, scope.organizationId, [...new Set((nextAppointments.data || []).map(row => row.contact_id))]);
        const services = await serviceMap(db, scope.organizationId, [...new Set((nextAppointments.data || []).map(row => row.service_id).filter(Boolean))]);
        res.json({
            metrics: { open_conversations: open.count || 0, human_conversations: human.count || 0, pending_handoffs: handoffs.count || 0, appointments_today: appointments.count || 0 },
            next_appointments: (nextAppointments.data || []).map(row => ({ ...row, contact: contacts.get(row.contact_id) || null, service: services.get(row.service_id) || null }))
        });
    }));

    router.get('/appointments', asyncRoute(async (req, res) => {
        const scope = requireOrganization(req, res);
        if (!scope) return;
        const db = remote.getClient();
        let query = db.from('appointments')
            .select('id,contact_id,conversation_id,service_id,status,starts_at,ends_at,resource_name,notes,metadata,external_calendar_event_id,created_at,updated_at')
            .eq('organization_id', scope.organizationId)
            .order('starts_at')
            .limit(Math.min(Number(req.query.limit) || 100, 250));
        if (req.query.from) query = query.gte('starts_at', req.query.from);
        if (req.query.to) query = query.lt('starts_at', req.query.to);
        if (req.query.status) query = query.eq('status', req.query.status);
        const result = await query;
        if (result.error) throw result.error;
        const contacts = await contactMap(db, scope.organizationId, [...new Set((result.data || []).map(row => row.contact_id))]);
        const services = await serviceMap(db, scope.organizationId, [...new Set((result.data || []).map(row => row.service_id).filter(Boolean))]);
        res.json({ appointments: (result.data || []).map(row => ({ ...row, contact: contacts.get(row.contact_id) || null, service: services.get(row.service_id) || null })) });
    }));

    router.post('/appointments/:id/cancel', asyncRoute(async (req, res) => {
        const context = await entityForMember(req, res, 'appointments', WRITE_ROLES);
        if (!context) return;
        if (context.entity.status === 'cancelled') return res.json({ appointment: context.entity });
        const result = await context.db.from('appointments').update({ status: 'cancelled', metadata: { ...(context.entity.metadata || {}), cancelled_by: 'panel', cancelled_at: new Date().toISOString() } }).eq('id', context.entity.id).select('*').single();
        if (result.error) throw result.error;
        await context.db.from('audit_logs').insert({ organization_id: context.entity.organization_id, actor_user_id: req.apiAuth.user.id, actor_type: 'user', action: 'appointment.cancel', entity_type: 'appointment', entity_id: context.entity.id });
        res.json({ appointment: result.data });
    }));

    router.get('/services', asyncRoute(async (req, res) => {
        const scope = requireOrganization(req, res);
        if (!scope) return;
        const result = await remote.getClient().from('services').select('*').eq('organization_id', scope.organizationId).order('active', { ascending: false }).order('name');
        if (result.error) throw result.error;
        res.json({ services: result.data || [] });
    }));

    router.patch('/services/:id', asyncRoute(async (req, res) => {
        const context = await entityForMember(req, res, 'services', WRITE_ROLES);
        if (!context) return;
        const allowed = ['name', 'description', 'duration_minutes', 'price_amount', 'currency', 'active', 'settings'];
        const changes = Object.fromEntries(allowed.filter(key => Object.hasOwn(req.body || {}, key)).map(key => [key, req.body[key]]));
        if (!Object.keys(changes).length) return res.status(400).json({ error: 'No editable service fields supplied.' });
        const result = await context.db.from('services').update(changes).eq('id', context.entity.id).select('*').single();
        if (result.error) throw result.error;
        await context.db.from('audit_logs').insert({ organization_id: context.entity.organization_id, actor_user_id: req.apiAuth.user.id, actor_type: 'user', action: 'service.update', entity_type: 'service', entity_id: context.entity.id, data: { fields: Object.keys(changes) } });
        res.json({ service: result.data });
    }));

    router.get('/agent-config', asyncRoute(async (req, res) => {
        const scope = requireOrganization(req, res);
        if (!scope) return;
        const result = await remote.getClient().from('agent_configs').select('*').eq('organization_id', scope.organizationId).eq('status', 'active').order('version', { ascending: false }).limit(1).maybeSingle();
        if (result.error) throw result.error;
        res.json({ config: result.data || null });
    }));

    router.patch('/agent-config/:id', asyncRoute(async (req, res) => {
        const context = await entityForMember(req, res, 'agent_configs', ['owner', 'admin']);
        if (!context) return;
        const allowed = ['business', 'faq', 'policies', 'tone', 'handoff_config'];
        const changes = Object.fromEntries(allowed.filter(key => Object.hasOwn(req.body || {}, key)).map(key => [key, req.body[key]]));
        if (!Object.keys(changes).length) return res.status(400).json({ error: 'No editable agent fields supplied.' });
        const result = await context.db.from('agent_configs').update(changes).eq('id', context.entity.id).select('*').single();
        if (result.error) throw result.error;
        await context.db.from('audit_logs').insert({ organization_id: context.entity.organization_id, actor_user_id: req.apiAuth.user.id, actor_type: 'user', action: 'agent_config.update', entity_type: 'agent_config', entity_id: context.entity.id, data: { fields: Object.keys(changes) } });
        res.json({ config: result.data });
    }));

    router.get('/conversations/:id/messages', asyncRoute(async (req, res) => {
        const context = await conversationForMember(req, res);
        if (!context) return;
        const result = await context.db.from('messages')
            .select('id,direction,sender_type,sender_user_id,content_type,body,status,occurred_at,payload')
            .eq('conversation_id', context.conversation.id)
            .order('occurred_at', { ascending: true })
            .limit(Math.min(Number(req.query.limit) || 200, 500));
        if (result.error) throw result.error;
        res.json({ conversation: context.conversation, messages: result.data || [] });
    }));

    router.post('/conversations/:id/takeover', asyncRoute(async (req, res) => {
        const context = await conversationForMember(req, res, WRITE_ROLES);
        if (!context) return;
        const now = new Date().toISOString();
        const update = await context.db.from('conversations').update({
            control_mode: 'human',
            assigned_user_id: req.apiAuth.user.id,
            agent_paused_at: now
        }).eq('id', context.conversation.id).select('*').single();
        if (update.error) throw update.error;
        const open = await context.db.from('handoffs').select('id').eq('conversation_id', context.conversation.id).in('status', ['open', 'accepted']).limit(1).maybeSingle();
        if (open.error) throw open.error;
        if (open.data) {
            const accepted = await context.db.from('handoffs').update({ status: 'accepted', assigned_user_id: req.apiAuth.user.id, accepted_at: now }).eq('id', open.data.id);
            if (accepted.error) throw accepted.error;
        } else {
            const created = await context.db.from('handoffs').insert({
                organization_id: context.conversation.organization_id,
                conversation_id: context.conversation.id,
                requested_by: 'human',
                reason: req.body?.reason || 'Operator takeover',
                status: 'accepted',
                assigned_user_id: req.apiAuth.user.id,
                accepted_at: now
            });
            if (created.error) throw created.error;
        }
        await context.db.from('audit_logs').insert({ organization_id: context.conversation.organization_id, actor_user_id: req.apiAuth.user.id, actor_type: 'user', action: 'conversation.takeover', entity_type: 'conversation', entity_id: context.conversation.id });
        res.json({ conversation: update.data });
    }));

    router.post('/conversations/:id/release', asyncRoute(async (req, res) => {
        const context = await conversationForMember(req, res, WRITE_ROLES);
        if (!context) return;
        const now = new Date().toISOString();
        const update = await context.db.from('conversations').update({ control_mode: 'agent', assigned_user_id: null, agent_paused_at: null }).eq('id', context.conversation.id).select('*').single();
        if (update.error) throw update.error;
        const handoffs = await context.db.from('handoffs').update({ status: 'resolved', resolved_at: now }).eq('conversation_id', context.conversation.id).in('status', ['open', 'accepted']);
        if (handoffs.error) throw handoffs.error;
        await context.db.from('audit_logs').insert({ organization_id: context.conversation.organization_id, actor_user_id: req.apiAuth.user.id, actor_type: 'user', action: 'conversation.release', entity_type: 'conversation', entity_id: context.conversation.id });
        res.json({ conversation: update.data });
    }));

    router.post('/conversations/:id/resolve', asyncRoute(async (req, res) => {
        const context = await conversationForMember(req, res, WRITE_ROLES);
        if (!context) return;
        const update = await context.db.from('conversations').update({ status: 'resolved' }).eq('id', context.conversation.id).select('*').single();
        if (update.error) throw update.error;
        await context.db.from('audit_logs').insert({ organization_id: context.conversation.organization_id, actor_user_id: req.apiAuth.user.id, actor_type: 'user', action: 'conversation.resolve', entity_type: 'conversation', entity_id: context.conversation.id });
        res.json({ conversation: update.data });
    }));

    router.post('/conversations/:id/messages', asyncRoute(async (req, res) => {
        const context = await conversationForMember(req, res, WRITE_ROLES);
        if (!context) return;
        const body = String(req.body?.body || '').trim().slice(0, 4000);
        if (!body) return res.status(400).json({ error: 'body is required.' });
        if (context.conversation.control_mode !== 'human') return res.status(409).json({ error: 'Take over the conversation before sending a human message.' });

        const contactResult = await context.db.from('contacts').select('phone').eq('id', context.conversation.contact_id).single();
        if (contactResult.error) throw contactResult.error;
        const lastInbound = await context.db.from('messages').select('payload').eq('conversation_id', context.conversation.id).eq('direction', 'inbound').order('occurred_at', { ascending: false }).limit(1).maybeSingle();
        if (lastInbound.error) throw lastInbound.error;
        const channel = req.body?.channel || lastInbound.data?.payload?.provider;
        let sent = false;
        if (channel === 'whatsapp_twilio') sent = await twilio.enviarMensaje(contactResult.data.phone, body);
        else if (channel === 'whatsapp_meta') sent = await meta.enviarMensaje(contactResult.data.phone, body);
        else if (channel === 'web') sent = true;
        else return res.status(409).json({ error: 'No delivery channel is available for this conversation.' });
        if (!sent) return res.status(503).json({ error: `Delivery channel ${channel} is not configured.` });

        const now = new Date().toISOString();
        const inserted = await context.db.from('messages').insert({
            organization_id: context.conversation.organization_id,
            conversation_id: context.conversation.id,
            direction: 'outbound',
            sender_type: 'human',
            sender_user_id: req.apiAuth.user.id,
            body,
            payload: { provider: channel },
            status: channel === 'web' ? 'accepted' : 'sent',
            occurred_at: now
        }).select('*').single();
        if (inserted.error) throw inserted.error;
        await context.db.from('conversations').update({ last_message_at: now }).eq('id', context.conversation.id);
        await context.db.from('audit_logs').insert({ organization_id: context.conversation.organization_id, actor_user_id: req.apiAuth.user.id, actor_type: 'user', action: 'message.send', entity_type: 'message', entity_id: inserted.data.id, data: { channel } });
        res.status(201).json({ message: inserted.data });
    }));

    router.use((error, _req, res, _next) => {
        console.error('[API]', error.message || error);
        res.status(500).json({ error: 'Internal API error.' });
    });
    return router;
}

module.exports = { createRouter, requireOrganization, conversationForMember };
