process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkup } = require('../src/lib/richText');

test('converts whitelisted tags in text nodes only', () => {
  const out = renderMarkup('<h1>Hello [b]bold[/b] [u]under[/u] [size=24]big[/size] [color=#c0392b]red[/color]</h1>');
  assert.equal(
    out,
    '<h1>Hello <strong>bold</strong> <u>under</u> <span style="font-size:24px;line-height:1.25">big</span> <span style="color:#c0392b">red</span></h1>'
  );
});

test('supports nesting and clamps size', () => {
  assert.match(renderMarkup('<p>[b][i]x[/i][/b]</p>'), /<strong><em>x<\/em><\/strong>/);
  assert.match(renderMarkup('<p>[size=999]a[/size]</p>'), /font-size:96px/);
  assert.match(renderMarkup('<p>[size=1]a[/size]</p>'), /font-size:10px/);
});

test('cannot inject markup or CSS: escaped input stays escaped, bad colours are not styled', () => {
  const escaped = renderMarkup('<p>[b]&lt;script&gt;alert(1)&lt;/script&gt;[/b]</p>');
  assert.ok(!escaped.includes('<script'));
  const css = renderMarkup('<p>[color=red;background:url(x)]a[/color]</p>');
  assert.ok(!css.includes('style='));
});

test('unbalanced tags are dropped; attributes, title, scripts and textareas are not turned into markup', () => {
  assert.equal(renderMarkup('<p>[b]open only</p>'), '<p>open only</p>');
  const html =
    '<title>[b]T[/b]</title><img alt="[b]pic[/b]"><script>var a="[b]x[/b]"</script><textarea>[b]raw[/b]</textarea><p>[b]ok[/b]</p>';
  const out = renderMarkup(html);
  assert.ok(out.includes('<title>T</title>'));
  assert.ok(out.includes('alt="pic"'));
  assert.ok(out.includes('var a="x"'));
  assert.ok(out.includes('<textarea>[b]raw[/b]</textarea>'));
  assert.ok(out.includes('<p><strong>ok</strong></p>'));
});

// ---- "text" placeholder bug: toolbar used to insert a literal word when nothing was selected ----
const { fixStoredPlaceholders } = require('../src/lib/richText');
const fs = require('node:fs');
const path = require('node:path');

test('render drops an empty "text" placeholder instead of showing the word', () => {
  const out = renderMarkup('<div class="section-tag">STAY UPDATED [color=#fafafa]text[/color]</div>');
  assert.equal(out, '<div class="section-tag">STAY UPDATED</div>');
  assert.equal(renderMarkup('<p>Hi [b]text[/b]</p>'), '<p>Hi</p>');
  assert.equal(renderMarkup('<p>[size=24]text[/size] Real</p>'), '<p> Real</p>');
  // genuine formatted text that merely contains the word is untouched
  assert.equal(renderMarkup('<p>[b]some text here[/b]</p>'), '<p><strong>some text here</strong></p>');
  assert.equal(renderMarkup('<p>[color=#fafafa]STAY UPDATED[/color]</p>'), '<p><span style="color:#fafafa">STAY UPDATED</span></p>');
});

test('stored values are repaired and keep the intended formatting', () => {
  assert.equal(fixStoredPlaceholders('STAY UPDATED [color=#fafafa]text[/color]'), '[color=#fafafa]STAY UPDATED[/color]');
  assert.equal(fixStoredPlaceholders('Hello [b]text[/b]'), '[b]Hello[/b]');
  assert.equal(fixStoredPlaceholders('[color=#fafafa]text[/color]'), '');
  assert.equal(fixStoredPlaceholders('[b]Keep[/b] this [i]text[/i]'), '[b]Keep[/b] this', 'already-formatted text only loses the placeholder');
  assert.equal(fixStoredPlaceholders('Plain value'), 'Plain value');
  assert.equal(fixStoredPlaceholders('[b]some text[/b]'), '[b]some text[/b]', 'real content untouched');
  const again = fixStoredPlaceholders(fixStoredPlaceholders('A [u]text[/u]'));
  assert.equal(again, '[u]A[/u]', 'idempotent');
});

test('admin format toolbar never inserts a placeholder word', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public/js/admin-format.js'), 'utf8');
  assert.doesNotMatch(js, /\|\|\s*'text'/);
  assert.match(js, /format the whole field/i);
});
