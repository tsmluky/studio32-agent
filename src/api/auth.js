'use strict';

const remote = require('../store/supabase');

function bearerToken(header) {
    const match = String(header || '').match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : null;
}

async function authenticate(req, res, next) {
    const token = bearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ error: 'Authorization bearer token required.' });
    if (!remote.enabled()) return res.status(503).json({ error: 'Supabase is not configured.' });

    try {
        const db = remote.getClient();
        const auth = await db.auth.getUser(token);
        if (auth.error || !auth.data?.user) return res.status(401).json({ error: 'Invalid or expired session.' });
        const memberships = await db.from('organization_members')
            .select('organization_id, role')
            .eq('user_id', auth.data.user.id);
        if (memberships.error) throw memberships.error;
        req.apiAuth = {
            token,
            user: auth.data.user,
            memberships: new Map((memberships.data || []).map(row => [row.organization_id, row.role]))
        };
        next();
    } catch (error) {
        console.error('[API auth]', error.message || error);
        res.status(500).json({ error: 'Could not validate the session.' });
    }
}

function membership(req, organizationId, allowedRoles = null) {
    const role = req.apiAuth?.memberships?.get(organizationId);
    if (!role) return { ok: false, status: 403, error: 'Organization access denied.' };
    if (allowedRoles && !allowedRoles.includes(role)) return { ok: false, status: 403, error: 'Insufficient organization role.' };
    return { ok: true, role };
}

module.exports = { bearerToken, authenticate, membership };
