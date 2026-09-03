const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  STORAGE_ROOT,
  buildVideoPath,
  resolveVideoPath,
  mimeTypeFor,
  findExistingFile,
} = require('../src/lib/videoStorage');

test('buildVideoPath rejects an invalid course slug', () => {
  assert.throws(() => buildVideoPath('../../etc', '.mp4'));
  assert.throws(() => buildVideoPath('Not A Slug!', '.mp4'));
});

test('buildVideoPath rejects an unsupported extension', () => {
  assert.throws(() => buildVideoPath('valid-slug', '.exe'));
  assert.throws(() => buildVideoPath('valid-slug', '.php'));
});

test('buildVideoPath generates a random-filename path under the given slug for allowed extensions', () => {
  const p1 = buildVideoPath('intro-to-js', '.mp4');
  const p2 = buildVideoPath('intro-to-js', '.mp4');
  assert.ok(p1.startsWith('intro-to-js/'));
  assert.notEqual(p1, p2, 'filenames must be random, never derived from user input');
});

test('resolveVideoPath confines resolution to STORAGE_ROOT (path traversal defense)', () => {
  assert.equal(resolveVideoPath('../../../etc/passwd'), null);
  assert.equal(resolveVideoPath('..\\..\\windows\\system32\\config\\sam'), null);
  assert.equal(resolveVideoPath('valid-slug/../../../secrets.txt'), null);
});

test('resolveVideoPath accepts a well-formed relative path and stays inside STORAGE_ROOT', () => {
  const resolved = resolveVideoPath('intro-to-js/abc123.mp4');
  assert.ok(resolved.startsWith(STORAGE_ROOT + path.sep) || resolved === STORAGE_ROOT);
});

test('resolveVideoPath rejects empty/non-string input', () => {
  assert.equal(resolveVideoPath(''), null);
  assert.equal(resolveVideoPath(null), null);
  assert.equal(resolveVideoPath(undefined), null);
});

test('mimeTypeFor only recognizes the whitelisted video extensions', () => {
  assert.equal(mimeTypeFor('.mp4'), 'video/mp4');
  assert.equal(mimeTypeFor('.webm'), 'video/webm');
  assert.equal(mimeTypeFor('.exe'), null);
  assert.equal(mimeTypeFor('.html'), null);
});

test('findExistingFile rejects traversal/absolute attempts in the filename', () => {
  assert.equal(findExistingFile('intro-to-js', '../../../etc/passwd'), null);
  assert.equal(findExistingFile('intro-to-js', 'video/../../secret.mp4'), null);
  assert.equal(findExistingFile('intro-to-js', 'C:\\Windows\\System32\\evil.mp4'), null);
});

test('findExistingFile rejects a disallowed extension even with a valid-looking filename', () => {
  assert.equal(findExistingFile('intro-to-js', 'shell.php'), null);
});

test('findExistingFile rejects an invalid course slug', () => {
  assert.equal(findExistingFile('../etc', 'video.mp4'), null);
});
