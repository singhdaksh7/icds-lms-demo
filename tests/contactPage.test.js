process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

// Premium, fully CMS-driven /contact page: hero + contact cards + form + FAQ preview +
// closing CTA, enquiry storage, admin management and the source-of-truth chain
// (public output -> view var -> service -> DB/setting -> Admin input).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const { prisma } = require('../src/config/db');
const site = require('../src/config/site');
const publicController = require('../src/controllers/public.controller');
const engagement = require('../src/controllers/admin/engagement.controller');
const enquiries = require('../src/services/contactEnquiry.service');
const emailService = require('../src/services/email.service');
const templates = require('../src/lib/emailTemplates');
const settingsService = require('../src/services/settings.service');
const { validateForm } = require('../src/validators/settings.validator');
const { FORM_BY_PATH, FIELD_BY_KEY } = require('../src/config/siteContent');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').split('\r\n').join('\n');
const contentView = read('views/public/contact-content.ejs');

const swaps = [];
function swap(obj, key, impl) {
  const orig = obj[key];
  obj[key] = impl;
  swaps.push(() => { obj[key] = orig; });
}
function restoreAll() { while (swaps.length) swaps.pop()(); }

const COURSES = [
  { id: 6, title: 'Advanced FMR Master Class', slug: 'advanced-fmr-master-class', status: 'PUBLISHED' },
  { id: 7, title: 'Hidden Draft Course', slug: 'hidden-draft-course', status: 'DRAFT' },
];
const FAQS = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, question: `FAQ question ${i + 1}?`, answer: `FAQ answer ${i + 1}`, sortOrder: i, isActive: true }));

function setSite(overrides = {}) {
  const prev = { ...site };
  Object.assign(site, { contactEmail: '', contactPhone: '', phoneHref: '', whatsappNumber: '', whatsappHref: '', whatsappDisplay: '', address: '', businessHours: '', mapUrl: '' }, overrides);
  swaps.push(() => Object.assign(site, prev));
}

function stubDb({ page = null, created = [], messages = [] } = {}) {
  swap(prisma.sitePage, 'findUnique', async () => page);
  swap(prisma.course, 'findMany', async ({ where }) => {
    assert.equal(where.status, 'PUBLISHED', 'only PUBLISHED courses may ever be offered');
    return COURSES.filter((c) => c.status === 'PUBLISHED').map(({ id, title, slug }) => ({ id, title, slug }));
  });
  swap(prisma.faq, 'findMany', async () => FAQS);
  swap(prisma.contactMessage, 'create', async ({ data }) => { const row = { id: created.length + 1, createdAt: new Date(), updatedAt: new Date(), ...data }; created.push(row); return row; });
  swap(prisma.contactMessage, 'findMany', async ({ where }) => messages.filter((m) => !where || !where.status || m.status === where.status));
  swap(prisma.contactMessage, 'groupBy', async () => {
    const by = {};
    messages.forEach((m) => { by[m.status] = (by[m.status] || 0) + 1; });
    return Object.entries(by).map(([status, n]) => ({ status, _count: { _all: n } }));
  });
  swap(prisma.contactMessage, 'findUnique', async ({ where }) => messages.find((m) => m.id === where.id) || null);
  swap(prisma.contactMessage, 'update', async ({ where, data }) => { const m = messages.find((x) => x.id === where.id); Object.assign(m, data); return m; });
  swap(prisma.contactMessage, 'delete', async ({ where }) => { messages.splice(messages.findIndex((m) => m.id === where.id), 1); });
  return { created, messages };
}

function mkRes(cmsOverride) {
  const cms = cmsOverride || settingsService.defaultContent();
  const out = { status: 200, rendered: null, redirected: null, locals: { cms, settings: null, flash: { success: null, error: null } } };
  const res = {
    locals: out.locals,
    status(s) { out.status = s; return res; },
    render(view, data) { out.rendered = { view, data }; return res; },
    redirect(u) { out.redirected = u; return res; },
  };
  return { res, out };
}
const mkReq = (extra = {}) => ({ query: {}, body: {}, originalUrl: '/contact', protocol: 'http', get: () => 'localhost', flashSuccess(m) { this.ok = m; }, flashError(m) { this.err = m; }, ...extra });

const GOOD = { name: 'Asha Rao', email: 'asha@example.com', phone: '+91 98765 43210', reason: 'Course Enquiry', courseId: '6', message: 'I would like to know more about the course schedule.' };

// Renders the real view with the controller's locals (what a visitor receives).
async function renderPage(out) {
  const d = out.rendered.data;
  return ejs.renderFile(path.join(root, 'views/public/contact-content.ejs'), {
    cms: out.locals.cms, site, csrfToken: 'tok', errors: [], values: {}, sent: false, sitePage: null, courses: [], reasons: [], selectedCourseId: '', selectedCourseTitle: '', cards: [], whatsappHref: '', faqs: [], ...d,
  });
}

