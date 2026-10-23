const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer, hashPassword, verifyPassword } = require('../server');

test('hashPassword salts and verifyPassword accepts the right password only', () => {
  const a = hashPassword('secret');
  assert.notEqual(a, hashPassword('secret'));
  assert.equal(verifyPassword('secret', a), true);
  assert.equal(verifyPassword('wrong', a), false);
});

test('verifyPassword rejects malformed stored values', () => {
  assert.equal(verifyPassword('x', undefined), false);
  assert.equal(verifyPassword('x', 'nocolon'), false);
});

test('API rejects unauthenticated requests with 401', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/tasks`);
    assert.equal(res.status, 401);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('API rejects non-loopback origins with 403', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
      headers: { Origin: 'https://evil.example.com' }
    });
    assert.equal(res.status, 403);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
