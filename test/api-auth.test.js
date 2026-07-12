'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { bearerToken, userForToken, membership } = require('../src/api/auth');

test('extracts bearer tokens strictly', () => {
    assert.equal(bearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
    assert.equal(bearerToken('bearer token'), 'token');
    assert.equal(bearerToken('Basic abc'), null);
    assert.equal(bearerToken(''), null);
});

test('checks organization membership and write roles', () => {
    const req = { apiAuth: { memberships: new Map([['org-1', 'operator'], ['org-2', 'viewer']]) } };
    assert.deepEqual(membership(req, 'org-1'), { ok: true, role: 'operator' });
    assert.deepEqual(membership(req, 'org-1', ['owner', 'admin', 'operator']), { ok: true, role: 'operator' });
    assert.equal(membership(req, 'org-2', ['owner', 'admin', 'operator']).ok, false);
    assert.equal(membership(req, 'org-3').status, 403);
});

test('validates bearer sessions without mutating the shared database client', async () => {
    const previousUrl = process.env.SUPABASE_URL;
    const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-only-test-key';
    let request;
    const user = await userForToken('jwt-value', async (url, init) => {
        request = { url, init };
        return { ok: true, json: async () => ({ id: 'user-1', email: 'team@example.test' }) };
    });
    assert.equal(user.id, 'user-1');
    assert.equal(request.url, 'https://project.supabase.co/auth/v1/user');
    assert.equal(request.init.headers.Authorization, 'Bearer jwt-value');
    if (previousUrl) process.env.SUPABASE_URL = previousUrl; else delete process.env.SUPABASE_URL;
    if (previousKey) process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey; else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});