// ---------------------------------------------------------------------------
// Page: 200 / disabled / SEO / cards / FAQ preview / CTA
// ---------------------------------------------------------------------------
test('GET /contact renders (200) with hero, form, reason options, published courses and 5 FAQs', async () => {
  try {
    setSite({});
    stubDb({});
    const { res, out } = mkRes();
    await publicController.contactPage(mkReq(), res, (e) => { throw e; });
    assert.equal(out.status, 200);
    assert.equal(out.rendered.view, 'public/contact');
    const d = out.rendered.data;
    assert.deepEqual(d.reasons, ['Course Enquiry', 'Enrollment Help', 'Payment Support', 'Technical Support', 'Partnership / Collaboration', 'Other']);
    assert.deepEqual(d.courses.map((c) => c.slug), ['advanced-fmr-master-class'], 'draft course is never offered');
    assert.equal(d.faqs.length, 5, '3-5 FAQs only');
    const html = await renderPage(out);
    assert.match(html, /<h1 class="ct-title">/);
    assert.match(html, /name="_csrf" value="tok"/);
    assert.match(html, /<option value="Technical Support"/);
    assert.match(html, /FAQ question 5\?/);
    assert.doesNotMatch(html, /FAQ question 6\?/);
    assert.match(html, /href="\/faq"[^>]*>View all FAQs/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /<span class="ct-req" aria-hidden="true">\*<\/span>/);
  } finally { restoreAll(); }
});

test('disabled Contact page is a 404 for GET and POST (no enquiry stored)', async () => {
  try {
    const created = [];
    stubDb({ page: { slug: 'contact', isEnabled: false, sections: [] }, created });
    const { res, out } = mkRes();
    await publicController.contactPage(mkReq(), res, (e) => { throw e; });
    assert.equal(out.status, 404);
    assert.equal(out.rendered.view, 'public/404');
    const post = mkRes();
    await publicController.postContact(mkReq({ body: GOOD }), post.res, (e) => { throw e; });
    assert.equal(post.out.status, 404);
    assert.equal(created.length, 0);
  } finally { restoreAll(); }
});

test('CMS persistence: hero, SEO and CTA fields from the SitePage row reach the page', async () => {
  try {
    setSite({});
    stubDb({ page: { slug: 'contact', isEnabled: true, eyebrow: 'Say hello', heading: 'We would love to hear from you', intro: 'Tell us what you need.', heroImageUrl: 'https://cdn.example.test/hero.jpg', ctaHeading: 'Ready when you are', ctaText: 'Pick a course', ctaLabel: 'See courses', ctaUrl: '/courses', seoTitle: 'Contact the ICDS team', metaDescription: 'Reach us any time.', sections: [] } });
    const { res, out } = mkRes();
    await publicController.contactPage(mkReq(), res, (e) => { throw e; });
    const d = out.rendered.data;
    assert.equal(d.pageTitle, 'Contact the ICDS team');
    assert.equal(d.metaDescription, 'Reach us any time.');
    assert.equal(out.rendered.data.seo.title, 'Contact the ICDS team');
    assert.equal(out.rendered.data.seo.canonical, 'http://localhost/contact');
    const html = await renderPage(out);
    for (const t of ['Say hello', 'We would love to hear from you', 'Tell us what you need.', 'https://cdn.example.test/hero.jpg', 'Ready when you are', 'Pick a course', 'See courses']) assert.ok(html.includes(t), t);
    assert.match(html, /<a class="ct-btn ct-btn-light" href="\/courses"/);
    assert.match(html, /<a class="ct-btn ct-btn-ghost" href="#contact-form">Talk to us</);
  } finally { restoreAll(); }
});

test('clearing the CTA / hero fields hides those blocks (no hardcoded fallback copy)', async () => {
  try {
    setSite({});
    stubDb({ page: { slug: 'contact', isEnabled: true, eyebrow: null, heading: null, intro: null, heroImageUrl: null, ctaHeading: null, ctaText: null, ctaLabel: null, ctaUrl: null, sections: [] } });
    const base = settingsService.defaultContent();
    const cms = { ...base, contactPage: { ...base.contactPage, ctaSecondaryLabel: '', heroHighlight: '', supportNote: '' } };
    const { res, out } = mkRes(cms);
    await publicController.contactPage(mkReq(), res, (e) => { throw e; });
    const html = await renderPage(out);
    assert.doesNotMatch(html, /ct-cta-section/);
    assert.doesNotMatch(html, /ct-note|ct-accent|ct-hero-media/);
    assert.doesNotMatch(html, /Get in touch/i);
  } finally { restoreAll(); }
});

