process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

// CMS-backed standalone pages (/about /faq /reviews /contact): service rules,
// disabled-page behaviour, public controllers, views, sitemap and FAQ categories.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const { prisma } = require('../src/config/db');
const sp = require('../src/services/sitePages.service');
const navigation = require('../src/services/navigation.service');
const faqService = require('../src/services/faq.service');
const homeService = require('../src/services/home.service');
const courseService = require('../src/services/course.service');
const pagesController = require('../src/controllers/pages.controller');
const seoController = require('../src/controllers/seo.controller');
const { validateFaq } = require('../src/validators/faq.validator');
const site = require('../src/config/site');
const settingsService = require('../src/services/settings.service');

const root = path.join(__dirname, '..');
const VIEWS = path.join(root, 'views');
const render = (view, data) => ejs.renderFile(path.join(VIEWS, view), data, { views: [VIEWS] });
const cms = settingsService.defaultContent();

// ---------------------------------------------------------------------------
// In-memory fake of sitePage / sitePageSection
// ---------------------------------------------------------------------------
function installFake() {
  const pages = new Map();
  const sections = [];
  let pid = 1;
  let sid = 1;
  const keep = {
    page: { ...prisma.sitePage },
    sec: { ...prisma.sitePageSection },
    tx: prisma.$transaction,
  };
  const withSections = (row, args = {}) => {
    if (!row) return null;
    let secs = sections.filter((s) => s.pageId === row.id);
    if (args.include && args.include.sections && args.include.sections.where && args.include.sections.where.isPublished) secs = secs.filter((s) => s.isPublished);
    secs = secs.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    return { ...row, sections: secs, _count: { sections: secs.length } };
  };
  prisma.sitePage.findUnique = async (args) => {
    const row = pages.get(args.where.slug);
    if (!row) return null;
    return args.include ? withSections(row, args) : { ...row };
  };
  prisma.sitePage.findMany = async (args = {}) => {
    let rows = [...pages.values()];
    if (args.where && args.where.isEnabled === false) rows = rows.filter((r) => r.isEnabled === false);
    return rows.map((r) => withSections(r, args));
  };
  prisma.sitePage.create = async ({ data }) => {
    const { sections: nested, ...rest } = data;
    const row = { id: pid++, isEnabled: true, ...rest };
    pages.set(row.slug, row);
    (nested && nested.create ? nested.create : []).forEach((s) => sections.push({ id: sid++, pageId: row.id, ...s }));
    return { ...row };
  };
  prisma.sitePage.update = async ({ where, data }) => {
    const row = pages.get(where.slug);
    Object.assign(row, data);
    return { ...row };
  };
  prisma.sitePageSection.findUnique = async ({ where }) => {
    const s = sections.find((x) => x.id === where.id);
    if (!s) return null;
    const page = [...pages.values()].find((p) => p.id === s.pageId);
    return { ...s, page: { slug: page.slug } };
  };
  prisma.sitePageSection.findMany = async ({ where }) => sections.filter((s) => s.pageId === where.pageId).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  prisma.sitePageSection.aggregate = async ({ where }) => ({ _max: { sortOrder: sections.filter((s) => s.pageId === where.pageId).reduce((m, s) => Math.max(m, s.sortOrder), 0) || null } });
  prisma.sitePageSection.create = async ({ data }) => { const row = { id: sid++, ...data }; sections.push(row); return row; };
  prisma.sitePageSection.update = async ({ where, data }) => { const s = sections.find((x) => x.id === where.id); Object.assign(s, data); return s; };
  prisma.sitePageSection.delete = async ({ where }) => { sections.splice(sections.findIndex((x) => x.id === where.id), 1); };
  prisma.$transaction = async (ops) => Promise.all(ops);
  navigation.invalidateNavCache();
  return {
    pages, sections,
    restore() {
      Object.assign(prisma.sitePage, keep.page);
      Object.assign(prisma.sitePageSection, keep.sec);
      prisma.$transaction = keep.tx;
      navigation.invalidateNavCache();
    },
  };
}
async function withFake(fn) {
  const db = installFake();
  try { await fn(db); } finally { db.restore(); }
}

