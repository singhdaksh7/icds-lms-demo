process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const ejs = require('ejs');
const express = require('express');

const site = require('../src/config/site');
const settingsService = require('../src/services/settings.service');
const { defaultContent } = require('../src/services/settings.service');
const { validateSettings } = require('../src/validators/settings.validator');
const { parseLegalText, formatLegalDate } = require('../src/lib/legalText');

const VIEWS = path.join(__dirname, '..', 'views');
const render = (view, data) => ejs.renderFile(path.join(VIEWS, view), data, { views: [VIEWS] });

// --- invalid admin IDs -------------------------------------------------------

function adminApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.currentUser = { id: 1, role: 'ADMIN' };
    // Record which view would render instead of needing the full layout stack.
    res.render = (view) => res.type('json').send({ view });
    next();
  });
  app.use('/admin', require('../src/routes/admin.routes'));
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

test('malformed or out-of-range admin ids return 404, never a 500', async () => {
  const { server, port } = await adminApp();
  try {
    const ids = ['abc', '0', '-1', '1e3', '1.5', '99999999999999', '2147483648', '%20', 'null'];
    const getPaths = (id) => [
      `/admin/courses/${id}/edit`,
      `/admin/lessons/${id}/edit`,
      `/admin/courses/${id}/lessons`,
      `/admin/courses/${id}/lessons/new`,
      `/admin/instructors/${id}/edit`,
      `/admin/students/${id}`,
      `/admin/orders/${id}`,
      `/admin/messages/${id}`,
    ];
    for (const id of ids) {
      for (const p of getPaths(id)) {
        const res = await fetch(`http://127.0.0.1:${port}${p}`);
        assert.equal(res.status, 404, `GET ${p} -> ${res.status}`);
      }
      for (const p of [`/admin/courses/${id}`, `/admin/faqs/${id}/delete`, `/admin/categories/${id}`, `/admin/enrollment-requests/${id}/approve`]) {
        const res = await fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST' });
        assert.equal(res.status, 404, `POST ${p} -> ${res.status}`);
      }
    }
  } finally {
    server.close();
  }
});

// --- dynamic header categories ----------------------------------------------

const baseHeaderData = {
  pageTitle: 'T', metaDescription: 'D', site, seo: undefined, flash: {}, csrfToken: 'x', currentUser: undefined,
  cms: defaultContent(),
};

test('header lists only the active categories from the database', async () => {
  const html = await render('partials/header.ejs', { ...baseHeaderData, footerCategories: [{ name: 'Cosmetology', slug: 'cosmetology' }] });
  assert.match(html, /href="\/courses\?category=cosmetology"/);
  assert.match(html, />\s*Cosmetology\s*</);
  for (const gone of ['Aesthetics', 'Dental Sciences</a>', 'Skin &amp; Hair', 'category=aesthetics', 'category=dental-sciences', 'category=skin-hair']) {
    assert.ok(!html.includes(gone), `hard-coded "${gone}" must be gone`);
  }
});

test('header escapes category names and encodes slugs', async () => {
  const html = await render('partials/header.ejs', { ...baseHeaderData, footerCategories: [{ name: 'A <b>&</b> B', slug: 'a b&c' }] });
  assert.ok(!html.includes('<b>&</b>'));
  assert.match(html, /A &lt;b&gt;&amp;&lt;\/b&gt; B/);
  assert.match(html, /category=a%20b%26c/);
});

test('with zero categories the header shows a plain Courses link and no category submenu', async () => {
  const html = await render('partials/header.ejs', { ...baseHeaderData, footerCategories: [] });
  assert.ok(!html.includes('?category='));
  assert.ok(!html.includes('dropdown-menu'));
  assert.match(html, /href="\/courses"/);
});

test('header brand follows the configured institute name', async () => {
  const html = await render('partials/header.ejs', { ...baseHeaderData, footerCategories: [], site: { ...site, name: 'Acme Academy' } });
  assert.match(html, /Acme Academy/);
});

// --- legal pages ------------------------------------------------------------

test('default Privacy/Terms copy has no "placeholder / not legally reviewed" warning and makes no legal-review claim', () => {
  for (const key of ['legal.privacy.body', 'legal.terms.body']) {
    const body = settingsService.DEFAULTS[key];
    assert.ok(body.length > 200);
    assert.doesNotMatch(body, /placeholder|not been legally reviewed|legally reviewed|lorem/i);
  }
});

test('legal page renders configured content, heading and last-updated date', async () => {
  const html = await render('public/legal-content.ejs', {
    heading: 'Our Privacy Policy',
    updatedLabel: formatLegalDate('2026-10-15'),
    blocks: parseLegalText('## Data\nWe keep your name.\n\n- one\n- two'),
  });
  assert.match(html, /<h1[^>]*>Our Privacy Policy<\/h1>/);
  assert.match(html, /Last updated: 15 October 2026/);
  assert.match(html, /<h2[^>]*>Data<\/h2>/);
  assert.match(html, /<li>one<\/li><li>two<\/li>/);
  assert.doesNotMatch(html, /placeholder|legally reviewed/i);
});