test('hero highlighted text: wrapped inside the heading when it appears there, appended otherwise', async () => {
  try {
    setSite({});
    stubDb({});
    for (const [highlight, expect] of [['help', /We are here to <em class="ct-accent">help<\/em>\./], ['Brilliant', /We are here to help\.\s*<em class="ct-accent">Brilliant<\/em>/]]) {
      const base = settingsService.defaultContent();
      const cms = { ...base, contactPage: { ...base.contactPage, heading: 'We are here to help.', heroHighlight: highlight } };
      const { res, out } = mkRes(cms);
      await publicController.contactPage(mkReq(), res, (e) => { throw e; });
      assert.match(await renderPage(out), expect);
    }
  } finally { restoreAll(); }
});

test('contact cards appear ONLY for values the Admin configured; nothing is invented', async () => {
  try {
    const cms = settingsService.defaultContent();
    assert.deepEqual(enquiries.buildContactCards(cms, { contactEmail: '', contactPhone: '', whatsappNumber: '', address: '', businessHours: '', mapUrl: '' }), []);
    setSite({});
    stubDb({});
    const empty = mkRes();
    await publicController.contactPage(mkReq(), empty.res, (e) => { throw e; });
    const emptyHtml = await renderPage(empty.out);
    assert.doesNotMatch(emptyHtml, /ct-cards-section|mailto:|tel:|wa\.me|Open in Maps/);

    setSite({ contactEmail: 'hello@school.test', contactPhone: '+91 90000 11111', phoneHref: 'tel:919000011111', whatsappNumber: '919000022222', whatsappHref: 'https://wa.me/919000022222', whatsappDisplay: '+91 90000 22222', address: '1 Main Road\nCity', businessHours: 'Mon-Fri 9-5' });
    const full = mkRes();
    await publicController.contactPage(mkReq(), full.res, (e) => { throw e; });
    const html = await renderPage(full.out);
    assert.equal(full.out.rendered.data.cards.map((c) => c.key).join(','), 'email,phone,whatsapp,address,hours');
    assert.match(html, /href="mailto:hello@school\.test"/);
    assert.match(html, /href="tel:919000011111"/);
    assert.match(html, /href="https:\/\/wa\.me\/919000022222\?text=/);
    assert.match(html, /\+91 90000 22222/);
    assert.match(html, /Mon-Fri 9-5/);
    assert.match(html, /Open in Maps/);
    assert.match(html, /google\.com\/maps\/search\/\?api=1&amp;query=1%20Main%20Road%20City/);
    // only some details configured -> only those cards
    setSite({ contactEmail: 'only@school.test' });
    assert.deepEqual(enquiries.buildContactCards(cms, site).map((c) => c.key), ['email']);
  } finally { restoreAll(); }
});

test('map: explicit https map link wins over the generated one; no map button without an address', () => {
  assert.equal(enquiries.mapsLink({ mapUrl: 'https://maps.example.test/x', address: 'A' }), 'https://maps.example.test/x');
  assert.match(enquiries.mapsLink({ mapUrl: '', address: '5 Road, Town' }), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=5%20Road%2C%20Town$/);
  assert.equal(enquiries.mapsLink({ mapUrl: '', address: '' }), '');
  assert.doesNotMatch(contentView, /<iframe/i, 'no embedded map');
});

test('WhatsApp link is built from the Admin number with a safely encoded prefilled message', () => {
  assert.equal(enquiries.whatsappLink('+91 98765 43210', 'Advanced FMR Master Class'), 'https://wa.me/919876543210?text=Hi%2C%20I%20have%20a%20question%20about%20Advanced%20FMR%20Master%20Class');
  const evil = enquiries.whatsappLink('919876543210', 'A&b=c #x <script>');
  assert.doesNotMatch(evil, /[<> #]|&b=/);
  assert.match(evil, /text=Hi%2C%20I%20have%20a%20question%20about%20A%26b%3Dc%20%23x%20%3Cscript%3E$/);
  assert.equal(enquiries.whatsappLink('', 'X'), '', 'no number -> no WhatsApp');
  assert.equal(enquiries.whatsappLink('123', 'X'), '', 'implausible number rejected');
});

test('site.applyOverrides: WhatsApp / hours / map are Admin-managed and validated', () => {
  const prev = { ...site };
  try {
    site.applyOverrides({ whatsapp: '+91 98765 43210', hours: ' Mon-Sat 10-6 ', mapUrl: 'https://maps.example.test/abc' });
    assert.equal(site.whatsappNumber, '919876543210');
    assert.equal(site.whatsappHref, 'https://wa.me/919876543210');
    assert.equal(site.whatsappDisplay, '+91 98765 43210');
    assert.equal(site.businessHours, 'Mon-Sat 10-6');
    assert.equal(site.mapUrl, 'https://maps.example.test/abc');
    site.applyOverrides({ whatsapp: '12', mapUrl: 'javascript:alert(1)' });
    assert.equal(site.whatsappHref, '');
    assert.equal(site.mapUrl, '');
  } finally { Object.assign(site, prev); }
});

// ---------------------------------------------------------------------------
// Course context
// ---------------------------------------------------------------------------
test('?course=<slug> preselects a PUBLISHED course and carries it into the WhatsApp message; drafts/unknown are ignored', async () => {
  try {
    setSite({ whatsappNumber: '919000022222', whatsappHref: 'https://wa.me/919000022222', whatsappDisplay: '+91 90000 22222' });
    stubDb({});
    const a = mkRes();
    await publicController.contactPage(mkReq({ query: { course: 'advanced-fmr-master-class' } }), a.res, (e) => { throw e; });
    assert.equal(a.out.rendered.data.selectedCourseId, 6);
    assert.match(a.out.rendered.data.whatsappHref, /text=Hi%2C%20I%20have%20a%20question%20about%20Advanced%20FMR%20Master%20Class$/);
    const html = await renderPage(a.out);
    assert.match(html, /<option value="6" data-title="Advanced FMR Master Class" selected>/);
    for (const bad of ['hidden-draft-course', 'nope', '../etc/passwd', ['a', 'b'], '']) {
      const b = mkRes();
      await publicController.contactPage(mkReq({ query: { course: bad } }), b.res, (e) => { throw e; });
      assert.equal(b.out.rendered.data.selectedCourseId, '', `ignored: ${JSON.stringify(bad)}`);
    }
  } finally { restoreAll(); }
});

// ---------------------------------------------------------------------------
// Submission: valid / invalid / spam
// ---------------------------------------------------------------------------
test('valid enquiry is persisted (with phone, reason, course), flashed, redirected and the admin is emailed', async () => {
  try {
    setSite({});
    const db = stubDb({});
    let mailed = null;
    swap(emailService, 'sendContactNotification', async (v) => { mailed = v; return { sent: false }; });
    const { res, out } = mkRes();
    const req = mkReq({ body: { ...GOOD, subject: '', website: '' } });
    await publicController.postContact(req, res, (e) => { throw e; });
    assert.equal(out.redirected, '/contact#contact-form');
    assert.equal(req.ok, settingsService.defaultContent().contactPage.successMessage);
    assert.equal(db.created.length, 1);
    const row = db.created[0];
    assert.equal(row.name, 'Asha Rao');
    assert.equal(row.email, 'asha@example.com');
    assert.equal(row.phone, '+91 98765 43210');
    assert.equal(row.reason, 'Course Enquiry');
    assert.equal(row.courseId, 6);
    assert.equal(row.status, 'NEW');
    assert.equal(row.subject, 'Course Enquiry - Advanced FMR Master Class', 'subject auto-built from reason + course');
    await new Promise((r) => setImmediate(r));
    assert.equal(mailed.courseTitle, 'Advanced FMR Master Class');
    assert.equal(mailed.phone, '+91 98765 43210');
  } finally { restoreAll(); }
});

test('the success message is shown inline after the redirect (read-once flash) and only then', async () => {
  try {
    setSite({});
    stubDb({});
    const { res, out } = mkRes();
    res.locals.flash = { success: 'Thanks!', error: null };
    await publicController.contactPage(mkReq(), res, (e) => { throw e; });
    assert.equal(out.rendered.data.sent, true);
    assert.equal(out.locals.flash.success, null, 'header alert suppressed to avoid a duplicate');
    assert.match(await renderPage(out), /ct-alert-ok/);
    const plain = mkRes();
    await publicController.contactPage(mkReq(), plain.res, (e) => { throw e; });
    assert.doesNotMatch(await renderPage(plain.out), /ct-alert-ok/, 'never a fake success without a flash');
  } finally { restoreAll(); }
});

test('invalid submissions are rejected server-side with 400 and nothing is stored', async () => {
  const cases = [
    ['invalid email', { ...GOOD, email: 'not-an-email' }, /valid email/i],
    ['missing name', { ...GOOD, name: '' }, /full name/i],
    ['missing message', { ...GOOD, message: '' }, /Message must be/],
    ['short message', { ...GOOD, message: 'hi' }, /Message must be/],
    ['very long message', { ...GOOD, message: 'x'.repeat(5001) }, /Message must be/],
    ['unknown reason', { ...GOOD, reason: 'Hack the planet' }, /listed reasons/],
    ['missing reason', { ...GOOD, reason: '' }, /how we can help/i],
    ['bad phone', { ...GOOD, phone: 'call me maybe' }, /Phone may contain/],
    ['draft course', { ...GOOD, courseId: '7' }, /valid course/],
    ['unknown course', { ...GOOD, courseId: '999' }, /valid course/],
    ['non-numeric course', { ...GOOD, courseId: '6; DROP TABLE courses' }, /valid course/],
  ];
  for (const [label, body, re] of cases) {
    try {
      setSite({});
      const db = stubDb({});
      const { res, out } = mkRes();
      await publicController.postContact(mkReq({ body }), res, (e) => { throw e; });
      assert.equal(out.status, 400, label);
      assert.equal(db.created.length, 0, `${label}: stored nothing`);
      assert.match(out.rendered.data.errors.join(' '), re, label);
      assert.equal(out.rendered.data.values.name === undefined, false);
    } finally { restoreAll(); }
  }
});

test('spam is rejected, not stored and never reported as sent: honeypot, link floods, markup', async () => {
  const spam = [
    ['honeypot', { ...GOOD, website: 'http://spam.example' }],
    ['link flood', { ...GOOD, message: 'buy now http://a.example http://b.example http://c.example www.d.example' }],
    ['anchor markup', { ...GOOD, message: 'Great site <a href="http://x">click here</a> for more' }],
    ['script markup', { ...GOOD, message: 'hello <script>alert(1)</script> world friend' }],
    ['bbcode link', { ...GOOD, message: 'check [url=http://x]this out[/url] right now please' }],
  ];
  for (const [label, body] of spam) {
    try {
      setSite({});
      const db = stubDb({});
      let mailed = false;
      swap(emailService, 'sendContactNotification', async () => { mailed = true; return {}; });
      const { res, out } = mkRes();
      const req = mkReq({ body });
      await publicController.postContact(req, res, (e) => { throw e; });
      assert.equal(out.status, 400, label);
      assert.equal(db.created.length, 0, label);
      assert.equal(mailed, false, label);
      assert.equal(req.ok, undefined, `${label}: no success flash`);
      assert.match(out.rendered.data.errors[0], /could not send your message/i);
    } finally { restoreAll(); }
  }
});

test('a single legitimate link in a message is allowed', () => {
  const { errors, spam } = enquiries.validateEnquiry({ ...GOOD, message: 'My portfolio is at https://example.com/me if that helps.' }, { reasons: ['Course Enquiry'], courses: [{ id: 6, title: 'T', slug: 't' }] });
  assert.deepEqual(errors, []);
  assert.equal(spam, false);
});

test('sanitization: control characters stripped, whitespace collapsed, email lower-cased, plain text kept', () => {
  const { values } = enquiries.validateEnquiry({ name: '  Asha\u0000 \u0007Rao  ', email: ' ASHA@Example.COM ', phone: '', reason: 'Other', message: 'Line one\r\nLine two \u0001with control chars\u007f.' }, { reasons: ['Other'], courses: [] });
  assert.equal(values.name, 'Asha Rao');
  assert.equal(values.email, 'asha@example.com');
  assert.equal(values.message, 'Line one\nLine two with control chars.');
  assert.deepEqual(enquiries.parseReasonOptions('A\n\n  A  \nB\u0000\nC'.concat('\nD'.repeat(20))).slice(0, 4), ['A', 'B', 'C', 'D']);
  assert.ok(enquiries.parseReasonOptions(Array.from({ length: 30 }, (_, i) => `R${i}`).join('\n')).length <= 10);
});

test('if the enquiry cannot be stored the visitor sees an error - never a fake success', async () => {
  try {
    setSite({});
    stubDb({});
    swap(prisma.contactMessage, 'create', async () => { throw new Error('db down'); });
    let mailed = false;
    swap(emailService, 'sendContactNotification', async () => { mailed = true; return {}; });
    const { res, out } = mkRes();
    const req = mkReq({ body: GOOD });
    await publicController.postContact(req, res, (e) => { throw e; });
    assert.equal(out.status, 503);
    assert.equal(req.ok, undefined);
    assert.equal(out.redirected, null);
    assert.match(out.rendered.data.errors[0], /could not save your message/i);
    assert.equal(mailed, false);
  } finally { restoreAll(); }
});

test('a failing notification email never affects a stored enquiry', async () => {
  try {
    setSite({});
    const db = stubDb({});
    swap(emailService, 'sendContactNotification', async () => { throw new Error('smtp down'); });
    const { res, out } = mkRes();
    await publicController.postContact(mkReq({ body: GOOD }), res, (e) => { throw e; });
    assert.equal(out.redirected, '/contact#contact-form');
    assert.equal(db.created.length, 1);
  } finally { restoreAll(); }
});

// ---------------------------------------------------------------------------
// Security wiring
// ---------------------------------------------------------------------------
test('POST /contact is rate limited and CSRF protected; the form carries the token', () => {
  const routes = read('src/routes/index.routes.js');
  assert.match(routes, /router\.post\('\/contact', contactRateLimit, doubleCsrfProtection, publicController\.postContact\)/);
  const limiter = read('src/middleware/phase6RateLimit.js');
  assert.match(limiter, /contactRateLimit: formLimiter\(8\)/);
  assert.match(contentView, /name="_csrf" value="<%= csrfToken %>"/);
});

test('form markup: labels for every field, honeypot hidden from users, required indicators, maxlength limits', () => {
  for (const id of ['contact-name', 'contact-email', 'contact-phone', 'contact-reason', 'contact-course', 'contact-subject', 'contact-message']) {
    assert.match(contentView, new RegExp(`<label for="${id}"`), id);
  }
  assert.match(contentView, /class="ct-hp" aria-hidden="true"/);
  assert.match(contentView, /name="website" tabindex="-1" autocomplete="off"/);
  assert.match(contentView, /maxlength="5000"/);
  assert.match(read('public/css/contact-page.css'), /\.ct-hp \{ position: absolute; left: -9999px/);
  assert.match(read('public/css/contact-page.css'), /min-height: 48px/, '44px+ touch targets');
});

test('submitted text is escaped everywhere (enquiries, emails, re-rendered form)', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const html = await ejs.renderFile(path.join(root, 'views/public/contact-content.ejs'), {
    cms: settingsService.defaultContent(), site, csrfToken: 't', errors: [], values: { name: evil, message: evil, email: evil }, sent: false, sitePage: null, courses: [], reasons: [], selectedCourseId: '', selectedCourseTitle: '', cards: [], whatsappHref: '', faqs: [],
  });
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  const mail = templates.contactNotification({ name: evil, email: 'a@b.co', subject: evil, message: evil, phone: evil, reason: evil, courseTitle: evil });
  assert.doesNotMatch(mail.html, /<img src=x/);
  assert.match(mail.html, /Interested course/);
  assert.match(mail.text, /Phone: /);
});

// ---------------------------------------------------------------------------
// Admin enquiries
// ---------------------------------------------------------------------------
const mkMsg = (id, status, extra = {}) => ({ id, name: `Visitor ${id}`, email: `v${id}@example.com`, phone: '+91 90000 00000', subject: `Subject ${id}`, reason: 'Enrollment Help', courseId: 6, course: { id: 6, title: 'Advanced FMR Master Class', slug: 'x' }, message: `Message body ${id}`, status, createdAt: new Date(), updatedAt: new Date(), ...extra });

test('Admin enquiry list: shows reason, course and phone, filters by status and counts each status', async () => {
  try {
    const messages = [mkMsg(1, 'NEW'), mkMsg(2, 'IN_PROGRESS'), mkMsg(3, 'RESOLVED'), mkMsg(4, 'SPAM'), mkMsg(5, 'NEW')];
    stubDb({ messages });
    const { res, out } = mkRes();
    await engagement.messages({ query: {} }, res, (e) => { throw e; });
    assert.equal(out.rendered.view, 'admin/messages');
    assert.equal(out.rendered.data.counts.NEW, 2);
    assert.equal(out.rendered.data.total, 5);
    const html = await ejs.renderFile(path.join(root, 'views/admin/messages-content.ejs'), { ...out.rendered.data, csrfToken: 't' });
    for (const t of ['Visitor 1', 'Enrollment Help', 'Advanced FMR Master Class', '+91 90000 00000', 'In progress', 'Resolved', 'Spam']) assert.ok(html.includes(t), t);
    assert.match(html, /action="\/admin\/messages\/1\/status"/);
    const filtered = mkRes();
    await engagement.messages({ query: { status: 'spam' } }, filtered.res, (e) => { throw e; });
    assert.deepEqual(filtered.out.rendered.data.messages.map((m) => m.id), [4]);
    const bogus = mkRes();
    await engagement.messages({ query: { status: "NEW'; DROP" } }, bogus.res, (e) => { throw e; });
    assert.equal(bogus.out.rendered.data.filter, '');
  } finally { restoreAll(); }
});

test('Admin can view, mark In Progress / Resolved / Spam, reject bad statuses and delete', async () => {
  try {
    const messages = [mkMsg(10, 'NEW')];
    stubDb({ messages });
    const view = mkRes();
    await engagement.messageDetail({ params: { id: '10' } }, view.res, (e) => { throw e; });
    const detail = await ejs.renderFile(path.join(root, 'views/admin/message-detail-content.ejs'), { ...view.out.rendered.data, csrfToken: 't' });
    for (const t of ['Visitor 10', 'Message body 10', 'Enrollment Help', 'Advanced FMR Master Class', '+91 90000 00000', 'Mark In Progress', 'Mark Resolved', 'Mark Spam', 'Delete']) assert.ok(detail.includes(t), t);
    assert.match(detail, /data-confirm="Delete this enquiry permanently\?"/);

    for (const status of ['IN_PROGRESS', 'RESOLVED', 'SPAM']) {
      const req = mkReq({ params: { id: '10' }, body: { status } });
      const { res, out } = mkRes();
      await engagement.updateMessage(req, res, (e) => { throw e; });
      assert.equal(messages[0].status, status);
      assert.equal(out.redirected, '/admin/messages/10');
    }
    const bad = mkReq({ params: { id: '10' }, body: { status: 'DELETED' } });
    await engagement.updateMessage(bad, mkRes().res, (e) => { throw e; });
    assert.match(bad.err, /Invalid enquiry status/);
    assert.equal(messages[0].status, 'SPAM');

    const del = mkReq({ params: { id: '10' } });
    const delRes = mkRes();
    await engagement.deleteMessage(del, delRes.res, (e) => { throw e; });
    assert.equal(messages.length, 0);
    assert.equal(delRes.out.redirected, '/admin/messages');
    const again = mkReq({ params: { id: '10' } });
    await engagement.deleteMessage(again, mkRes().res, (e) => { throw e; });
    assert.match(again.err, /not found/i);
  } finally { restoreAll(); }
});

test('enquiry admin routes exist behind the admin router with CSRF on every mutation; enquiries are not exposed publicly', () => {
  const routes = read('src/routes/admin.routes.js');
  assert.match(routes, /router\.get\('\/messages', engagementController\.messages\)/);
  assert.match(routes, /router\.post\('\/messages\/:id\/status', doubleCsrfProtection, engagementController\.updateMessage\)/);
  assert.match(routes, /router\.post\('\/messages\/:id\/delete', doubleCsrfProtection, engagementController\.deleteMessage\)/);
  assert.match(read('views/partials/admin-header.ejs'), /href="\/admin\/messages"[^>]*>.*Contact Enquiries/);
  const publicRoutes = read('src/routes/index.routes.js');
  assert.doesNotMatch(publicRoutes, /messages|enquir/i);
});

// ---------------------------------------------------------------------------
// Admin-editable settings + source-of-truth audit
// ---------------------------------------------------------------------------
test('Admin Site Content: contact details (WhatsApp, hours, map link) validate and persist as plain text', () => {
  const brand = FORM_BY_PATH.get('brand/contact').form;
  const ok = validateForm(brand, { 'contact.email': 'hi@school.test', 'contact.phone': '+91 98765 43210', 'contact.whatsapp': '+91 98765 43210', 'contact.hours': 'Mon - Sat, 10:00 - 18:00', 'contact.mapUrl': 'https://maps.example.test/place/abc' });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.values['contact.whatsapp'], '+91 98765 43210');
  assert.equal(ok.values['contact.mapUrl'], 'https://maps.example.test/place/abc');
  for (const bad of [{ 'contact.mapUrl': 'javascript:alert(1)' }, { 'contact.mapUrl': 'http://insecure.example' }, { 'contact.whatsapp': 'call me' }, { 'contact.hours': '<b>9-5</b>' }]) {
    assert.ok(validateForm(brand, bad).errors.length, JSON.stringify(bad));
  }
  assert.equal(validateForm(brand, { 'contact.whatsapp': '' }).values['contact.whatsapp'], '', 'blank clears');
});

test('Admin Site Content > Contact: every contact-page field validates, including reason options', () => {
  const form = FORM_BY_PATH.get('contact/page').form;
  const body = Object.fromEntries(form.fields.filter((f) => !f.heading).map((f) => [f.key, f.def]));
  body['contactPage.reasonOptions'] = 'Sales\nSupport';
  body['contactPage.heroHighlight'] = 'We reply fast.';
  body['contactPage.supportNote'] = 'Usually within a day';
  const r = validateForm(form, body);
  assert.deepEqual(r.errors, []);
  assert.equal(r.values['contactPage.reasonOptions'], 'Sales\nSupport');
  assert.ok(validateForm(form, { ...body, 'contactPage.heroHighlight': '<script>x</script>' }).errors.length, 'markup rejected');
});

test('source of truth: every cms.contactPage value the view reads is an Admin-editable registry field, and every registry field is used', () => {
  const used = new Set([...contentView.matchAll(/\bcp\.(\w+)/g)].map((m) => m[1]));
  const registry = new Set([...FIELD_BY_KEY.keys()].filter((k) => k.startsWith('contactPage.')).map((k) => k.slice('contactPage.'.length)));
  assert.ok(used.size > 18);
  assert.deepEqual([...used].filter((k) => !registry.has(k)), [], 'view reads a value with no Admin input');
  const sources = [contentView, read('src/controllers/public.controller.js'), read('src/services/contactEnquiry.service.js')].join('\n');
  const dead = [...registry].filter((k) => !new RegExp(`\\b${k}\\b`).test(sources));
  assert.deepEqual(dead, [], 'Admin inputs that change nothing');
});

test('source of truth: contact details flow settings -> site config -> cards (no hardcoded contact data in views)', () => {
  const svc = read('src/services/settings.service.js');
  for (const key of ['contact.email', 'contact.phone', 'contact.whatsapp', 'contact.address', 'contact.hours', 'contact.mapUrl']) {
    assert.ok(FIELD_BY_KEY.has(key), `Admin input ${key}`);
    assert.match(svc, new RegExp(`flat\\['${key.replace('.', '\\.')}'\\]`), `settings service reads ${key}`);
  }
  const cardsSrc = read('src/services/contactEnquiry.service.js');
  for (const s of ['contactEmail', 'contactPhone', 'whatsappNumber', 'address', 'businessHours']) assert.match(cardsSrc, new RegExp(`s\\.${s}`), s);
  const hardcoded = [...contentView.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0]);
  assert.deepEqual(hardcoded, [], 'no hardcoded email address');
  assert.doesNotMatch(contentView, /\+?\d[\d\s-]{8,}\d/, 'no hardcoded phone number');
  assert.doesNotMatch(contentView, /wa\.me\/\d|tel:\d|mailto:[^<]*@/, 'no hardcoded contact links');
  assert.match(read('src/services/sitePages.service.js'), /contact: \{ slug: 'contact'/);
});

test('Admin Pages > Contact editor links to the other contact settings and the enquiries', async () => {
  const html = await ejs.renderFile(path.join(root, 'views/admin/pages/edit-content.ejs'), {
    csrfToken: 't', meta: { slug: 'contact', label: 'Contact', path: '/contact', description: 'd', hasSections: false },
    page: { slug: 'contact', isEnabled: true, eyebrow: 'E', heading: 'H', intro: 'I', heroImageUrl: '', ctaHeading: '', ctaText: '', ctaLabel: '', ctaUrl: '', seoTitle: '', metaDescription: '' }, sections: [],
  });
  assert.match(html, /\/admin\/site-content\/brand/);
  assert.match(html, /\/admin\/site-content\/contact/);
  assert.match(html, /href="\/admin\/messages"/);
  for (const n of ['isEnabled', 'eyebrow', 'heading', 'intro', 'heroImageUrl', 'ctaHeading', 'ctaText', 'ctaLabel', 'ctaUrl', 'seoTitle', 'metaDescription']) assert.match(html, new RegExp(`name="${n}"`), n);
});

test('FAQ preview can be switched off from Admin and uses the shared FAQ table (no copies)', async () => {
  try {
    setSite({});
    stubDb({});
    const base = settingsService.defaultContent();
    const { res, out } = mkRes({ ...base, contactPage: { ...base.contactPage, faqEnabled: false } });
    await publicController.contactPage(mkReq(), res, (e) => { throw e; });
    assert.equal(out.rendered.data.faqs.length, 0);
    assert.doesNotMatch(await renderPage(out), /ct-faq-section/);
    assert.doesNotMatch(contentView, /FAQ question|Do courses include/, 'no hardcoded FAQ content');
  } finally { restoreAll(); }
});

test('navigation: Contact still points to /contact (no homepage anchor)', () => {
  const nav = read('src/services/navigation.service.js');
  assert.match(nav, /url: '\/contact'/);
  assert.doesNotMatch(nav, /#contact/);
});

test('migration is additive: extends contact_messages, nothing dropped or deleted', () => {
  const dir = fs.readdirSync(path.join(root, 'prisma/migrations')).filter((d) => d.includes('contact_enquiry_fields'));
  assert.equal(dir.length, 1);
  const sql = fs.readFileSync(path.join(root, 'prisma/migrations', dir[0], 'migration.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN `phone`/);
  assert.match(sql, /ADD COLUMN `reason`/);
  assert.match(sql, /ADD COLUMN `courseId`/);
  assert.match(sql, /ENUM\('NEW', 'READ', 'IN_PROGRESS', 'RESOLVED', 'SPAM'\)/, 'old values stay valid');
  assert.match(sql, /ON DELETE SET NULL/);
  assert.doesNotMatch(sql, /\bDROP\b|TRUNCATE|^\s*(DELETE|UPDATE)\b/im);
});
