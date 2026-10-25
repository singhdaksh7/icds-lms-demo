process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ejs = require('ejs');

const { prisma } = require('../src/config/db');
const ROOT = path.join(__dirname, '..');
const VIEWS = path.join(ROOT, 'views');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const landingSvc = require('../src/services/courseLanding.service');
const homeSvc = require('../src/services/home.service');
const reviewsSvc = require('../src/services/homeReviews.service');
const bannerSvc = require('../src/services/homeBanner.service');
const founderSvc = require('../src/services/founder.service');
const founderAdmin = require('../src/services/founderAdmin.service');

// ---- (1)(3) course page: learning outcomes exactly once -------------------
test('rendered course page contains the Learning Outcomes section exactly once', () => {
  const tpl = path.join(VIEWS, 'public', 'course-detail-content.ejs');
  const html = ejs.render(fs.readFileSync(tpl, 'utf8'), {
    course: { id: 1, title: 'C', slug: 'c', price: 0, salePrice: null, currency: 'INR', shortDescription: 's', description: 'd', category: null, instructor: null, lessons: [] },
    cms: { course: {}, brand: { defaultCourseImageUrl: '/x.svg', defaultInstructorImageUrl: '/y.svg' } },
    isFree: true, priceLabel: 'Free', isEnrolled: false, hasPendingRequest: false, paymentsEnabled: true,
    currentUser: null, csrfToken: 't', cspNonce: 'n', isPreviewMode: false,
    landing: {
      content: { heroEnabled: true, takeawaysEnabled: true, takeawaysEyebrow: 'UNIQ-EYEBROW' },
      heroChips: [], stats: [], takeaways: [{ id: 1, title: 'Plan occlusion' }, { id: 2, title: 'Design restorations' }],
      questions: [{ id: 1, question: 'Q?' }], whyRegisterWant: [{ id: 1, text: 'w' }], whyRegisterGet: [{ id: 2, text: 'g' }],
      highlights: [], testimonials: [], realReviewCount: 0, realAverageRating: 0, accessPlans: [], comparisonColumns: [],
      audienceFor: [], audienceNotFor: [], accessSteps: [], faqs: [],
      landingSections: ['HERO', 'QUESTIONS', 'WHY_REGISTER', 'FINAL_CTA'],
    },
    stats: { moduleCount: 0, publishedModuleCount: 0, topicCount: 0, publishedTopicCount: 0, lessonCount: 0, publishedLessonCount: 0, videoCount: 0, totalDurationSeconds: 0, totalDurationFormatted: '0m', resourceCount: 0 },
    curriculum: [], resources: [],
  }, { filename: tpl });
  assert.equal((html.match(/id="takeaways"/g) || []).length, 1);
  assert.equal((html.match(/UNIQ-EYEBROW/g) || []).length, 1);
  assert.equal((html.match(/Plan occlusion/g) || []).length, 1);
});

test('buildSectionRenderList never duplicates a block for repeated input keys', () => {
  const list = landingSvc.buildSectionRenderList(['HERO', 'QUESTIONS', 'WHY_REGISTER', 'QUESTIONS', 'REVIEWS', 'FAQ']);
  assert.equal(new Set(list).size, list.length);
  assert.equal(list.filter((k) => k === 'TAKEAWAYS').length, 1);
  assert.equal(list.indexOf('REVIEWS') + 1, list.indexOf('FAQ'));
});