test('legal page hides the date when none is set', async () => {
  const html = await render('public/legal-content.ejs', { heading: 'T', updatedLabel: '', blocks: parseLegalText('Hello') });
  assert.ok(!html.includes('Last updated'));
});

test('unsafe legal content is escaped, never rendered as HTML', async () => {
  const evil = '## <img src=x onerror=alert(1)>\n\n<script>alert(1)</script> & "quotes"\n\n- <b>bold</b>';
  const html = await render('public/legal-content.ejs', { heading: '<script>x</script>', updatedLabel: '', blocks: parseLegalText(evil) });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<b>bold</b>'));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('settings validator accepts valid legal/contact fields and rejects bad ones', () => {
  const ok = validateSettings({
    'why.heading': 'a', 'process.heading': 'b',
    'site.name': 'Acme', 'contact.email': 'hello@acme.test', 'contact.phone': '+91 98765-43210', 'contact.address': '1 Main St',
    'legal.privacy.body': 'Line1\r\n\r\n## H', 'legal.privacy.updated': '2026-10-15',
  });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.values['legal.privacy.body'], 'Line1\n\n## H');

  const bad = validateSettings({
    'why.heading': 'a', 'process.heading': 'b',
    'contact.email': 'nope', 'contact.phone': 'call me', 'legal.terms.updated': '2026-02-30',
  });
  assert.equal(bad.errors.length, 3);
});

test('legal body is length-capped and control characters are stripped', () => {
  const { values } = validateSettings({ 'why.heading': 'a', 'process.heading': 'b', 'legal.terms.body': 'a\u0000b' + 'x'.repeat(30000) });
  assert.ok(values['legal.terms.body'].length <= 20000);
  assert.ok(!values['legal.terms.body'].includes('\u0000'));
});

// --- admin contact settings --------------------------------------------------

test('site.applyOverrides prefers admin settings and falls back to env defaults when blank', () => {
  const original = { ...site.envDefaults };
  try {
    site.applyOverrides({ name: 'Acme Academy', email: 'hi@acme.test', phone: '+1 555 0100', address: '9 Road' });
    assert.equal(site.name, 'Acme Academy');
    assert.equal(site.contactEmail, 'hi@acme.test');
    assert.equal(site.supportEmail, 'hi@acme.test');
    assert.equal(site.contactPhone, '+1 555 0100');
    assert.equal(site.phoneHref, 'tel:15550100');
    assert.equal(site.address, '9 Road');

    site.applyOverrides({ name: '', email: '', phone: '', address: '' });
    assert.equal(site.name, original.name);
    assert.equal(site.contactEmail, original.contactEmail);
    assert.equal(site.contactPhone, original.contactPhone);
    assert.equal(site.address, original.address);
  } finally {
    site.applyOverrides({});
  }
});

test('footer and header render the DB-managed contact details', async () => {
  try {
    site.applyOverrides({ name: 'Acme Academy', email: 'hi@acme.test', phone: '+1 555 0100', address: '9 Road' });
    const html = await render('partials/header.ejs', { ...baseHeaderData, footerCategories: [] });
    assert.match(html, /mailto:hi@acme\.test/);
    assert.match(html, /tel:15550100/);
  } finally {
    site.applyOverrides({});
  }
});

// --- Why ICDS image removal / CSP wiring (structural) ------------------------

test('site content routes are admin-only, CSRF-protected and run multipart parsing before CSRF', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src/routes/admin.routes.js'), 'utf8');
  assert.match(routes, /router\.use\(requireRole\('ADMIN'\)\)/);
  assert.match(
    routes,
    /'\/site-content\/:tab\/:form',\s*uploadSiteImages\([\s\S]*?\),\s*doubleCsrfProtection,\s*siteContentController\.saveForm/
  );
  assert.ok(routes.indexOf("router.use(requireRole('ADMIN'))") < routes.indexOf("'/site-content/:tab/:form'"));
});

test('no inline event-handler attributes remain in views (required by the CSP)', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ejs') && /\son[a-z]+\s*=\s*["']/i.test(fs.readFileSync(full, 'utf8'))) offenders.push(full);
    }
  };
  walk(VIEWS);
  assert.deepEqual(offenders, []);
});

test('CSP forbids inline script attributes and unsafe-inline scripts, and uses a per-request nonce', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /'script-src-attr': \["'none'"\]/);
  assert.match(server, /nonce-\$\{res\.locals\.cspNonce\}/);
  const scriptSrc = server.slice(server.indexOf("'script-src': ["), server.indexOf("'script-src-attr'"));
  assert.ok(!scriptSrc.includes('unsafe-inline'));
  assert.ok(!scriptSrc.includes('unsafe-eval'));
});
