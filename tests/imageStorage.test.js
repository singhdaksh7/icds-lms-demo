const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  STORAGE_ROOT,
  isAllowedFile,
  buildFilename,
  publicUrlFor,
  resolveFilename,
  filenameFromPublicUrl,
} = require('../src/lib/imageStorage');

test('isAllowedFile accepts genuine jpg/png/webp with matching MIME', () => {
  assert.equal(isAllowedFile('photo.jpg', 'image/jpeg'), true);
  assert.equal(isAllowedFile('photo.png', 'image/png'), true);
  assert.equal(isAllowedFile('photo.webp', 'image/webp'), true);
});

test('isAllowedFile rejects an exe renamed to .jpg (MIME does not match)', () => {
  assert.equal(isAllowedFile('malware.jpg', 'application/x-msdownload'), false);
});

test('isAllowedFile rejects unsupported extensions (svg, html)', () => {
  assert.equal(isAllowedFile('image.svg', 'image/svg+xml'), false);
  assert.equal(isAllowedFile('page.html', 'text/html'), false);
});

test('isAllowedFile rejects a double-extension disguise (shell.php.jpg with a mismatched mime)', () => {
  assert.equal(isAllowedFile('shell.php.jpg', 'application/x-php'), false);
});

test('buildFilename rejects unsupported extensions and never echoes user input', () => {
  assert.throws(() => buildFilename('.exe'));
  const name = buildFilename('.png');
  assert.match(name, /^[0-9a-f-]{36}\.png$/);
});

test('publicUrlFor / filenameFromPublicUrl round-trip only our own generated URLs', () => {
  const filename = buildFilename('.webp');
  const url = publicUrlFor(filename);
  assert.equal(url, `/uploads/thumbnails/${filename}`);
  assert.equal(filenameFromPublicUrl(url), filename);
});

test('filenameFromPublicUrl returns null for an externally-supplied URL (never deletes files we did not create)', () => {
  assert.equal(filenameFromPublicUrl('https://cdn.example.com/photo.jpg'), null);
  assert.equal(filenameFromPublicUrl('/uploads/thumbnails/../../etc/passwd'), null);
});

test('resolveFilename confines resolution to STORAGE_ROOT (path traversal defense)', () => {
  assert.equal(resolveFilename('../../../etc/passwd'), null);
  assert.equal(resolveFilename('a/b.png'), null);
  assert.equal(resolveFilename('a\\b.png'), null);
  const resolved = resolveFilename('abc123.png');
  assert.ok(resolved.startsWith(STORAGE_ROOT + path.sep) || resolved === STORAGE_ROOT);
});
