const test = require('node:test');
const assert = require('node:assert/strict');
const { safeRedirectPath } = require('../src/lib/safeRedirect');

test('allows a plain internal relative path', () => {
  assert.equal(safeRedirectPath('/student/dashboard'), '/student/dashboard');
});

test('allows an internal path with query string', () => {
  assert.equal(safeRedirectPath('/courses?page=2'), '/courses?page=2');
});

test('rejects absolute external URLs (https://evil.example)', () => {
  assert.equal(safeRedirectPath('https://evil.example', '/fallback'), '/fallback');
});

test('rejects protocol-relative external URLs (//evil.example)', () => {
  assert.equal(safeRedirectPath('//evil.example', '/fallback'), '/fallback');
});

test('rejects backslash variants some browsers normalize into a host change', () => {
  assert.equal(safeRedirectPath('/\\evil.example', '/fallback'), '/fallback');
  assert.equal(safeRedirectPath('\\\\evil.example', '/fallback'), '/fallback');
});

test('rejects a javascript: pseudo-scheme', () => {
  assert.equal(safeRedirectPath('javascript:alert(1)', '/fallback'), '/fallback');
});

test('rejects non-string / empty input, returning the fallback', () => {
  assert.equal(safeRedirectPath(undefined, '/fallback'), '/fallback');
  assert.equal(safeRedirectPath(null, '/fallback'), '/fallback');
  assert.equal(safeRedirectPath('', '/fallback'), '/fallback');
});

test('rejects a path not starting with "/"', () => {
  assert.equal(safeRedirectPath('evil.example', '/fallback'), '/fallback');
});

test('defaults fallback to "/" when not provided', () => {
  assert.equal(safeRedirectPath('https://evil.example'), '/');
});
