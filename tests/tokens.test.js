const test = require('node:test');
const assert = require('node:assert/strict');
const { generateRawToken, hashToken } = require('../src/lib/tokens');

test('generateRawToken produces a long, unpredictable, unique token each call', () => {
  const a = generateRawToken();
  const b = generateRawToken();
  assert.notEqual(a, b);
  assert.equal(a.length, 64); // 32 bytes hex-encoded
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('hashToken is deterministic for the same input', () => {
  const raw = generateRawToken();
  assert.equal(hashToken(raw), hashToken(raw));
});

test('hashToken output never equals the raw token (DB never stores the plaintext token)', () => {
  const raw = generateRawToken();
  assert.notEqual(hashToken(raw), raw);
  assert.match(hashToken(raw), /^[0-9a-f]{64}$/); // sha256 hex
});

test('hashToken produces different hashes for different tokens', () => {
  const a = generateRawToken();
  const b = generateRawToken();
  assert.notEqual(hashToken(a), hashToken(b));
});
