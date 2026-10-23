const test = require('node:test');
const assert = require('node:assert/strict');
const { createToken, verifyToken, verifyRequest } = require('../auth');

test('createToken/verifyToken round-trips the payload', () => {
  const decoded = verifyToken(createToken('ana', ['p1'], true));
  assert.equal(decoded.username, 'ana');
  assert.deepEqual(decoded.projects, ['p1']);
  assert.equal(decoded.isAdmin, true);
});

test('createToken defaults to the default project and non-admin', () => {
  const decoded = verifyToken(createToken('ana'));
  assert.deepEqual(decoded.projects, ['project-ludum']);
  assert.equal(decoded.isAdmin, false);
});

test('verifyToken rejects empty and tampered tokens', () => {
  assert.equal(verifyToken(''), null);
  assert.equal(verifyToken('not.a.token'), null);
  assert.equal(verifyToken(createToken('ana') + 'x'), null);
});

test('verifyRequest lets public paths through without a token', () => {
  const req = { headers: {} };
  assert.equal(verifyRequest(req, {}, '/api/auth/login').valid, true);
  assert.equal(verifyRequest(req, {}, '/api/status').valid, true);
});

test('verifyRequest rejects missing or invalid Authorization', () => {
  assert.equal(verifyRequest({ headers: {} }, {}, '/api/tasks').error.status, 401);
  const bad = { headers: { authorization: 'Bearer nope' } };
  assert.equal(verifyRequest(bad, {}, '/api/tasks').error.status, 401);
});

test('verifyRequest attaches the user for a valid token', () => {
  const req = { headers: { authorization: `Bearer ${createToken('ana', ['p1'])}` } };
  const result = verifyRequest(req, {}, '/api/tasks');
  assert.equal(result.valid, true);
  assert.equal(req.user.username, 'ana');
  assert.deepEqual(req.user.projects, ['p1']);
});
