const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVideoEmbed } = require('../src/lib/video');

test('parses a standard YouTube watch URL', () => {
  const result = parseVideoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(result.provider, 'youtube');
  assert.equal(result.embedUrl, 'https://www.youtube.com/embed/dQw4w9WgXcQ');
});

test('parses a youtu.be short link', () => {
  const result = parseVideoEmbed('https://youtu.be/dQw4w9WgXcQ');
  assert.equal(result.embedUrl, 'https://www.youtube.com/embed/dQw4w9WgXcQ');
});

test('parses a Vimeo URL', () => {
  const result = parseVideoEmbed('https://vimeo.com/76979871');
  assert.equal(result.provider, 'vimeo');
  assert.equal(result.embedUrl, 'https://player.vimeo.com/video/76979871');
});

test('rejects an unrecognized provider (never passes through raw untrusted URLs)', () => {
  assert.equal(parseVideoEmbed('https://evil.example/video.mp4'), null);
});

test('rejects a javascript: URL (XSS via iframe src)', () => {
  assert.equal(parseVideoEmbed('javascript:alert(1)'), null);
});

test('rejects a malformed URL without throwing', () => {
  assert.doesNotThrow(() => parseVideoEmbed('not a url'));
  assert.equal(parseVideoEmbed('not a url'), null);
});

test('rejects null/undefined/non-string input', () => {
  assert.equal(parseVideoEmbed(null), null);
  assert.equal(parseVideoEmbed(undefined), null);
  assert.equal(parseVideoEmbed(12345), null);
});

test('rejects a YouTube URL with an injected/oversized video id', () => {
  assert.equal(parseVideoEmbed('https://www.youtube.com/watch?v=<script>alert(1)</script>'), null);
});
