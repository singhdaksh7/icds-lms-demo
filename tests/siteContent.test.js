process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

// Must be set before imageStorage is first required (it reads the env at load).
const STORAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'icds-cms-'));
process.env.THUMBNAIL_STORAGE_ROOT = STORAGE;

// --- in-memory stand-in for Prisma (no database needed) ----------------------
const rows = new Map();
const stats = { findMany: 0 };
const reviews = new Map();
const fakePrisma = {
  siteSetting: {
    async findMany() {
      stats.findMany += 1;
      if (stats.fail) throw new Error('db down');
      return [...rows].map(([key, value]) => ({ key, value }));
    },
    async upsert({ where, update, create }) {
      rows.set(where.key, rows.has(where.key) ? update.value : create.value);
    },
    async deleteMany({ where }) {
      rows.delete(where.key);
    },
  },
  review: {
    async findMany() {
      return [...reviews.values()].map((r) => ({ ...r, user: { name: 'Stu', email: 's@x.test' }, course: { title: 'C1' } }));
    },
    async updateMany({ where, data }) {
      if (!reviews.has(where.id)) return { count: 0 };
      Object.assign(reviews.get(where.id), data);
      return { count: 1 };
    },
    async deleteMany({ where }) {
      return { count: reviews.delete(where.id) ? 1 : 0 };
    },
  },
  async $transaction(ops) {
    return Promise.all(ops);
  },
};
require.cache[require.resolve('../src/config/db')] = {
  id: require.resolve('../src/config/db'),
  filename: require.resolve('../src/config/db'),
  loaded: true,
  exports: { prisma: fakePrisma },
};

const express = require('express');
const cookieParser = require('cookie-parser');
const ejs = require('ejs');

const site = require('../src/config/site');
const settingsService = require('../src/services/settings.service');
const content = require('../src/config/siteContent');
const { validateForm, validateSettings } = require('../src/validators/settings.validator');
const { pageSeoText, buildSeo } = require('../src/lib/seo');
const { exposeCsrfToken } = require('../src/config/csrf');
const imageStorage = require('../src/lib/imageStorage');

const VIEWS = path.join(__dirname, '..', 'views');
const render = (view, data) => ejs.renderFile(path.join(VIEWS, view), data, { views: [VIEWS] });

// Tiny but genuine files for each allowed format.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

function reset() {
  rows.clear();
  reviews.clear();
  stats.findMany = 0;
  stats.fail = false;
  settingsService.invalidateCache();
}

async function cmsWith(overrides = {}) {
  reset();
  for (const [k, v] of Object.entries(overrides)) rows.set(k, v);
  const settings = await settingsService.getSettings();
  return settings.cms;
}

const baseView = (cms, extra = {}) => ({
  cms,
  site,
  fill: settingsService.fill,
  csrfToken: 'tok',
  flash: {},
  currentUser: undefined,
  footerCategories: [],
  pageTitle: 'T',
  metaDescription: 'D',
  seo: undefined,
  ...extra,
});

// =============================================================================
// Registry + defaults
// =============================================================================

test('every default value passes its own validation (a fresh install can always be re-saved)', () => {
  const body = {};
  for (const [key, field] of content.FIELD_BY_KEY) body[key] = field.def;
  const { errors } = validateSettings(body);
  assert.deepEqual(errors, []);
});

test('registry: every link-target default is an allowed target, every image key is registered once', () => {
  for (const field of content.FIELD_BY_KEY.values()) {
    if (field.type === 'target') assert.ok(content.SAFE_CTA_TARGETS.includes(field.def), field.key);
  }
  assert.equal(new Set(content.IMAGE_KEYS).size, content.IMAGE_KEYS.length);
  for (const expected of ['brand.logoPath', 'brand.faviconPath', 'hero.imagePath', 'why.imagePath', 'login.imagePath', 'signup.imagePath']) {
    assert.ok(content.IMAGE_KEYS.includes(expected), expected);
  }
});

