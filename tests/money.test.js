const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAmount, toPaise, MAX_AMOUNT } = require('../src/lib/money');
const { isSafeMediaUrl } = require('../src/lib/url');

test('parseAmount accepts a valid decimal amount', () => {
  assert.equal(parseAmount('2499.00'), '2499.00');
  assert.equal(parseAmount('0'), '0');
});

test('parseAmount rejects negative amounts', () => {
  assert.equal(parseAmount('-5'), null);
});

test('parseAmount rejects amounts above the sane ceiling', () => {
  assert.equal(parseAmount(String(MAX_AMOUNT + 1)), null);
});

test('parseAmount rejects non-numeric / malformed input', () => {
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('1.234'), null); // more than 2 decimal places
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount(null), null);
});

test('toPaise avoids floating-point rounding errors on values that are not exactly representable in binary', () => {
  // 0.1 + 0.2 style trap: this must be exact via string math, not float math.
  assert.equal(toPaise('19.99'), 1999);
  assert.equal(toPaise('100'), 10000);
  assert.equal(toPaise('0.05'), 5);
});

test('isSafeMediaUrl allows http/https and treats empty as optional', () => {
  assert.equal(isSafeMediaUrl(''), true);
  assert.equal(isSafeMediaUrl(undefined), true);
  assert.equal(isSafeMediaUrl('https://example.com/image.jpg'), true);
  assert.equal(isSafeMediaUrl('http://example.com/image.jpg'), true);
});

test('isSafeMediaUrl rejects dangerous schemes (stored XSS prevention)', () => {
  assert.equal(isSafeMediaUrl('javascript:alert(1)'), false);
  assert.equal(isSafeMediaUrl('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isSafeMediaUrl('file:///etc/passwd'), false);
});

test('isSafeMediaUrl rejects an oversized URL', () => {
  assert.equal(isSafeMediaUrl('https://example.com/' + 'a'.repeat(500)), false);
});
