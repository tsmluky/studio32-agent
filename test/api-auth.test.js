'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { bearerToken, membership } = require('../src/api/auth');

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