// ---- (2) CSS regression ----------------------------------------------------
test('course-landing.css: breadcrumb margin reset and no gap before hero', () => {
  const css = read('public', 'css', 'course-landing.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = css.match(/\.course-landing-page \.breadcrumb\s*\{([^}]*)\}/);
  assert.ok(rule, 'breadcrumb rule exists');
  assert.match(rule[1], /margin:\s*0\s*;/);
  assert.doesNotMatch(rule[1], /margin-bottom:\s*[1-9]/);
  assert.doesNotMatch(css, /\.breadcrumb[^{]*\{[^}]*margin-bottom:\s*[1-9]/);
  assert.doesNotMatch(css, /\.course-landing-page \.breadcrumb\s*\+\s*[^{]*\{[^}]*margin-top:\s*[1-9]/);
  assert.doesNotMatch(css, /\.course-landing-page \.breadcrumb ~[^{]*\{[^}]*margin-top:\s*[1-9]/);
});

// ---- (5) homepage reviews --------------------------------------------------
const rv = (o) => ({ id: 1, isPublished: true, isDemo: false, quote: 'Great', rating: 5, reviewerName: 'Ann Lee', sortOrder: 0, homeSortOrder: 0, featuredOnHome: true, course: { title: 'C', slug: 'c' }, ...o });

test('selectHomeReviews: unpublished/empty hidden, demo only when includeDemo', () => {
  const rows = [rv({ id: 1 }), rv({ id: 2, isPublished: false }), rv({ id: 3, isDemo: true }), rv({ id: 4, quote: '  ' })];
  const pub = reviewsSvc.selectHomeReviews(rows, { sourceMode: 'ALL_APPROVED' });
  assert.deepEqual(pub.map((r) => r.id), [1]);
  const admin = reviewsSvc.selectHomeReviews(rows, { sourceMode: 'ALL_APPROVED' }, { includeDemo: true });
  assert.deepEqual(admin.map((r) => r.id).sort(), [1, 3]);
  assert.equal(admin.find((r) => r.id === 3).isDemo, true);
  assert.equal(pub[0].initials, 'AL');
});

test('selectHomeReviews: only featured reviews, ordered by homeSortOrder (the old ALL_APPROVED mode is ignored); limit applies', () => {
  const rows = [
    rv({ id: 1, featuredOnHome: true, homeSortOrder: 2, sortOrder: 0 }),
    rv({ id: 2, featuredOnHome: true, homeSortOrder: 1, sortOrder: 5 }),
    rv({ id: 3, featuredOnHome: false, homeSortOrder: 0, sortOrder: 1 }),
  ];
  assert.deepEqual(reviewsSvc.selectHomeReviews(rows, { sourceMode: 'FEATURED' }).map((r) => r.id), [2, 1]);
  assert.deepEqual(reviewsSvc.selectHomeReviews(rows, { sourceMode: 'ALL_APPROVED' }).map((r) => r.id), [2, 1], 'an unfeatured review never shows, whatever the legacy mode says');
  assert.equal(reviewsSvc.selectHomeReviews(rows, {}, { limit: 1 }).length, 1);
  assert.deepEqual(reviewsSvc.selectHomeReviews(null, null), []);
  assert.equal(reviewsSvc.selectHomeReviews([rv({ rating: 99 })], {})[0].rating, 5);
});

test('validateHomeReviewSettings rejects bad options / long text and defaults heading', () => {
  assert.equal(reviewsSvc.validateHomeReviewSettings({ direction: 'NOPE' }).ok, false);
  assert.equal(reviewsSvc.validateHomeReviewSettings({ heading: 'x'.repeat(121) }).ok, false);
  assert.equal(reviewsSvc.validateHomeReviewSettings({ subheading: 'x'.repeat(301) }).ok, false);
  const ok = reviewsSvc.validateHomeReviewSettings({ heading: '', enabled: 'on', sourceMode: 'FEATURED' });
  assert.equal(ok.ok, true);
  assert.equal(ok.values.heading, reviewsSvc.DEFAULTS.heading);
  assert.equal(ok.values.enabled, true);
  assert.equal(reviewsSvc.validateHomeReviewSettings({}).values.enabled, false);
});

test('home-reviews partial: hidden when disabled/empty, DEMO badge only for demo rows', async () => {
  const f = path.join(VIEWS, 'partials', 'home-reviews.ejs');
  const items = reviewsSvc.selectHomeReviews([rv({ id: 1 }), rv({ id: 2, isDemo: true, reviewerName: 'Demo Person' })], {}, { includeDemo: true });
  const off = await ejs.renderFile(f, { homeReviews: items, homeReviewSettings: { enabled: false, heading: 'H' } });
  assert.equal(off.trim(), '');
  const none = await ejs.renderFile(f, { homeReviews: [], homeReviewSettings: { enabled: true, heading: 'H' } });
  assert.equal(none.trim(), '');
  const html = await ejs.renderFile(f, { homeReviews: items, homeReviewSettings: { enabled: true, heading: 'H' } });
  assert.equal((html.match(/DEMO REVIEW/g) || []).length, 1);
  const pubOnly = await ejs.renderFile(f, { homeReviews: reviewsSvc.selectHomeReviews([rv({ id: 2, isDemo: true })], {}), homeReviewSettings: { enabled: true, heading: 'H' } });
  assert.equal(pubOnly.trim(), '');
});

// ---- (6) banners with mocked prisma -----------------------------------------
function mockBannerPrisma(rows) {
  const orig = prisma.homeBanner;
  const origTx = prisma.$transaction;
  const store = rows.map((r) => ({ ...r }));
  const model = {
    findMany: async ({ where, orderBy }) => {
      let out = store.map((b) => ({ ...b }));
      if (where) {
        const now = where.AND[0].OR[1].startAt.lte;
        out = out.filter((b) => b.isActive === where.isActive
          && (b.startAt == null || b.startAt <= now) && (b.endAt == null || b.endAt > now));
      }
      if (orderBy) out.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
      return out;
    },
    update: async ({ where, data }) => { Object.assign(store.find((b) => b.id === where.id), data); },
  };
  prisma.homeBanner = model;
  prisma.$transaction = async (fn) => fn({ homeBanner: model });
  return { store, restore() { prisma.homeBanner = orig; prisma.$transaction = origTx; } };
}

test('getActiveBanners: hides inactive and out-of-window, orders by sortOrder', async () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const d = (s) => new Date(s);
  const m = mockBannerPrisma([
    { id: 1, isActive: true, sortOrder: 2, startAt: null, endAt: null },
    { id: 2, isActive: false, sortOrder: 0, startAt: null, endAt: null },
    { id: 3, isActive: true, sortOrder: 1, startAt: d('2026-06-01'), endAt: d('2026-07-01') },
    { id: 4, isActive: true, sortOrder: 0, startAt: d('2026-07-01'), endAt: null },
    { id: 5, isActive: true, sortOrder: 0, startAt: null, endAt: d('2026-06-10') },
    { id: 6, isActive: true, sortOrder: 0, startAt: null, endAt: now },
  ]);
  try {
    const out = await bannerSvc.getActiveBanners(now);
    assert.deepEqual(out.map((b) => b.id), [3, 1]);
  } finally { m.restore(); }
});

test('moveBanner swaps neighbours, normalises ties, no-ops at edges, rejects bad input', async () => {
  const m = mockBannerPrisma([
    { id: 10, sortOrder: 0 }, { id: 11, sortOrder: 0 }, { id: 12, sortOrder: 5 },
  ]);
  try {
    assert.deepEqual(await bannerSvc.moveBanner(11, 'up'), [11, 10, 12]);
    assert.deepEqual(m.store.map((b) => [b.id, b.sortOrder]).sort((a, b) => a[0] - b[0]), [[10, 1], [11, 0], [12, 2]]);
    assert.deepEqual(await bannerSvc.moveBanner(11, 'up'), [11, 10, 12]);
    assert.deepEqual(await bannerSvc.moveBanner(12, 'down'), [11, 10, 12]);
    assert.deepEqual(await bannerSvc.moveBanner(11, 'down'), [10, 11, 12]);
    await assert.rejects(() => bannerSvc.moveBanner(11, 'sideways'));
    await assert.rejects(() => bannerSvc.moveBanner(999, 'up'), (e) => e.status === 404);
  } finally { m.restore(); }
});

test('isSafeUrl / safeCtaUrl block script and protocol-relative URLs', () => {
  for (const bad of ['javascript:alert(1)', 'JavaScript:x', '//evil.com', '/\\evil.com', 'data:text/html,x', '', '  ', null, 5]) {
    assert.equal(bannerSvc.isSafeUrl(bad), false, String(bad));
    assert.equal(homeSvc.safeCtaUrl(bad), '', String(bad));
  }
  for (const good of ['/courses', 'https://example.com/a', 'http://example.com']) {
    assert.equal(bannerSvc.isSafeUrl(good), true, good);
    assert.equal(homeSvc.safeCtaUrl(good), good);
  }
});

test('validateBannerInput: label required with link, dates, defaults', () => {
  const r = bannerSvc.validateBannerInput({ imageUrl: '/a.jpg', ctaUrl: '/courses' });
  assert.ok(r.errors.some((e) => /label/i.test(e)));
  const ok = bannerSvc.validateBannerInput({ imageUrl: '/a.jpg' });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.values.isActive, true);
  assert.equal(ok.values.overlayEnabled, false);
  assert.ok(bannerSvc.validateBannerInput({ imageUrl: '/a.jpg', startAt: 'garbage' }).errors.length);
  assert.ok(bannerSvc.validateBannerInput({ imageUrl: '/a.jpg', mobileImageUrl: 'javascript:x' }).errors.length);
});

test('getHomeBanners: failure hides carousel, javascript: CTAs stripped, imageless rows dropped', async () => {
  const orig = prisma.homeBanner;
  prisma.homeBanner = { findMany: async () => [
    { id: 1, imageUrl: '/a.jpg', ctaUrl: 'javascript:x', secondaryCtaUrl: '/ok' },
    { id: 2, imageUrl: '', ctaUrl: '/x' },
  ] };
  try {
    const out = await homeSvc.getHomeBanners(new Date());
    assert.equal(out.length, 1);
    assert.equal(out[0].ctaUrl, '');
    assert.equal(out[0].secondaryCtaUrl, '/ok');
    prisma.homeBanner = { findMany: async () => { throw new Error('db down'); } };
    assert.deepEqual(await homeSvc.getHomeBanners(new Date()), []);
  } finally { prisma.homeBanner = orig; }
});

test('banner-carousel partial renders 0 / 1 / many and drops javascript: URLs', async () => {
  const f = path.join(VIEWS, 'partials', 'banner-carousel.ejs');
  assert.equal((await ejs.renderFile(f, { banners: [] })).trim(), '');
  assert.equal((await ejs.renderFile(f, {})).trim(), '');
  const one = await ejs.renderFile(f, { banners: [{ imageUrl: '/a.jpg', title: 'One' }] });
  assert.equal((one.match(/data-banner-slide/g) || []).length, 1);
  assert.doesNotMatch(one, /data-banner-prev|data-banner-dot=/);
  assert.match(one, /data-autoplay="0"/);
  const many = await ejs.renderFile(f, { banners: [
    { imageUrl: '/a.jpg', title: 'A', ctaLabel: 'Go', ctaUrl: 'javascript:alert(1)', secondaryCtaLabel: 'Two', secondaryCtaUrl: '//evil.com' },
    { imageUrl: '/b.jpg', title: 'B', ctaLabel: 'Ok', ctaUrl: '/courses' },
    { imageUrl: '/c.jpg', title: '<img onerror=x>' },
  ] });
  assert.equal((many.match(/data-banner-slide/g) || []).length, 3);
  assert.equal((many.match(/data-banner-dot="/g) || []).length, 3);
  assert.match(many, /data-banner-prev/);
  assert.match(many, /data-autoplay="5000"/);
  assert.doesNotMatch(many, /javascript:|evil\.com/);
  assert.match(many, /href="\/courses"/);
  assert.doesNotMatch(many, /<img onerror/);
});

// ---- (7) founder -------------------------------------------------------------
test('founder view model: respects hidden/order and drops incomplete rows', () => {
  const raw = {
    instructor: { name: 'Dr. T', bio: 'bio' },
    qualifications: [{ title: 'BDS' }, { title: ' ' }],
    timeline: [{ yearLabel: '2014', title: '' }],
    faqs: [{ question: 'q', answer: '' }],
    stats: [{ valueText: '5', label: '' }],
    initiatives: [{ title: 'I', description: '' }],
    research: [{ kind: 'TEACHING', title: 'T' }],
    settings: { 'founder.sections.order': '["RESEARCH","HERO"]', 'founder.sections.hidden': '["CTA"]' },
  };
  const vm = founderSvc.buildFounderViewModel(raw);
  assert.deepEqual(vm.sections, ['RESEARCH', 'HERO', 'BIOGRAPHY', 'QUALIFICATIONS']);
  assert.equal(vm.qualifications.length, 1);
  assert.equal(vm.timeline.length + vm.faqs.length + vm.stats.length + vm.initiatives.length, 0);
  assert.equal(vm.researchGroups[0].label, 'Clinical Teaching');
  const vm2 = founderSvc.buildFounderViewModel({ instructor: { name: 'A' }, initiatives: [{ title: 'I', description: 'd', ctaLabel: 'Go', ctaUrl: '//evil' }] });
  assert.equal(vm2.initiatives[0].ctaHref, null);
});

test('getFounderPageData queries every list ordered by sortOrder, published only', async () => {
  const calls = {};
  const origs = {};
  const rec = (name, rows) => { origs[name] = prisma[name]; prisma[name] = { findMany: async (a) => { calls[name] = a; return rows || []; } }; };
  const origInstr = prisma.instructor;
  prisma.instructor = { findFirst: async () => ({ id: 7, name: 'Dr. T', status: 'ACTIVE' }) };
  const models = ['founderQualification', 'founderTimelineEntry', 'founderInitiative', 'founderResearchItem', 'founderStat', 'founderFaq'];
  models.forEach((n) => rec(n));
  rec('siteSetting', [{ key: 'founder.sections.hidden', value: '["FAQ"]' }]);
  try {
    const data = await founderSvc.getFounderPageData();
    assert.ok(!data.sections.includes('FAQ'));
    for (const n of models) {
      assert.equal(calls[n].where.isPublished, true, n);
      assert.deepEqual(calls[n].orderBy[0], { sortOrder: 'asc' }, n);
    }
    assert.equal(calls.founderTimelineEntry.where.instructorId, 7);
    await founderSvc.getFounderPageData({ includeUnpublished: true });
    assert.equal(calls.founderFaq.where.isPublished, undefined);
  } finally {
    Object.keys(origs).forEach((n) => { prisma[n] = origs[n]; });
    prisma.instructor = origInstr;
  }
});

test('founder validators reject bad input and accept good', () => {
  assert.ok(founderAdmin.validateQualificationInput({ title: 'x'.repeat(301) }).errors.length);
  assert.deepEqual(founderAdmin.validateQualificationInput({ title: 'BDS' }).errors, []);
  assert.ok(founderAdmin.validateInitiativeInput({ title: 't', description: 'd', ctaUrl: '/courses' }).errors.length);
  assert.deepEqual(founderAdmin.validateInitiativeInput({ title: 't', description: 'd', ctaUrl: '/courses', ctaLabel: 'Go' }).errors, []);
  assert.ok(founderAdmin.validateInitiativeInput({ title: 't', description: 'd', iconKey: 'Bad Key!' }).errors.length);
  assert.ok(founderAdmin.validateFounderProfileInput({ instructorId: 'abc' }).errors.length);
  assert.deepEqual(founderAdmin.validateFounderProfileInput({ instructorId: '3', isFounder: 'on' }).errors, []);
  assert.deepEqual(founderAdmin.validateResearchInput({ title: 't', kind: 'TEACHING' }).errors, []);
  assert.ok(founderAdmin.validateStatInput({ label: 'only label' }).errors.length);
  assert.ok(founderAdmin.validateTimelineInput({ title: 'only title' }).errors.length);
});

const BANNED = /award[- ]winning|world[- ]renowned|internationally acclaimed|leading dentist|best prosthodontist|patent|\bKOL\b/i;

test('seed script: owner-supplied facts only, no banned claims, safe guards', () => {
  const seed = read('scripts', 'seed-founder-page.js');
  assert.doesNotMatch(seed, BANNED);
  assert.match(seed, /50\+/);
  assert.match(seed, /10\+/);
  assert.match(seed, /2014/);
  assert.match(seed, /BDS/);
  assert.match(seed, /Ghaziabad/);
  assert.match(seed, /Subharti Dental College/);
  assert.match(seed, /NODE_ENV === 'production'/);
  assert.match(seed, /--confirm/);
  const nums = [...seed.matchAll(/(\d[\d,]*\+?)\s*(doctors|years|dentists|students|patients|cases)/gi)].map((m) => m[0].toLowerCase());
  for (const n of nums) assert.match(n, /^(50\+? doctors|10\+? years|2 years)/, n);
});

test('founder-content with seed-shaped data renders without banned claims', async () => {
  const vm = founderSvc.buildFounderViewModel({
    instructor: { name: 'Dr. Tanu Raghav', bio: 'Prosthodontist.\n\nTrained more than 50 doctors.' },
    qualifications: [{ title: 'BDS', subtitle: 'Ghaziabad, 2014' }],
    stats: [{ valueText: '50+', label: 'Doctors Trained' }],
  });
  const html = await ejs.renderFile(path.join(VIEWS, 'public', 'founder-content.ejs'), { vm });
  assert.doesNotMatch(html, BANNED);
  assert.match(html, /50\+/);
  assert.doesNotMatch(html, /fp-faq-q/);
  assert.doesNotMatch(read('views', 'public', 'founder-content.ejs'), BANNED);
});

// ---- (8) course card ---------------------------------------------------------
const card = (course) => ejs.renderFile(path.join(VIEWS, 'partials', 'course-card.ejs'),
  { course, fill: (s) => s, cms: require('../src/services/settings.service').defaultContent() }, { views: [VIEWS] });
const baseCourse = { id: 1, slug: 'c', title: 'T', shortDescription: 'd', level: 'BEGINNER', currency: 'INR', thumbnailUrl: null, duration: null, category: null, instructor: null, reviews: [], _count: { lessons: 3 }, salePrice: null, price: 0 };

test('course card: real lesson count, Free label, no rating markup without reviews', async () => {
  const html = await card(baseCourse);
  assert.match(html, /3 Lessons/);
  assert.match(html, /course-price">\s*Free/);
  assert.doesNotMatch(html, /course-rating|course-stars|★|☆/);
  assert.match(await card({ ...baseCourse, _count: { lessons: 1 } }), /1 Lesson\s*</);
  assert.doesNotMatch(await card({ ...baseCourse, _count: { lessons: 0 } }), /course-meta|Lesson/);
  assert.doesNotMatch(await card({ ...baseCourse, _count: undefined }), /NaN|undefined/);
});

test('course card: rating shown only from real review rows', async () => {
  const html = await card({ ...baseCourse, reviews: [{ rating: 5 }, { rating: 4 }] });
  assert.match(html, /course-rating/);
  assert.match(html, /4\.5/);
  assert.match(html, /2 reviews/);
});

// ---- (9) static invariants ---------------------------------------------------
test('core module public APIs are still exported', () => {
  const rz = require('../src/services/razorpay.service');
  for (const k of ['isConfigured', 'createProviderOrder', 'verifyCheckoutSignature', 'verifyWebhookSignature']) assert.equal(typeof rz[k], 'function', k);
  const en = require('../src/services/enrollment.service');
  for (const k of ['isUserEnrolled', 'enrollFree', 'enrollStudentManually', 'cancelEnrollment']) assert.equal(typeof en[k], 'function', k);
  const pr = require('../src/services/progress.service');
  for (const k of ['computeCreditedDelta', 'isLessonComplete', 'clampWatchedDelta']) assert.equal(typeof pr[k], 'function', k);
  assert.equal(typeof pr.COMPLETION_THRESHOLD, 'number');
  const r2 = require('../src/lib/r2');
  for (const k of ['signedGetUrl', 'uploadStream', 'deleteObject', 'buildObjectKey', 'isOwnedObjectKey']) assert.equal(typeof r2[k], 'function', k);
});