const mkRes = (extra = {}) => ({
  locals: { cms, settings: null, ...extra },
  statusCode: 200,
  status(c) { this.statusCode = c; return this; },
  render(view, data) { this.view = view; this.data = data; },
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
test('with no page row the starter copy comes from the site content (no invented claims)', async () => {
  await withFake(async () => {
    const about = await sp.getPublicPage('about', cms);
    assert.equal(about.fromStarter, true);
    assert.equal(about.page.heading, cms.why.heading);
    assert.equal(about.page.intro, cms.why.description);
    assert.deepEqual(about.sections.map((s) => s.title), [1, 2, 3, 4].map((n) => cms.why[`feature${n}Title`]));
    assert.equal(about.page.isEnabled, true);
    const faq = await sp.getPublicPage('faq', cms);
    assert.equal(faq.page.heading, cms.faq.heading);
    assert.equal(sp.starterDefaults('about', cms).ctaUrl, '/courses');
    for (const slug of sp.PAGE_SLUGS) {
      const d = sp.starterDefaults(slug, cms);
      assert.ok(!/\d{5,}|@|\+91/.test(`${d.intro} ${d.ctaText}`), `${slug} starter must not contain phone/email-like claims`);
    }
  });
});

test('unknown slugs are rejected', async () => {
  await assert.rejects(() => sp.getPublicPage('admin'), /Unknown page/);
  await assert.rejects(() => sp.updatePage('../etc', {}), /Unknown page/);
});

test('ensurePage creates the row and starter sections once, and never overwrites', async () => {
  await withFake(async (db) => {
    const first = await sp.ensurePage('about', cms);
    assert.equal(first.created, true);
    assert.equal(db.sections.length, 4);
    await sp.updatePage('about', { heading: 'Customised heading' }, cms);
    const again = await sp.ensurePage('about', cms);
    assert.equal(again.created, false);
    assert.equal(db.pages.get('about').heading, 'Customised heading');
    assert.equal(db.sections.length, 4, 'no duplicate sections');
  });
});

test('clearing a field hides it publicly and the old starter copy does not come back', async () => {
  await withFake(async () => {
    await sp.ensurePage('about', cms);
    await sp.updatePage('about', { intro: '', ctaHeading: '', ctaText: '', ctaLabel: '', ctaUrl: '', heading: '' }, cms);
    const { page } = await sp.getPublicPage('about', cms);
    assert.equal(page.intro, '');
    assert.equal(page.heading, '');
    assert.equal(page.ctaHeading, '');
    assert.equal(page.ctaLabel, '');
    const html = await render('public/about-content.ejs', { cms, site, page, sections: [], courses: [], founder: null });
    assert.doesNotMatch(html, /sp-intro/);
    assert.doesNotMatch(html, /sp-cta/);
    assert.doesNotMatch(html, /<h1/);
  });
});

test('page updates are partial and boolean-safe', async () => {
  await withFake(async (db) => {
    await sp.ensurePage('faq', cms);
    await sp.updatePage('faq', { heading: 'New heading' }, cms);
    assert.equal(db.pages.get('faq').isEnabled, true, 'editing the heading never toggles enabled');
    await sp.updatePage('faq', { isEnabled: 'false' }, cms);
    assert.equal(db.pages.get('faq').isEnabled, false);
    assert.equal(db.pages.get('faq').heading, 'New heading');
    await sp.updatePage('faq', { isEnabled: ['false', 'true'] }, cms);
    assert.equal(db.pages.get('faq').isEnabled, true);
    await sp.updatePage('faq', { seoTitle: 'SEO', metaDescription: 'Meta' }, cms);
    assert.equal(db.pages.get('faq').heading, 'New heading', 'SEO save keeps the heading');
    assert.equal(db.pages.get('faq').seoTitle, 'SEO');
  });
});

test('page validation: CTA link, hero image and length limits', async () => {
  await withFake(async (db) => {
    await sp.ensurePage('about', cms);
    await assert.rejects(() => sp.updatePage('about', { ctaUrl: 'javascript:alert(1)' }, cms), /CTA link/);
    await assert.rejects(() => sp.updatePage('about', { ctaUrl: '//evil.example' }, cms), /CTA link/);
    await assert.rejects(() => sp.updatePage('about', { heroImageUrl: 'javascript:alert(1)' }, cms), /Hero image/);
    await assert.rejects(() => sp.updatePage('about', { heroImageUrl: 'http://insecure.example/a.png' }, cms), /Hero image/);
    await assert.rejects(() => sp.updatePage('about', { seoTitle: 'x'.repeat(71) }, cms), /70 characters/);
    await assert.rejects(() => sp.updatePage('about', { metaDescription: 'x'.repeat(201) }, cms), /200 characters/);
    await assert.rejects(() => sp.updatePage('about', { heading: 'x'.repeat(201) }, cms), /200 characters/);
    await sp.updatePage('about', { ctaUrl: '/courses', heroImageUrl: 'https://cdn.example.com/a.jpg' }, cms);
    assert.equal(db.pages.get('about').ctaUrl, '/courses');
    await sp.updatePage('about', { heroImageUrl: '/uploads/thumbnails/abc.png' }, cms);
    assert.equal(db.pages.get('about').heroImageUrl, '/uploads/thumbnails/abc.png');
  });
});

test('sections: add, edit, publish toggle, reorder, delete, ownership and icon validation', async () => {
  await withFake(async (db) => {
    await sp.ensurePage('about', cms);
    await sp.ensurePage('faq', cms);
    const added = await sp.addSection('about', { title: 'Our mission', body: 'Text', icon: 'bi-star' }, cms);
    assert.equal(added.icon, 'bi-star');
    await assert.rejects(() => sp.addSection('about', { title: '', body: '' }, cms), /title or some text/);
    await assert.rejects(() => sp.addSection('about', { title: 'x', icon: 'bi-star" onclick="x' }, cms), /Bootstrap icon/);
    await assert.rejects(() => sp.addSection('faq', { title: 'x' }, cms), /does not use content sections/);

    await sp.updateSection('about', added.id, { title: 'Renamed' });
    const row = db.sections.find((s) => s.id === added.id);
    assert.equal(row.title, 'Renamed');
    assert.equal(row.body, 'Text', 'untouched');
    assert.equal(row.isPublished, true, 'editing the title never unpublishes');
    await sp.updateSection('about', added.id, { isPublished: 'false' });
    assert.equal(row.isPublished, false);
    assert.equal(row.title, 'Renamed');

    const other = db.sections.find((s) => s.id !== added.id);
    await assert.rejects(() => sp.updateSection('faq', other.id, { title: 'hijack' }), /Section not found/);
    await assert.rejects(() => sp.deleteSection('faq', other.id), /Section not found/);

    const order = () => db.sections.filter((s) => s.pageId === db.pages.get('about').id).sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.id);
    const before = order();
    assert.equal(await sp.moveSection('about', before[before.length - 1], 'up'), true);
    const after = order();
    assert.deepEqual(after.slice(0, -2), before.slice(0, -2));
    assert.equal(after[after.length - 2], before[before.length - 1], 'moved up one place');
    assert.equal(await sp.moveSection('about', after[0], 'up'), false);

    await sp.deleteSection('about', added.id);
    assert.equal(db.sections.some((s) => s.id === added.id), false);
  });
});

test('public page hides unpublished sections and returns null when disabled', async () => {
  await withFake(async () => {
    await sp.ensurePage('about', cms);
    const s = await sp.addSection('about', { title: 'Visible' }, cms);
    const hidden = await sp.addSection('about', { title: 'Secret', isPublished: 'false' }, cms);
    const data = await sp.getPublicPage('about', cms);
    assert.ok(data.sections.some((x) => x.id === s.id));
    assert.ok(!data.sections.some((x) => x.id === hidden.id));
    await sp.updatePage('about', { isEnabled: 'false' }, cms);
    assert.equal(await sp.getPublicPage('about', cms), null);
    assert.equal(await sp.isPageEnabled('about'), false);
    assert.equal(await sp.isPageEnabled('faq'), true, 'no row => enabled');
  });
});

test('admin page list reports every managed page and its status', async () => {
  await withFake(async () => {
    await sp.ensurePage('faq', cms);
    await sp.updatePage('faq', { isEnabled: 'false' }, cms);
    const list = await sp.listPagesAdmin();
    assert.deepEqual(list.map((p) => p.slug), ['about', 'faq', 'reviews', 'contact']);
    assert.equal(list.find((p) => p.slug === 'faq').isEnabled, false);
    assert.equal(list.find((p) => p.slug === 'about').exists, false);
  });
});

// ---------------------------------------------------------------------------
// Public controllers
// ---------------------------------------------------------------------------
function swap(obj, key, impl) {
  const prev = obj[key];
  obj[key] = impl;
  return () => { obj[key] = prev; };
}

test('disabled pages answer with the standard 404 (about, faq, reviews)', async () => {
  await withFake(async () => {
    for (const slug of ['about', 'faq', 'reviews']) {
      await sp.ensurePage(slug, cms);
      await sp.updatePage(slug, { isEnabled: 'false' }, cms);
    }
    for (const fn of ['aboutPage', 'faqPage', 'reviewsPage']) {
      const res = mkRes();
      await pagesController[fn]({ query: {}, protocol: 'http', get: () => 'localhost', originalUrl: '/x' }, res, (e) => { throw e; });
      assert.equal(res.statusCode, 404, fn);
      assert.equal(res.view, 'public/404');
    }
  });
});

test('/faq renders admin FAQs with categories, JSON-LD and SEO from the page row', async () => {
  await withFake(async () => {
    await sp.ensurePage('faq', cms);
    await sp.updatePage('faq', { seoTitle: 'FAQ SEO', metaDescription: 'FAQ meta', heading: 'Ask us' }, cms);
    const restore = swap(prisma.faq, 'findMany', async () => [
      { id: 1, question: 'How to enroll?', answer: 'Sign up.', category: 'Enrollment', isActive: true, sortOrder: 1 },
      { id: 2, question: 'Certificates?', answer: 'Yes.', category: 'Enrollment', isActive: true, sortOrder: 2 },
      { id: 3, question: 'Mobile?', answer: 'Yes.', category: 'Access', isActive: true, sortOrder: 3 },
      { id: 4, question: 'No category?', answer: 'Fine.', category: null, isActive: true, sortOrder: 4 },
    ]);
    try {
      const res = mkRes();
      await pagesController.faqPage({ query: {}, protocol: 'http', get: () => 'localhost', originalUrl: '/faq' }, res, (e) => { throw e; });
      assert.equal(res.view, 'public/faq');
      assert.deepEqual(res.data.categories, ['Enrollment', 'Access']);
      assert.equal(res.data.faqs.length, 4);
      assert.equal(res.data.seo.title, 'FAQ SEO');
      assert.equal(res.data.seo.description, 'FAQ meta');
      assert.match(res.data.seo.canonical, /\/faq$/);
      assert.equal(res.data.seo.jsonLd['@type'], 'FAQPage');
      assert.equal(res.data.seo.jsonLd.mainEntity.length, 4);
    } finally {
      restore();
    }
  });
});

const fakeTestimonial = (id, extra = {}) => ({
  id, courseId: 1, reviewerName: `Rev ${id}`, reviewerDesignation: 'Dentist', reviewerLocation: 'Delhi', quote: `Quote ${id}`, rating: 5,
  avatarUrl: null, initials: `R${id}`, sortOrder: id, isPublished: true, isDemo: false, reviewType: 'TEXT',
  videoUrl: null, videoObjectKey: null, videoThumbnailUrl: null, course: { title: 'Course A', slug: 'course-a' }, ...extra,
});

async function runReviews(rows, query = {}) {
  let where = null;
  const restore = swap(prisma.courseTestimonial, 'findMany', async (args) => { where = args.where; return rows; });
  try {
    const res = mkRes();
    await pagesController.reviewsPage({ query, protocol: 'http', get: () => 'localhost', originalUrl: '/reviews' }, res, (e) => { throw e; });
    return { res, where };
  } finally {
    restore();
  }
}

test('/reviews only queries genuine published non-demo testimonials of published courses', async () => {
  await withFake(async () => {
    const { where } = await runReviews([]);
    assert.equal(where.isPublished, true);
    assert.equal(where.isDemo, false);
    assert.equal(where.course.status, 'PUBLISHED');
  });
});

test('/reviews supports TEXT, VIDEO and TEXT_VIDEO and drops unplayable videos', async () => {
  await withFake(async () => {
    const rows = [
      fakeTestimonial(1),
      fakeTestimonial(2, { reviewType: 'VIDEO', quote: '', videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
      fakeTestimonial(3, { reviewType: 'TEXT_VIDEO', videoUrl: 'https://vimeo.com/123456789' }),
      fakeTestimonial(4, { reviewType: 'VIDEO', quote: 'x', videoUrl: null, videoObjectKey: null }), // unplayable video review: dropped
      fakeTestimonial(5, { reviewType: 'TEXT_VIDEO', videoUrl: null }), // video missing: still a valid quote
    ];
    const all = await runReviews(rows);
    assert.deepEqual(all.res.data.reviews.map((r) => r.id), [1, 2, 3, 5]);
    assert.deepEqual(all.res.data.counts, { all: 4, text: 2, video: 2 });
    const video = await runReviews(rows, { type: 'video' });
    assert.deepEqual(video.res.data.reviews.map((r) => r.id), [2, 3]);
    assert.equal(video.res.data.seo.canonical, null, 'filtered views are not canonical/indexable');
    const text = await runReviews(rows, { type: 'text' });
    assert.deepEqual(text.res.data.reviews.map((r) => r.id), [1, 5]);
    const junk = await runReviews(rows, { type: 'x"><script>' });
    assert.equal(junk.res.data.filter, 'all');
    for (const r of all.res.data.reviews) {
      assert.equal('videoObjectKey' in r, false, 'no object key leaks into the view model');
      assert.equal('videoUrl' in r, false);
    }
  });
});

test('/about assembles featured courses and the founder', async () => {
  await withFake(async () => {
    const r1 = swap(homeService, 'getFeaturedCourses', async () => [{ id: 1, title: 'C1', slug: 'c1' }]);
    const r2 = swap(prisma.instructor, 'findFirst', async () => ({ name: 'Dr F', title: 'Founder', photoUrl: null, shortBio: 'Bio', founderIntro: null }));
    try {
      const res = mkRes();
      await pagesController.aboutPage({ protocol: 'http', get: () => 'localhost', originalUrl: '/about' }, res, (e) => { throw e; });
      assert.equal(res.view, 'public/about');
      assert.equal(res.data.courses.length, 1);
      assert.equal(res.data.founder.name, 'Dr F');
      assert.equal(res.data.page.heading, cms.why.heading);
    } finally {
      r1(); r2();
    }
  });
});

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
const view = (extra = {}) => ({ cms, site, fill: settingsService.fill, csrfToken: 't', flash: {}, currentUser: undefined, footerCategories: [], pageTitle: 'T', metaDescription: 'D', seo: undefined, coursePriceOf: undefined, ...extra });
const page = (extra = {}) => ({ slug: 'x', isEnabled: true, eyebrow: 'Eyebrow', heading: 'Heading', intro: 'Intro text', heroImageUrl: '', ctaHeading: 'Cta head', ctaText: 'Cta text', ctaLabel: 'Go', ctaUrl: '/courses', seoTitle: '', metaDescription: '', ...extra });

test('faq view: accessible accordion, search, category chips only when categories exist', async () => {
  const faqs = [{ id: 1, question: 'Q1?', answer: 'A1', category: 'Cat' }, { id: 2, question: 'Q2?', answer: 'A2', category: null }];
  const html = await render('public/faq-content.ejs', view({ page: page(), faqs, categories: ['Cat'] }));
  assert.match(html, /aria-expanded="false" aria-controls="faq-panel-1"/);
  assert.match(html, /role="region" aria-labelledby="faq-btn-1"/);
  assert.match(html, /data-faq-search/);
  assert.match(html, /data-faq-category="Cat"/);
  assert.match(html, /data-category="Cat"/);
  assert.match(html, /faq-page\.js/);
  const plain = await render('public/faq-content.ejs', view({ page: page(), faqs, categories: [] }));
  assert.doesNotMatch(plain, /data-faq-category/);
  const empty = await render('public/faq-content.ejs', view({ page: page(), faqs: [], categories: [] }));
  assert.match(empty, /No questions have been published yet/);
  const escaped = await render('public/faq-content.ejs', view({ page: page(), faqs: [{ id: 9, question: '<b>x</b>?', answer: '<script>1</script>', category: '"><i>' }], categories: [] }));
  assert.doesNotMatch(escaped, /<script>1<\/script>/);
});

test('reviews view: star labels, accessible play buttons, filters, no demo markup', async () => {
  const r = (id, extra = {}) => ({ id, reviewType: 'TEXT', hasVideo: false, videoKind: null, embedUrl: null, videoThumbnailUrl: '', quote: 'Great', rating: 4, reviewerName: `Name ${id}`, reviewerDesignation: '', reviewerLocation: '', avatarUrl: '', initials: 'NN', courseTitle: 'C', courseSlug: 'c', ...extra });
  const html = await render('public/reviews-content.ejs', view({
    page: page(),
    reviews: [r(1), r(2, { hasVideo: true, videoKind: 'embed', embedUrl: 'https://www.youtube.com/embed/abc', reviewType: 'VIDEO', quote: '' })],
    filter: 'all', counts: { all: 2, text: 1, video: 1 },
  }));
  assert.match(html, /role="img" aria-label="Rated 4 out of 5"/);
  assert.match(html, /aria-label="Play video review from Name 2"/);
  assert.match(html, /data-testimonial-video data-kind="embed"/);
  assert.match(html, /testimonial-player\.js/);
  assert.match(html, /href="\/reviews\?type=video"/);
  assert.match(html, /aria-current="true"/);
  assert.doesNotMatch(html, /DEMO/i);
  const none = await render('public/reviews-content.ejs', view({ page: page(), reviews: [], filter: 'all', counts: { all: 0, text: 0, video: 0 } }));
  assert.match(none, /No reviews to show yet/);
  assert.doesNotMatch(none, /sp-review-filter/);
});

test('about view renders sections, courses, founder and a CTA only when there is content', async () => {
  const html = await render('public/about-content.ejs', view({
    page: page(), sections: [{ title: 'Mission', body: 'Body', icon: 'bi-star' }], courses: [], founder: { name: 'Dr F', title: 'Founder', photoUrl: '', shortBio: 'Bio' },
  }));
  assert.match(html, /<h2>Mission<\/h2>/);
  assert.match(html, /bi bi-star/);
  assert.match(html, /href="\/founder"/);
  assert.match(html, /sp-cta/);
  const bare = await render('public/about-content.ejs', view({ page: page({ ctaHeading: '', ctaText: '', ctaLabel: '', ctaUrl: '' }), sections: [], courses: [], founder: null }));
  assert.doesNotMatch(bare, /sp-cta/);
  assert.doesNotMatch(bare, /sp-founder/);
});

test('contact view uses the CMS page overrides and falls back to Site Content', async () => {
  const base = { errors: [], values: {}, ...view() };
  const withRow = await render('public/contact-content.ejs', { ...base, sitePage: page({ eyebrow: 'Reach us', heading: 'Talk to us', intro: 'We reply fast' }) });
  assert.match(withRow, /Reach us/);
  assert.match(withRow, /Talk to us/);
  assert.match(withRow, /We reply fast/);
  const without = await render('public/contact-content.ejs', { ...base, sitePage: null });
  assert.match(without, new RegExp(cms.contactPage.heading));
  const blank = await render('public/contact-content.ejs', { ...base, sitePage: page({ eyebrow: '', heading: '', intro: '' }) });
  assert.match(blank, new RegExp(cms.contactPage.heading), 'blank override falls back to Site Content (labels live there)');
});

test('contact route + controller honour the disabled switch', async () => {
  const publicController = require('../src/controllers/public.controller');
  await withFake(async () => {
    await sp.ensurePage('contact', cms);
    await sp.updatePage('contact', { isEnabled: 'false' }, cms);
    const res = mkRes();
    await publicController.contactPage({ protocol: 'http', get: () => 'x', originalUrl: '/contact' }, res, (e) => { throw e; });
    assert.equal(res.statusCode, 404);
    const post = mkRes();
    await publicController.postContact({ body: { name: 'A', email: 'a@b.co', subject: 'Hello', message: 'Message text here' }, protocol: 'http', get: () => 'x', originalUrl: '/contact', flashSuccess() {}, flashError() {} }, post, (e) => { throw e; });
    assert.equal(post.statusCode, 404, 'a disabled contact page does not accept submissions');
    await sp.updatePage('contact', { isEnabled: 'true', seoTitle: 'Custom contact SEO' }, cms);
    const ok = mkRes();
    await publicController.contactPage({ protocol: 'http', get: () => 'x', originalUrl: '/contact' }, ok, (e) => { throw e; });
    assert.equal(ok.view, 'public/contact');
    assert.equal(ok.data.seo.title, 'Custom contact SEO');
  });
});

// ---------------------------------------------------------------------------
// Sitemap + routes
// ---------------------------------------------------------------------------
async function sitemapLocs() {
  const restore = swap(courseService, 'listPublishedCourseSlugsForSitemap', async () => []);
  try {
    let xml = '';
    await seoController.sitemapXml({ protocol: 'http', get: () => 'localhost' }, { type() { return this; }, send(x) { xml = x; } }, (e) => { throw e; });
    return [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  } finally {
    restore();
  }
}

test('sitemap lists the CMS pages only while they are enabled', async () => {
  await withFake(async () => {
    const all = await sitemapLocs();
    for (const p of ['/about', '/faq', '/reviews', '/contact', '/founder']) assert.ok(all.includes(p), p);
    await sp.ensurePage('faq', cms);
    await sp.updatePage('faq', { isEnabled: 'false' }, cms);
    await sp.ensurePage('reviews', cms);
    await sp.updatePage('reviews', { isEnabled: 'false' }, cms);
    const after = await sitemapLocs();
    assert.ok(!after.includes('/faq'));
    assert.ok(!after.includes('/reviews'));
    assert.ok(after.includes('/about'));
  });
});

test('public and admin routes are wired (no homepage-anchor redirects)', () => {
  const index = fs.readFileSync(path.join(root, 'src/routes/index.routes.js'), 'utf8');
  for (const p of ['/about', '/faq', '/reviews', '/contact', '/founder']) assert.match(index, new RegExp(`router\\.get\\('${p}'`), p);
  assert.doesNotMatch(index, /redirect\(['"]\/#/);
  const admin = fs.readFileSync(path.join(root, 'src/routes/adminPages.routes.js'), 'utf8');
  for (const r of ["'/pages/:slug'", "'/pages/:slug/sections'", "'/pages/:slug/sections/:id/edit'", "'/pages/:slug/sections/:id/delete'", "'/pages/:slug/sections/:id/move'"]) {
    assert.ok(admin.includes(`router.post(${r}, doubleCsrfProtection`), r);
  }
});

// ---------------------------------------------------------------------------
// FAQ categories
// ---------------------------------------------------------------------------
test('FAQ validator: category is optional, trimmed, limited; checkbox pair is boolean-safe', () => {
  const ok = validateFaq({ question: 'A valid question?', answer: 'A valid answer.', category: '  Enrollment ', isActive: ['false', 'true'] });
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.values.category, 'Enrollment');
  assert.equal(ok.values.isActive, true);
  assert.equal(validateFaq({ question: 'A valid question?', answer: 'A valid answer.', category: '   ' }).values.category, null);
  assert.equal(validateFaq({ question: 'A valid question?', answer: 'A valid answer.', isActive: 'false' }).values.isActive, false);
  assert.ok(validateFaq({ question: 'A valid question?', answer: 'A valid answer.', category: 'x'.repeat(101) }).errors.some((e) => /Category/.test(e)));
});

test('FAQ service lists active entries with categories in first-appearance order', async () => {
  const restore = swap(prisma.faq, 'findMany', async (args) => {
    assert.deepEqual(args.where, { isActive: true });
    return [{ id: 1, category: 'B' }, { id: 2, category: ' A ' }, { id: 3, category: 'B' }, { id: 4, category: null }, { id: 5, category: '' }];
  });
  try {
    const out = await faqService.listPublicFaqsWithCategories();
    assert.deepEqual(out.categories, ['B', 'A']);
    assert.equal(out.faqs.length, 5);
  } finally {
    restore();
  }
});

test('admin FAQ screen has a category field and boolean-safe active checkboxes', async () => {
  const html = await render('admin/faqs/list-content.ejs', { csrfToken: 't', errors: [], values: {}, faqs: [{ id: 1, question: 'Q?', answer: 'A', category: 'Cat', sortOrder: 1, isActive: true }] });
  assert.match(html, /name="category"/);
  assert.match(html, /list="faqCategoryList"/);
  assert.match(html, /<option value="Cat">/);
  assert.match(html, /<input type="hidden" name="isActive" value="false">/);
});

test('admin Pages screens render every field and no raw CSS input', async () => {
  const meta = sp.PAGE_META.about;
  const html = await render('admin/pages/edit-content.ejs', { csrfToken: 't', meta, page: page(), sections: [{ id: 1, title: 'S', body: 'B', icon: 'bi-star', isPublished: true }] });
  for (const f of ['isEnabled', 'eyebrow', 'heading', 'intro', 'heroImageUrl', 'ctaHeading', 'ctaText', 'ctaLabel', 'ctaUrl', 'seoTitle', 'metaDescription']) assert.match(html, new RegExp(`name="${f}"`), f);
  assert.match(html, /sections\/1\/edit/);
  assert.match(html, /sections\/1\/move/);
  assert.match(html, /<input type="hidden" name="isEnabled" value="false">/);
  assert.doesNotMatch(html, /name="(css|style|html|script)"/i);
  const faqEdit = await render('admin/pages/edit-content.ejs', { csrfToken: 't', meta: sp.PAGE_META.faq, page: page(), sections: [] });
  assert.doesNotMatch(faqEdit, /Content sections/);
  const list = await render('admin/pages/list-content.ejs', { csrfToken: 't', pages: [{ ...sp.PAGE_META.about, exists: true, isEnabled: false, heading: 'H', sectionCount: 2 }] });
  assert.match(list, /Disabled/);
  assert.match(list, /\/admin\/pages\/about/);
});