test('registry: every tab that has forms defines unique form ids and no raw keys are used as labels', () => {
  for (const tab of content.TABS) {
    const ids = tab.forms.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate form id in ${tab.id}`);
    for (const form of tab.forms) {
      for (const field of form.fields) {
        if (field.heading) continue;
        assert.ok(field.label && field.label !== field.key, `${field.key} needs a human label`);
      }
    }
  }
});

test('existing production keys keep their names and defaults (no content change on migration)', () => {
  const d = content.DEFAULTS;
  assert.equal(d['why.heading'], 'Education that goes beyond watching videos.');
  assert.equal(d['process.step3Title'], 'Request Enrollment');
  assert.equal(d['brand.tagline'], 'Learn. Practice. Grow. Build Your Professional Future.');
  assert.equal(d['hero.heading'], 'Master the skills that');
  assert.equal(d['hero.highlight'], 'shape confidence.');
  assert.equal(d['login.submitLabel'], 'Login to Account');
  assert.match(d['legal.privacy.body'], /^## Overview/);
});

// =============================================================================
// Settings resolution
// =============================================================================

test('settings resolution: defaults when the table is empty, nested + typed', async () => {
  const cms = await cmsWith();
  assert.equal(cms.hero.heading, 'Master the skills that');
  assert.equal(cms.hero.enabled, true);
  assert.equal(cms.nav.showContact, false);
  assert.equal(cms.legal.privacy.heading, 'Privacy Policy');
  assert.equal(cms.why.imageUrl, null);
  assert.equal(cms.hero.primaryTarget, '#courses');
});

test('settings resolution: saved rows override defaults, blank rows and unknown keys do not', async () => {
  const cms = await cmsWith({ 'hero.heading': 'Custom heading', 'hero.eyebrow': '', 'not.a.real.key': 'x', 'hero.enabled': 'false' });
  assert.equal(cms.hero.heading, 'Custom heading');
  assert.equal(cms.hero.eyebrow, 'Professional Online Learning');
  assert.equal(cms.hero.enabled, false);
  assert.equal(cms.not, undefined);
});

test('settings resolution: ONE query serves many reads, and a save invalidates immediately', async () => {
  reset();
  await settingsService.getSettings();
  await settingsService.getSettings();
  await settingsService.getSettings();
  assert.equal(stats.findMany, 1);

  await settingsService.updateSettings({ 'hero.heading': 'Fresh' });
  const after = await settingsService.getSettings();
  assert.equal(after.cms.hero.heading, 'Fresh');
  assert.equal(stats.findMany, 2);
});

test('settings resolution: a database failure falls back to defaults instead of breaking pages', async () => {
  reset();
  stats.fail = true;
  const settings = await settingsService.getSettings();
  assert.equal(settings.cms.hero.heading, 'Master the skills that');
});

test('updateSettings: blank resets to the default, unknown keys are never stored', async () => {
  reset();
  await settingsService.updateSettings({ 'hero.heading': 'A', 'evil.key': 'x' });
  assert.equal(rows.get('hero.heading'), 'A');
  assert.ok(!rows.has('evil.key'));
  await settingsService.updateSettings({ 'hero.heading': '' });
  assert.ok(!rows.has('hero.heading'));
  assert.equal((await settingsService.getSettings()).cms.hero.heading, 'Master the skills that');
});

test('site contact details: admin values win over env, blank falls back to env', async () => {
  reset();
  rows.set('contact.email', 'cms@acme.test');
  rows.set('contact.supportEmail', 'help@acme.test');
  rows.set('site.name', 'Acme Academy');
  rows.set('brand.copyrightName', 'Acme Holdings');
  await settingsService.getSettings();
  assert.equal(site.contactEmail, 'cms@acme.test');
  assert.equal(site.supportEmail, 'help@acme.test');
  assert.equal(site.name, 'Acme Academy');
  assert.equal(site.copyrightName, 'Acme Holdings');

  reset();
  await settingsService.getSettings();
  assert.equal(site.name, site.envDefaults.name);
  assert.equal(site.contactEmail, site.envDefaults.contactEmail);
});

test('fill(): replaces known tokens, leaves unknown ones, never executes anything', () => {
  assert.equal(settingsService.fill('Back to {course}', { course: 'Hair' }), 'Back to Hair');
  assert.equal(settingsService.fill('Hi {who}', {}), 'Hi {who}');
  assert.equal(settingsService.fill(undefined), '');
});

// =============================================================================
// Validation
// =============================================================================

const heroForm = content.FORM_BY_PATH.get('home/hero').form;
const navForm = content.FORM_BY_PATH.get('header/navigation').form;

test('validation: plain text is accepted and trimmed, newlines collapse in single-line fields', () => {
  const { errors, values } = validateForm(heroForm, { 'hero.heading': '  New \n heading  ' });
  assert.deepEqual(errors, []);
  assert.equal(values['hero.heading'], 'New heading');
});

test('validation: HTML tags and script links are rejected in every text field', () => {
  for (const bad of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', 'javascript:alert(1)', 'JaVaScRiPt : void(0)', 'data:text/html;base64,AAA', '<!-- x -->']) {
    const { errors } = validateForm(heroForm, { 'hero.heading': bad });
    assert.ok(errors.some((e) => /plain text/i.test(e)), `should reject: ${bad}`);
  }
  const ok = validateForm(heroForm, { 'hero.description': 'Fees < 5000 & rising > 3% - fine' });
  assert.deepEqual(ok.errors, []);
});

test('validation: link targets only accept the predefined list', () => {
  for (const bad of ['javascript:alert(1)', 'https://evil.example', '//evil.example', '/admin', '#nope', 'data:text/html,x']) {
    const { errors, values } = validateForm(heroForm, { 'hero.primaryTarget': bad });
    assert.equal(errors.length, 1, bad);
    assert.equal(values['hero.primaryTarget'], '#courses');
  }
  for (const target of content.SAFE_CTA_TARGETS) {
    assert.deepEqual(validateForm(heroForm, { 'hero.primaryTarget': target }).errors, []);
  }
});

test('validation: lengths are capped, controls stripped, booleans coerced', () => {
  const { values } = validateForm(heroForm, { 'hero.heading': 'x'.repeat(500) + '\u0000', 'hero.enabled': 'on' });
  assert.equal(values['hero.heading'].length, 150);
  assert.equal(values['hero.enabled'], 'true');
  assert.equal(validateForm(heroForm, {}).values['hero.enabled'], 'false');
});

test('validation: email, phone, date and SEO length rules', () => {
  const contact = content.FORM_BY_PATH.get('brand/contact').form;
  assert.equal(validateForm(contact, { 'contact.email': 'nope' }).errors.length, 1);
  assert.equal(validateForm(contact, { 'contact.supportEmail': 'a@b' }).errors.length, 1);
  assert.equal(validateForm(contact, { 'contact.phone': 'call me' }).errors.length, 1);
  assert.deepEqual(validateForm(contact, { 'contact.email': 'a@b.co', 'contact.phone': '+91 98765-43210' }).errors, []);

  const legal = content.FORM_BY_PATH.get('privacy/page').form;
  assert.equal(validateForm(legal, { 'legal.privacy.updated': '2026-02-30' }).errors.length, 1);
  assert.deepEqual(validateForm(legal, { 'legal.privacy.updated': '2026-10-15' }).errors, []);
  const seoForm = content.FORM_BY_PATH.get('home/seo').form;
  assert.equal(validateForm(seoForm, { 'seo.home.title': 'T'.repeat(200) }).values['seo.home.title'].length, 70);
});

test('validation: a form only ever returns its own keys', () => {
  const { values } = validateForm(navForm, { 'hero.heading': 'sneaky', 'nav.homeLabel': 'Start' });
  assert.ok(!('hero.heading' in values));
  assert.equal(values['nav.homeLabel'], 'Start');
});

// =============================================================================
// Admin routes: auth, CSRF, saves, images
// =============================================================================

function adminApp(role = 'ADMIN') {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', VIEWS);
  app.locals.site = site;
  app.locals.cms = settingsService.defaultContent();
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: true }));
  app.use(exposeCsrfToken);
  const flashes = { success: [], error: [] };
  app.use((req, res, next) => {
    if (req.get('x-test-user') !== 'none') req.currentUser = { id: 1, name: 'Admin', role };
    res.locals.currentUser = req.currentUser || null;
    res.locals.flash = {};
    req.flashSuccess = (m) => flashes.success.push(m);
    req.flashError = (m) => flashes.error.push(m);
    next();
  });
  app.get('/token', (req, res) => res.json({ token: res.locals.csrfToken }));
  app.use('/admin', require('../src/routes/admin.routes'));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(err.code === 'EBADCSRFTOKEN' ? 403 : 500).send(`ERR:${err.code || err.message}`);
  });
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, flashes, base: `http://127.0.0.1:${server.address().port}` })));
}

async function session(base) {
  const res = await fetch(`${base}/token`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { token } = await res.json();
  return { cookie, token };
}

async function postForm(base, url, { cookie, token }, fields, { files = {}, multipart = false, noToken = false } = {}) {
  const headers = { cookie };
  if (multipart) {
    const form = new FormData();
    if (!noToken) form.append('_csrf', token);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    for (const [k, [buf, name, type]] of Object.entries(files)) form.append(k, new Blob([buf], { type }), name);
    return fetch(`${base}${url}`, { method: 'POST', headers, body: form, redirect: 'manual' });
  }
  const body = new URLSearchParams({ ...(noToken ? {} : { _csrf: token }), ...fields });
  return fetch(`${base}${url}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual' });
}

function siteFiles() {
  const dir = path.join(STORAGE, 'site');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

test('admin site content: anonymous users go to login, students get 403, admins get the page', async () => {
  reset();
  const anon = await adminApp();
  try {
    const res = await fetch(`${anon.base}/admin/site-content/home`, { headers: { 'x-test-user': 'none' }, redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /^\/login/);
  } finally {
    anon.server.close();
  }

  const student = await adminApp('STUDENT');
  try {
    // 403 page needs the public layout (cms/site come from app.locals)
    const res = await fetch(`${student.base}/admin/site-content/home`);
    assert.equal(res.status, 403);
    const post = await fetch(`${student.base}/admin/site-content/home/hero`, { method: 'POST' });
    assert.equal(post.status, 403);
  } finally {
    student.server.close();
  }

  const admin = await adminApp();
  try {
    const res = await fetch(`${admin.base}/admin/site-content/home`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Site Content/);
    assert.match(html, /Hero/);
    assert.match(html, /enctype="multipart\/form-data"/);
    // Raw setting keys are only ever form field names, never visible labels.
    assert.ok(!/>\s*hero\.heading\s*</.test(html));
  } finally {
    admin.server.close();
  }
});

test('admin site content: every tab renders and unknown tabs/forms are 404', async () => {
  reset();
  const { server, base } = await adminApp();
  try {
    for (const tab of content.TABS) {
      const res = await fetch(`${base}/admin/site-content/${tab.id}`);
      assert.equal(res.status, 200, tab.id);
    }
    assert.equal((await fetch(`${base}/admin/site-content/nope`)).status, 404);
    const s = await session(base);
    assert.equal((await postForm(base, '/admin/site-content/home/nope', s, {})).status, 404);
    assert.equal((await postForm(base, '/admin/site-content/nope/hero', s, {})).status, 404);
    assert.equal((await fetch(`${base}/admin/site-content`, { redirect: 'manual' })).status, 302);
    const legacy = await fetch(`${base}/admin/settings`, { redirect: 'manual' });
    assert.equal(legacy.status, 301);
    assert.equal(legacy.headers.get('location'), '/admin/site-content/home');
  } finally {
    server.close();
  }
});

test('admin site content: saving without a CSRF token is rejected and changes nothing', async () => {
  reset();
  const { server, base } = await adminApp();
  try {
    const s = await session(base);
    const res = await postForm(base, '/admin/site-content/home/hero', s, { 'hero.heading': 'Hacked' }, { noToken: true });
    assert.equal(res.status, 403);
    const multipart = await postForm(base, '/admin/site-content/home/hero', s, { 'hero.heading': 'Hacked' }, { noToken: true, multipart: true, files: { 'file__hero.imagePath': [PNG, 'a.png', 'image/png'] } });
    assert.equal(multipart.status, 403);
    assert.equal(rows.size, 0);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(siteFiles(), [], 'an upload sent with a bad token must not stay on disk');
  } finally {
    server.close();
  }
});

test('admin site content: each form saves independently and never touches other forms', async () => {
  reset();
  const { server, base, flashes } = await adminApp();
  try {
    const s = await session(base);
    let res = await postForm(base, '/admin/site-content/home/hero', s, { 'hero.heading': 'Hero A', 'hero.enabled': 'true', 'hero.showBadges': 'true', 'hero.showStats': 'true' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/admin/site-content/home#form-hero');
    assert.equal(rows.get('hero.heading'), 'Hero A');

    res = await postForm(base, '/admin/site-content/home/why', s, { 'why.heading': 'Why B', 'why.ctaTarget': '#faq', 'why.enabled': 'true' });
    assert.equal(res.status, 302);
    assert.equal(rows.get('why.heading'), 'Why B');
    assert.equal(rows.get('why.ctaTarget'), '#faq');
    assert.equal(rows.get('hero.heading'), 'Hero A', 'saving Why ICDS must not alter the hero');

    res = await postForm(base, '/admin/site-content/header/navigation', s, { 'nav.homeLabel': 'Start', 'nav.showAbout': 'true', 'nav.showContact': 'true' });
    assert.equal(res.status, 302);
    assert.equal(rows.get('nav.homeLabel'), 'Start');
    assert.equal(rows.get('nav.showAbout'), 'true');
    assert.equal(rows.get('nav.showFaq'), 'false', 'an unchecked toggle is saved as off');
    assert.equal(rows.get('hero.heading'), 'Hero A');
    assert.equal(flashes.success.length, 3);

    const settings = await settingsService.getSettings();
    assert.equal(settings.cms.hero.heading, 'Hero A');
    assert.equal(settings.cms.nav.showContact, true);
  } finally {
    server.close();
  }
});

test('admin site content: groups save - brand, auth pages, contact page, footer, legal, SEO, student copy', async () => {
  reset();
  const { server, base } = await adminApp();
  try {
    const s = await session(base);
    const cases = [
      ['brand/identity', { 'site.name': 'Acme Academy', 'brand.tagline': 'Hello' }, 'site.name', 'Acme Academy'],
      ['brand/contact', { 'contact.email': 'a@acme.test', 'contact.phone': '+91 11111 22222' }, 'contact.phone', '+91 11111 22222'],
      ['brand/seo', { 'seo.defaultTitle': 'Default T' }, 'seo.defaultTitle', 'Default T'],
      ['header/strip', { 'header.stripText': 'Admissions open' }, 'header.stripText', 'Admissions open'],
      ['auth/login', { 'login.heading': 'Welcome student' }, 'login.heading', 'Welcome student'],
      ['auth/signup', { 'signup.heading': 'Join now' }, 'signup.heading', 'Join now'],
      ['auth/forgot', { 'forgot.heading': 'Lost it?' }, 'forgot.heading', 'Lost it?'],
      ['auth/reset', { 'reset.heading': 'New one' }, 'reset.heading', 'New one'],
      ['contact/page', { 'contactPage.heading': 'Talk to us' }, 'contactPage.heading', 'Talk to us'],
      ['footer/main', { 'brand.footerDescription': 'Footer words' }, 'brand.footerDescription', 'Footer words'],
      ['privacy/page', { 'legal.privacy.heading': 'Privacy', 'legal.privacy.body': '## A\nBody', 'legal.privacy.updated': '2026-10-15' }, 'legal.privacy.updated', '2026-10-15'],
      ['terms/page', { 'legal.terms.heading': 'Terms', 'seo.terms.title': 'Terms SEO' }, 'seo.terms.title', 'Terms SEO'],
      ['courses/page', { 'courses.heading': 'Catalogue' }, 'courses.heading', 'Catalogue'],
      ['course-detail/labels', { 'course.requestCta': 'Ask to join' }, 'course.requestCta', 'Ask to join'],
      ['student/dashboard', { 'dash.subtitle': 'Keep going' }, 'dash.subtitle', 'Keep going'],
      ['student/lesson', { 'lesson.backLabel': 'Return to {course}' }, 'lesson.backLabel', 'Return to {course}'],
      ['student/certificates', { 'cert.heading': 'My Awards' }, 'cert.heading', 'My Awards'],
    ];
    for (const [pathPart, fields, key, expected] of cases) {
      const res = await postForm(base, `/admin/site-content/${pathPart}`, s, fields);
      assert.equal(res.status, 302, pathPart);
      assert.equal(rows.get(key), expected, pathPart);
    }
  } finally {
    server.close();
  }
});

test('admin site content: invalid input re-renders with errors (400) and saves nothing', async () => {
  reset();
  const { server, base } = await adminApp();
  try {
    const s = await session(base);
    const res = await postForm(base, '/admin/site-content/home/hero', s, { 'hero.heading': '<script>alert(1)</script>', 'hero.primaryTarget': 'javascript:alert(1)' });
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.match(html, /plain text only/i);
    assert.match(html, /predefined page links/i);
    // The rejected text is shown back inside the field, escaped.
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.equal(rows.size, 0);
  } finally {
    server.close();
  }
});

test('admin site content: image upload, replacement and removal (multipart + CSRF)', async () => {
  reset();
  const { server, base, flashes } = await adminApp();
  try {
    const s = await session(base);

    // upload
    let res = await postForm(base, '/admin/site-content/home/hero', s, { 'hero.heading': 'With image' }, { multipart: true, files: { 'file__hero.imagePath': [PNG, 'one.png', 'image/png'] } });
    assert.equal(res.status, 302);
    const first = rows.get('hero.imagePath');
    assert.match(first, /^site\/[0-9a-f-]{36}\.png$/);
    assert.equal(siteFiles().length, 1);
    assert.ok(fs.existsSync(imageStorage.resolveSiteImagePath(first)));
    let settings = await settingsService.getSettings();
    assert.equal(settings.cms.hero.imageUrl, `/uploads/thumbnails/${first}`);

    // replace: new file saved, old one deleted
    res = await postForm(base, '/admin/site-content/home/hero', s, {}, { multipart: true, files: { 'file__hero.imagePath': [JPEG, 'two.jpg', 'image/jpeg'] } });
    assert.equal(res.status, 302);
    const second = rows.get('hero.imagePath');
    assert.notEqual(second, first);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(fs.existsSync(path.join(STORAGE, first)), false, 'replaced image is removed from disk');
    assert.equal(siteFiles().length, 1);

    // saving other fields without a file keeps the image
    res = await postForm(base, '/admin/site-content/home/hero', s, { 'hero.heading': 'Still here' }, { multipart: true });
    assert.equal(rows.get('hero.imagePath'), second);

    // remove: row cleared, file deleted, default image back
    res = await postForm(base, '/admin/site-content/home/hero', s, { 'remove__hero.imagePath': '1' }, { multipart: true });
    assert.equal(res.status, 302);
    assert.ok(!rows.has('hero.imagePath'));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(siteFiles().length, 0);
    settings = await settingsService.getSettings();
    assert.equal(settings.cms.hero.imageUrl, null);
    assert.equal(flashes.error.length, 0);
  } finally {
    server.close();
  }
});

test('admin site content: spoofed, mistyped and oversized images are rejected; other fields are not saved', async () => {
  reset();
  const { server, base, flashes } = await adminApp();
  try {
    const s = await session(base);
    const fakeText = Buffer.from('this is plain text pretending to be an image');

    let res = await postForm(base, '/admin/site-content/home/hero', s, { 'hero.heading': 'Nope' }, { multipart: true, files: { 'file__hero.imagePath': [fakeText, 'evil.png', 'image/png'] } });
    assert.equal(res.status, 302);
    assert.match(flashes.error.at(-1), /not a valid JPG, PNG or WEBP/i);

    res = await postForm(base, '/admin/site-content/home/hero', s, { 'hero.heading': 'Nope' }, { multipart: true, files: { 'file__hero.imagePath': [PNG, 'x.svg', 'image/svg+xml'] } });
    assert.equal(res.status, 302);
    res = await postForm(base, '/admin/site-content/home/hero', s, { 'hero.heading': 'Nope' }, { multipart: true, files: { 'file__hero.imagePath': [PNG, 'x.png', 'text/html'] } });
    assert.equal(res.status, 302);
    res = await postForm(base, '/admin/site-content/home/hero', s, { 'hero.heading': 'Nope' }, { multipart: true, files: { 'file__hero.imagePath': [Buffer.alloc(5 * 1024 * 1024 + 10, 1), 'big.png', 'image/png'] } });
    assert.equal(res.status, 302);
    assert.match(flashes.error.at(-1), /too large/i);
    // A field name that is not a registered image setting is refused.
    res = await postForm(base, '/admin/site-content/home/hero', s, {}, { multipart: true, files: { 'file__site.name': [PNG, 'x.png', 'image/png'] } });
    assert.equal(res.status, 302);

    assert.equal(rows.size, 0);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(siteFiles(), []);
  } finally {
    server.close();
  }
});

test('admin site content: an upload for another form\'s image field is ignored and not kept', async () => {
  reset();
  const { server, base } = await adminApp();
  try {
    const s = await session(base);
    // The hero form must not be able to write the logo.
    const res = await postForm(base, '/admin/site-content/home/hero', s, { 'hero.heading': 'H' }, { multipart: true, files: { 'file__brand.logoPath': [PNG, 'l.png', 'image/png'] } });
    assert.equal(res.status, 302);
    assert.ok(!rows.has('brand.logoPath'));
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(siteFiles(), []);
  } finally {
    server.close();
  }
});

// =============================================================================
// Review moderation
// =============================================================================

test('admin reviews: hide, show and delete; invalid status rejected; CSRF + admin only', async () => {
  reset();
  reviews.set(5, { id: 5, rating: 5, comment: 'Great', status: 'APPROVED', createdAt: new Date() });
  const { server, base, flashes } = await adminApp();
  try {
    assert.equal((await fetch(`${base}/admin/reviews`)).status, 200);
    const s = await session(base);

    assert.equal((await postForm(base, '/admin/reviews/5/status', s, { status: 'REJECTED' }, { noToken: true })).status, 403);
    assert.equal(reviews.get(5).status, 'APPROVED');

    await postForm(base, '/admin/reviews/5/status', s, { status: 'REJECTED' });
    assert.equal(reviews.get(5).status, 'REJECTED');
    await postForm(base, '/admin/reviews/5/status', s, { status: 'APPROVED' });
    assert.equal(reviews.get(5).status, 'APPROVED');

    await postForm(base, '/admin/reviews/5/status', s, { status: 'DROP TABLE' });
    assert.equal(reviews.get(5).status, 'APPROVED');
    assert.match(flashes.error.at(-1), /Invalid review status/);

    await postForm(base, '/admin/reviews/5/delete', s, {});
    assert.equal(reviews.has(5), false);
    assert.equal((await postForm(base, '/admin/reviews/abc/delete', s, {})).status, 404);
  } finally {
    server.close();
  }
});

// =============================================================================
// SEO
// =============================================================================

test('SEO: page text beats defaults; homepage honours the global default; others use automatic text', () => {
  const fallback = { title: 'Auto', description: 'Auto desc' };
  assert.deepEqual(pageSeoText(null, 'home', fallback), fallback);
  const s = { 'seo.defaultTitle': 'Global', 'seo.defaultDescription': 'Global desc', 'seo.courses.title': 'Catalogue' };
  assert.equal(pageSeoText(s, 'home', fallback).title, 'Global');
  assert.equal(pageSeoText({ ...s, 'seo.home.title': 'Home own' }, 'home', fallback).title, 'Home own');
  assert.equal(pageSeoText(s, 'courses', fallback).title, 'Catalogue');
  assert.equal(pageSeoText(s, 'courses', fallback).description, 'Auto desc');
  assert.equal(pageSeoText(s, 'terms', fallback).title, 'Auto');
});

test('SEO: buildSeo keeps canonical/robots and uses the admin default description as the fallback', () => {
  const req = { originalUrl: '/x?y=1', protocol: 'https', get: () => 'example.test' };
  site.applyOverrides({ seoDescription: 'Admin default desc', seoTitle: 'Admin default title' });
  try {
    const indexable = buildSeo(req, { robots: 'index, follow' });
    assert.match(indexable.canonical, /\/x$/);
    assert.equal(indexable.robots, 'index, follow');
    assert.equal(indexable.description, 'Admin default desc');
    assert.equal(indexable.title, 'Admin default title');
    assert.equal(buildSeo(req, {}).canonical, null);
    assert.equal(buildSeo(req, { title: 'Own', description: 'Own d' }).title, 'Own');
  } finally {
    site.applyOverrides({});
  }
});

// =============================================================================
// Public rendering
// =============================================================================

test('homepage renders admin hero copy; text is escaped (XSS) and the hero can be switched off', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const cms = await cmsWith({ 'hero.heading': evil, 'hero.highlight': 'bold <b>x</b>', 'hero.primaryLabel': 'Go now', 'hero.primaryTarget': '/contact', 'hero.badge1Title': 'Badge One' });
  let html = await render('partials/hero.ejs', baseView(cms, { stats: { courseCount: 3, instructorCount: 0, studentCount: 0, averageRating: null, ratingCount: 0 } }));
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /bold &lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /href="\/contact" class="hero-primary-btn"[\s\S]*Go now/);
  assert.match(html, /Badge One/);
  assert.match(html, /3\+/);
  assert.match(html, /Professional Courses/);

  const off = await cmsWith({ 'hero.enabled': 'false', 'hero.showStats': 'false' });
  html = await render('partials/hero.ejs', baseView(off, { stats: { courseCount: 3, instructorCount: 1, studentCount: 1, averageRating: null, ratingCount: 0 } }));
  assert.ok(!html.includes('hero-section'));
  assert.ok(!html.includes('stats-strip'));
});

test('homepage hero uses the uploaded image when set and the bundled one otherwise', async () => {
  const uuid = '11111111-2222-3333-4444-555555555555';
  let html = await render('partials/hero.ejs', baseView(await cmsWith({ 'hero.imagePath': `site/${uuid}.webp` }), { stats: null }));
  assert.match(html, new RegExp(`src="/uploads/thumbnails/site/${uuid}\\.webp"`));
  html = await render('partials/hero.ejs', baseView(await cmsWith(), { stats: null }));
  assert.match(html, /src="\/images\/demo\/hero\.jpg"/);
  // A tampered/absolute path never becomes a URL.
  html = await render('partials/hero.ejs', baseView(await cmsWith({ 'hero.imagePath': '../../etc/passwd' }), { stats: null }));
  assert.ok(!html.includes('etc/passwd'));
});

test('homepage sections follow their enabled toggles and admin copy', async () => {
  const cms = await cmsWith({
    'categories.heading': 'Pick a field', 'featured.ctaLabel': 'See everything', 'why.eyebrow': 'About us',
    'process.step2Number': 'B', 'process.step2Title': 'Sign up', 'instructors.enabled': 'false',
    'newsletter.placeholder': 'Your email', 'newsletter.buttonLabel': 'Join', 'faq.heading': 'Questions', 'reviews.heading': 'Kind words',
  });
  const cats = [{ name: 'Hair & Beauty', slug: 'hair-beauty', _count: { courses: 2 } }];
  const view = baseView(cms, { categories: cats, featuredCourses: [], instructors: [], reviews: [{ comment: 'Loved it', user: { name: 'Asha' }, course: { title: 'C1' } }], faqs: [{ id: 1, question: 'Q one?', answer: 'A one' }] });
  const get = (p) => render(`partials/${p}.ejs`, view);

  const categories = await get('categories');
  assert.match(categories, /Pick a field/);
  assert.match(categories, /Hair &amp; Beauty/, 'category names come from the database');
  assert.match(categories, /2 Courses/);
  assert.match(await get('courses'), /See everything/);
  assert.match(await get('about'), />\s*About us\s*</);
  const process_ = await get('process');
  assert.match(process_, /process-number">\s*B\s*</);
  assert.match(process_, /Sign up/);
  assert.equal((await get('instructors')).trim(), '', 'a disabled section renders nothing');
  const newsletter = await get('newsletter');
  assert.match(newsletter, /placeholder="Your email"/);
  assert.match(newsletter, />\s*Join\s*</);
  assert.match(await get('faq'), /Questions/);
  assert.match(await get('testimonials'), /Kind words/);

  const hidden = await cmsWith({ 'reviews.enabled': 'false', 'faq.enabled': 'false', 'categories.enabled': 'false', 'featured.enabled': 'false', 'why.enabled': 'false', 'process.enabled': 'false', 'newsletter.enabled': 'false' });
  const hiddenView = { ...view, cms: hidden };
  for (const p of ['testimonials', 'faq', 'categories', 'courses', 'about', 'process', 'newsletter']) {
    assert.equal((await render(`partials/${p}.ejs`, hiddenView)).trim(), '', `${p} should be hidden`);
  }
});

test('categories section keeps real database data and shows the empty text when there are none', async () => {
  const cms = await cmsWith({ 'categories.emptyText': 'No categories yet!' });
  const html = await render('partials/categories.ejs', baseView(cms, { categories: [] }));
  assert.match(html, /No categories yet!/);
  assert.ok(!html.includes('category-card'));
});

test('header: renamed labels, hidden items, optional Contact link, strip off/on, fallback tagline', async () => {
  let cms = await cmsWith({ 'nav.homeLabel': 'Start', 'nav.showFaq': 'false', 'nav.showContact': 'true', 'nav.contactLabel': 'Reach us', 'nav.loginLabel': 'Sign in', 'nav.signupLabel': 'Join', 'header.stripText': 'Admissions open' });
  let html = await render('partials/header.ejs', baseView(cms));
  assert.match(html, /href="\/#home">\s*Start/);
  assert.ok(!html.includes('href="/#faq"'));
  assert.match(html, /href="\/contact">\s*Reach us/);
  assert.match(html, /Sign in/);
  assert.match(html, /Join/);
  assert.match(html, /Admissions open/);

  cms = await cmsWith({ 'header.stripEnabled': 'false' });
  html = await render('partials/header.ejs', baseView(cms));
  assert.ok(!html.includes('top-strip'));

  cms = await cmsWith({ 'header.stripShowEmail': 'false', 'header.stripShowPhone': 'false' });
  html = await render('partials/header.ejs', baseView(cms));
  assert.match(html, /top-strip/);
  assert.match(html, /Learn\. Practice\. Grow\./, 'falls back to the tagline');
  const strip = html.slice(html.indexOf('top-strip'), html.indexOf('main-navigation'));
  assert.ok(!strip.includes('mailto:'));

  cms = await cmsWith({ 'nav.showHome': 'false', 'nav.showCourses': 'false' });
  html = await render('partials/header.ejs', baseView(cms));
  assert.ok(!html.includes('href="/#home"'));
  assert.ok(!html.includes('navigation-link" href="/courses"'));
});

test('header: category dropdown is database-driven; logo image replaces the default mark', async () => {
  const uuid = '11111111-2222-3333-4444-555555555555';
  const cms = await cmsWith({ 'brand.logoPath': `site/${uuid}.png`, 'nav.allCoursesLabel': 'Everything' });
  const html = await render('partials/header.ejs', baseView(cms, { footerCategories: [{ name: 'Hair', slug: 'hair' }] }));
  assert.match(html, /brand-logo-image" src="\/uploads\/thumbnails\/site\//);
  assert.ok(!html.includes('bi-mortarboard-fill'));
  assert.match(html, /Everything/);
  assert.match(html, /category=hair/);
});

test('seo-head: uploaded favicon replaces the default icons', async () => {
  const uuid = '11111111-2222-3333-4444-555555555555';
  const cms = await cmsWith({ 'brand.faviconPath': `site/${uuid}.png` });
  const html = await render('partials/seo-head.ejs', baseView(cms, { seo: { title: 'T', description: 'D', robots: 'index, follow' } }));
  assert.match(html, new RegExp(`rel="icon" type="image/png" href="/uploads/thumbnails/site/${uuid}\\.png"`));
  const def = await render('partials/seo-head.ejs', baseView(await cmsWith(), { seo: { title: 'T', description: 'D', robots: 'index, follow' } }));
  assert.match(def, /assets\/icons\/favicon\.svg/);
});

test('footer: admin copy and labels, DB categories, no dead "#" links, no empty bullets', async () => {
  const cms = await cmsWith({ 'brand.footerDescription': 'Our footer story', 'footer.platformHeading': 'Explore', 'footer.copyrightNotice': 'All rights reserved by us.', 'footer.privacyLabel': 'Privacy' });
  const html = await render('partials/footer.ejs', baseView(cms, { footerCategories: [{ name: 'Hair', slug: 'hair' }, { name: 'Skin & Care', slug: 'skin' }] }));
  assert.match(html, /Our footer story/);
  assert.match(html, />\s*Explore\s*</);
  assert.match(html, /All rights reserved by us\./);
  assert.match(html, /Skin &amp; Care/);
  assert.ok(!/href="#"/.test(html), 'no dead # links');
  assert.ok(!/<li>\s*<\/li>/.test(html), 'no empty bullets');
  assert.ok(!html.includes('loginModal') && !html.includes('signupModal'));
});

test('footer: links to disabled sections are not shown; contact details come from site settings', async () => {
  const cms = await cmsWith({ 'faq.enabled': 'false', 'nav.showInstructors': 'false', 'categories.enabled': 'false' });
  const html = await render('partials/footer.ejs', baseView(cms, { site: { ...site, contactEmail: 'hello@acme.test', contactPhone: '', phoneHref: '', address: '' } }));
  assert.ok(!html.includes('href="/#faq"'));
  assert.ok(!html.includes('href="/#instructors"'));
  assert.ok(!html.includes('href="/#categories"'));
  assert.match(html, /mailto:hello@acme\.test/);
});

test('login / signup / forgot / reset pages render admin copy; security wording stays fixed', async () => {
  const cms = await cmsWith({
    'login.heading': 'Welcome student', 'login.submitLabel': 'Enter', 'login.sideFeature2': 'See progress', 'login.forgotLabel': 'Lost password?',
    'signup.heading': 'Join us', 'signup.passwordLabel': 'Pick a password', 'signup.submitLabel': 'Register',
    'forgot.heading': 'Lost it', 'forgot.submitLabel': 'Mail me', 'reset.heading': 'Fresh start', 'reset.confirmLabel': 'Again',
  });
  const data = baseView(cms, { errors: [], values: {}, returnTo: '', isValid: true, token: 'abc' });

  const login = await render('public/login-content.ejs', data);
  for (const t of ['Welcome student', 'Enter', 'See progress', 'Lost password?']) assert.match(login, new RegExp(t));
  assert.match(login, /action="\/auth\/login"/);

  const signup = await render('public/signup-content.ejs', data);
  for (const t of ['Join us', 'Pick a password', 'Register']) assert.match(signup, new RegExp(t));
  assert.match(signup, /min 8 characters/, 'the visible rule reflects the real validation');
  assert.match(signup, /minlength="8"/);

  const forgot = await render('public/forgot-password-content.ejs', data);
  assert.match(forgot, /Lost it/);
  assert.match(forgot, /Mail me/);

  const reset = await render('public/reset-password-content.ejs', data);
  assert.match(reset, /Fresh start/);
  assert.match(reset, /Again/);
  assert.match(reset, /min 12 characters/);
  assert.match(reset, /minlength="12"/);

  const invalid = await render('public/reset-password-content.ejs', { ...data, isValid: false });
  assert.match(invalid, /invalid or has expired/);
});

test('auth pages: side-panel image is applied only from a validated upload path', async () => {
  const uuid = '11111111-2222-3333-4444-555555555555';
  const withImg = await render('public/login-content.ejs', baseView(await cmsWith({ 'login.imagePath': `site/${uuid}.jpg` }), { errors: [], values: {}, returnTo: '' }));
  assert.match(withImg, new RegExp(`url\\((&#39;|')/uploads/thumbnails/site/${uuid}\\.jpg`));
  const none = await render('public/login-content.ejs', baseView(await cmsWith({ 'login.imagePath': 'javascript:alert(1)' }), { errors: [], values: {}, returnTo: '' }));
  assert.ok(!none.includes('javascript:'));
  assert.ok(!none.includes('uploads/thumbnails'));
});

test('contact page: admin copy, labels and the real contact details from global settings', async () => {
  const cms = await cmsWith({ 'contactPage.heading': 'Talk to us', 'contactPage.nameLabel': 'Your name', 'contactPage.submitLabel': 'Deliver', 'contactPage.infoHeading': 'Find us' });
  const acme = { ...site, contactEmail: 'hi@acme.test', contactPhone: '+91 1', phoneHref: 'tel:911', address: '1 Main St', whatsappNumber: '', businessHours: '', mapUrl: '' };
  // The controller builds the contact cards from the admin-managed site details (only values that exist).
  const data = baseView(cms, { errors: [], values: {}, site: acme, cards: require('../src/services/contactEnquiry.service').buildContactCards(cms, acme) });
  const html = await render('public/contact-content.ejs', data);
  for (const t of ['Talk to us', 'Your name', 'Deliver', 'Find us', 'hi@acme\\.test', '1 Main St', 'tel:911']) assert.match(html, new RegExp(t));
  assert.match(html, /action="\/contact"/);
  assert.match(html, /name="message"/);

  const bare = await render('public/contact-content.ejs', { ...data, cards: [], site: { ...site, contactEmail: '', contactPhone: '', phoneHref: '', address: '' } });
  assert.ok(!bare.includes('contact-info-card'), 'no empty contact-info block');
  assert.match(bare, /Talk to us/);
});

test('courses page: page copy is admin-managed while courses, categories and levels come from data', async () => {
  const cms = await cmsWith({ 'courses.heading': 'Catalogue', 'courses.allCategoriesLabel': 'Any field', 'courses.emptyHeading': 'Nothing found', 'courses.emptyCta': 'Reset' });
  const html = await render('public/courses-content.ejs', baseView(cms, {
    filters: { q: '', categorySlug: '', level: '' },
    categories: [{ name: 'Hair', slug: 'hair' }],
    levels: ['BEGINNER', 'ADVANCED'],
    courses: [],
    pagination: { total: 0, page: 1, totalPages: 1 },
    pageUrl: () => '/courses',
  }));
  assert.match(html, /Catalogue/);
  assert.match(html, /Any field/);
  assert.match(html, /Nothing found/);
  assert.match(html, />\s*Hair\s*</);
  assert.match(html, /Beginner/);
});

function courseView(cms, extra = {}) {
  const course = {
    id: 1, slug: 'c1', title: 'Real Course', shortDescription: 's', description: 'd', level: 'BEGINNER', duration: '2h', currency: 'INR', price: 1000, salePrice: null,
    thumbnailUrl: '', category: { name: 'Hair', slug: 'hair' }, instructor: { name: 'Dr X', title: 'Lead', photoUrl: '' }, lessons: [],
  };
  return baseView(cms, { course, lessonCount: 0, isEnrolled: false, hasPendingRequest: false, isFree: false, ...extra });
}

test('course detail: generic labels are admin-managed; course data stays from the course', async () => {
  const cms = await cmsWith({
    'course.backLabel': 'All courses', 'course.curriculumHeading': 'Lessons', 'course.emptyLessons': 'Nothing yet', 'course.benefit1': 'Lifetime access',
    'course.loginRequestCta': 'Sign in first', 'course.instructorHeading': 'Your teacher', 'course.requestCta': 'Ask to join', 'course.freeCta': 'Join free',
  });
  let html = await render('public/course-detail-content.ejs', courseView(cms));
  for (const t of ['All courses', 'Lessons', 'Nothing yet', 'Lifetime access', 'Sign in first', 'Your teacher', 'Real Course', 'Dr X']) assert.match(html, new RegExp(t));

  html = await render('public/course-detail-content.ejs', courseView(cms, { currentUser: { role: 'STUDENT' } }));
  assert.match(html, /Ask to join/);
  html = await render('public/course-detail-content.ejs', courseView(cms, { currentUser: { role: 'STUDENT' }, isFree: true }));
  assert.match(html, /Join free/);
  html = await render('public/course-detail-content.ejs', courseView(cms, { currentUser: { role: 'STUDENT' }, isEnrolled: true }));
  assert.match(html, /Continue Learning/);

  const plain = await render('public/course-detail-content.ejs', courseView(await cmsWith()));
  assert.ok(!plain.includes('Back to Courses'), 'back link stays hidden until configured');
});

test('legal pages: admin heading/body/date render escaped; blank date hidden', async () => {
  const { parseLegalText, formatLegalDate } = require('../src/lib/legalText');
  const cms = await cmsWith({ 'legal.terms.heading': 'Our Terms', 'legal.terms.updated': '2026-10-15', 'legal.terms.body': '## Rules\n<script>x</script>\n\n- one' });
  const flat = await settingsService.getSettings();
  const html = await render('public/legal-content.ejs', {
    heading: cms.legal.terms.heading,
    updatedLabel: formatLegalDate(flat['legal.terms.updated']),
    blocks: parseLegalText(flat['legal.terms.body']),
  });
  assert.match(html, /Our Terms/);
  assert.match(html, /Last updated: 15 October 2026/);
  assert.ok(!html.includes('<script>x</script>'));
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
});

test('student dashboard: labels are admin-managed, counts and progress stay real', async () => {
  const cms = await cmsWith({ 'dash.welcomePrefix': 'Hi there,', 'dash.subtitle': 'Keep going', 'dash.myCoursesHeading': 'Learning', 'dash.certificatesHeading': 'Awards', 'dash.quickLinksHeading': 'Shortcuts' });
  const enrollment = {
    stateLabel: 'In Progress', progressPercent: 40, lessonCount: 5, buttonLabel: 'Resume', certificateEligible: false, certificate: null,
    course: { id: 1, slug: 'c1', title: 'Real Course', thumbnailUrl: '', category: { name: 'Hair' }, instructor: null },
  };
  const html = await render('student/dashboard-content.ejs', baseView(cms, {
    currentUser: { name: 'Asha', role: 'STUDENT' },
    enrollments: [enrollment],
    dashboardCounts: { enrolledCourses: 7, inProgressCourses: 3, completedCourses: 2, certificates: 4 },
    continueLearning: { course: enrollment.course, progressPercent: 40, stateLabel: 'In Progress' },
    latestCertificate: null,
  }));
  for (const t of ['Hi there, Asha', 'Keep going', 'Learning', 'Awards', 'Shortcuts', 'Real Course']) assert.match(html, new RegExp(t));
  assert.match(html, /dashboard-summary-value">7</);
  assert.match(html, /40%/);

  const empty = await render('student/dashboard-content.ejs', baseView(await cmsWith({ 'dash.emptyBody': 'Nothing yet', 'dash.browseLabel': 'Find courses', 'dash.emptyHeading': 'Start here' }), {
    currentUser: { name: 'Asha', role: 'STUDENT' }, enrollments: [], dashboardCounts: {}, continueLearning: null, latestCertificate: null,
  }));
  assert.match(empty, /Nothing yet/);
  assert.match(empty, /Find courses/);
  assert.match(empty, /Start here/);
});

test('lesson page: labels with {course} token are admin-managed and escaped', async () => {
  const cms = await cmsWith({ 'lesson.backLabel': 'Return to {course}', 'lesson.nextLabel': 'Onward', 'lesson.previousLabel': 'Earlier', 'lesson.autoCompleteHelp': 'Auto-done when watched', 'lesson.progressLabel': 'Your progress' });
  const html = await render('student/lesson-content.ejs', baseView(cms, {
    course: { slug: 'c1', title: 'A <b>Course</b>' },
    lesson: { id: 3, slug: 'l1', title: 'Lesson 1', videoType: 'LOCAL', videoPath: 'x.mp4', description: '' },
    enrolled: true, isAdmin: false, videoEmbed: null,
    progressMap: {}, progress: { percent: 25 },
    previousLesson: { slug: 'l0' }, nextLesson: { slug: 'l2' },
    lessons: [{ id: 3, slug: 'l1', title: 'Lesson 1', preview: true }],
  }));
  assert.match(html, /Return to A &lt;b&gt;Course&lt;\/b&gt;/);
  assert.ok(!html.includes('A <b>Course</b>'));
  for (const t of ['Onward', 'Earlier', 'Auto-done when watched', 'Your progress']) assert.match(html, new RegExp(t));
  // The completion mechanics are untouched.
  assert.match(html, /data-progress-url="\/student\/lessons\/3\/progress"/);
});

test('certificates: page headings are admin-managed; certificate data is not', async () => {
  const cms = await cmsWith({ 'cert.heading': 'My Awards', 'cert.supportText': 'Well done', 'cert.verifyHeading': 'Check a certificate', 'cert.verifyHelper': 'Enter the number' });
  const list = await render('student/certificates-content.ejs', baseView(cms, {
    certificates: [{ id: 1, certificateNumber: 'CERT-123', issuedAt: new Date('2026-10-01'), course: { title: 'Real Course' } }],
  }));
  assert.match(list, /My Awards/);
  assert.match(list, /Well done/);
  assert.match(list, /CERT-123/);
  const verify = await render('public/certificate-verify-content.ejs', baseView(cms, {
    certificate: { certificateNumber: 'CERT-123', issuedAt: new Date('2026-10-01'), user: { name: 'Asha' }, course: { title: 'Real Course' } },
  }));
  assert.match(verify, /Check a certificate/);
  assert.match(verify, /Enter the number/);
  assert.match(verify, /Certificate valid/);
  assert.match(verify, /Asha/);
  const missing = await render('public/certificate-verify-content.ejs', baseView(cms, { certificate: null }));
  assert.match(missing, /Certificate not found\./);
});

test('every public view renders with ONLY default content (fresh install looks complete)', async () => {
  const cms = await cmsWith();
  const base = baseView(cms, { errors: [], values: {}, returnTo: '', isValid: true, token: 't', stats: null, categories: [], featuredCourses: [], instructors: [], reviews: [], faqs: [] });
  for (const view of ['partials/hero', 'partials/categories', 'partials/courses', 'partials/about', 'partials/process', 'partials/instructors', 'partials/newsletter', 'partials/footer', 'partials/header']) {
    const html = await render(`${view}.ejs`, base);
    assert.ok(!/undefined|\[object Object\]/.test(html), `${view} leaked an undefined value`);
  }
});

test.after(() => {
  fs.rmSync(STORAGE, { recursive: true, force: true });
});
