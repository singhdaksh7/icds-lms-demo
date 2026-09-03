const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../src/lib/password');

test('hashPassword never returns the plaintext password', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.notEqual(hash, 'correct horse battery staple');
  assert.ok(hash.startsWith('$2'), 'expected a bcrypt hash');
});

test('hashPassword is salted (same input, different hashes)', async () => {
  const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
  assert.notEqual(a, b);
});

test('verifyPassword succeeds for the correct password', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
});

test('verifyPassword fails for the wrong password', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('wrong password', hash), false);
});

test('verifyPassword fails safely (no throw) against a malformed hash', async () => {
  await assert.doesNotReject(() => verifyPassword('anything', 'not-a-real-bcrypt-hash'));
  assert.equal(await verifyPassword('anything', 'not-a-real-bcrypt-hash'), false);
});
