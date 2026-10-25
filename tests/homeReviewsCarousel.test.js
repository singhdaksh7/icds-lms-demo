process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

// Homepage reviews: featured-only selection + ordering, demo isolation, extended section
// settings (validation, patch-style saves), admin controls and the carousel markup / script.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const { prisma } = require('../src/config/db');
const reviews = require('../src/services/homeReviews.service');
const reviewsAdmin = require('../src/services/homeReviewsAdmin.service');
const r2 = require('../src/lib/r2');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').split('\r\n').join('\n');

function swap(obj, key, impl) {
  const orig = obj[key];
  obj[key] = impl;
  return () => { obj[key] = orig; };
}

const KEY = (cid, tid) => `courses/${cid}/testimonials/${tid}/0f8fad5b-d9cb-469f-a165-70867728950e.mp4`;
const rv = (id, o = {}) => ({
  id, courseId: 5, reviewType: 'TEXT', reviewerName: `Reviewer ${id}`, quote: `quote ${id}`, rating: 5,
  isPublished: true, isDemo: false, featuredOnHome: true, homeSortOrder: id, sortOrder: id,
  course: { title: 'Course', slug: 'course', status: 'PUBLISHED' }, ...o,
});
const ids = (rows, opts) => reviews.selectHomeReviews(rows, {}, opts).map((r) => r.id);

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------
test('homepage shows only FEATURED genuine reviews; an unfeatured review never appears', () => {
  const rows = [rv(1), rv(2, { featuredOnHome: false }), rv(3), rv(4, { featuredOnHome: false })];
  assert.deepEqual(ids(rows), [1, 3]);
  assert.deepEqual(reviews.selectHomeReviews(rows, { sourceMode: 'ALL_APPROVED' }).map((r) => r.id), [1, 3], 'legacy mode setting cannot widen the selection');
  assert.deepEqual(ids([rv(1, { featuredOnHome: false })]), []);
});

test('homepage order follows homeSortOrder (then course order, then id)', () => {
  const rows = [rv(1, { homeSortOrder: 3 }), rv(2, { homeSortOrder: 1 }), rv(3, { homeSortOrder: 2 }), rv(4, { homeSortOrder: 1, sortOrder: 0 })];
  assert.deepEqual(ids(rows), [4, 2, 3, 1]);
  // Reordering = editing homeSortOrder only; course order (sortOrder) is irrelevant between different homepage positions.
  const reordered = rows.map((r) => (r.id === 1 ? { ...r, homeSortOrder: 0 } : r));
  assert.deepEqual(ids(reordered), [1, 4, 2, 3]);
});

test('unpublished reviews and reviews with nothing to show are excluded; demo only in preview/showcase', () => {
  const rows = [rv(1), rv(2, { isPublished: false }), rv(3, { isDemo: true }), rv(4, { quote: '   ' }), rv(5, { reviewType: 'VIDEO', quote: '', videoObjectKey: null })];
  assert.deepEqual(ids(rows), [1]);
  assert.deepEqual(ids(rows, { includeDemo: true }).sort(), [1, 3]);
});

test('text, video (hosted + link) and text+video reviews are all supported', () => {
  const rows = [
    rv(1),
    rv(2, { reviewType: 'VIDEO', quote: '', videoObjectKey: KEY(5, 2) }),
    rv(3, { reviewType: 'TEXT_VIDEO', videoUrl: 'https://youtu.be/abcdefghijk' }),
    rv(4, { reviewType: 'TEXT_VIDEO', videoObjectKey: null, videoUrl: null }),
  ];
  const out = reviews.selectHomeReviews(rows, {});
  assert.deepEqual(out.map((r) => r.id), [1, 2, 3, 4]);
  assert.equal(out[0].hasVideo, false);
  assert.equal(out[1].hasVideo, true);
  assert.equal(out[1].videoKind, 'hosted');
  assert.equal(out[2].videoKind, 'embed');
  assert.equal(out[2].embedUrl, 'https://www.youtube.com/embed/abcdefghijk');
  assert.equal(out[3].hasVideo, false, 'an unplayable text+video falls back to its quote');
  assert.ok(!JSON.stringify(out).includes('courses/5/testimonials'), 'object key never reaches a template');
});

test('a demo VIDEO review is never public, even in demo-showcase mode', () => {
  const rows = [rv(1, { isDemo: true, reviewType: 'VIDEO', quote: '', videoObjectKey: KEY(5, 1) }), rv(2, { isDemo: true })];
  assert.deepEqual(ids(rows, { includeDemo: true }), [2]);
});

test('rating is the saved rating, clamped; the card limit applies', () => {
  assert.equal(reviews.selectHomeReviews([rv(1, { rating: 4 })], {})[0].rating, 4);
  assert.equal(reviews.selectHomeReviews([rv(1, { rating: 99 })], {})[0].rating, 5);
  assert.equal(reviews.selectHomeReviews([rv(1, { rating: 0 })], {})[0].rating, 0);
  const many = Array.from({ length: 20 }, (_, i) => rv(i + 1));
  assert.equal(ids(many).length, 12);
  assert.equal(ids(many, { limit: 3 }).length, 3);
});

test('getHomeReviews queries featured + published reviews of PUBLISHED courses only', async () => {
  let where = null;
  const restores = [
    swap(prisma.siteSetting, 'findMany', async () => []),
    swap(prisma.courseTestimonial, 'findMany', async (args) => {
      where = args.where;
      return [rv(1), rv(2, { course: { title: 'Draft', slug: 'draft', status: 'DRAFT' } })];
    }),
  ];
  try {
    const out = await reviews.getHomeReviews({});
    assert.equal(where.featuredOnHome, true);
    assert.equal(where.isPublished, true);
    assert.equal(where.isDemo, false);
    assert.deepEqual(out.map((r) => r.id), [1], 'reviews of unpublished courses are dropped');
    await reviews.getHomeReviews({ includeDemo: true });
    assert.equal(where.isDemo, undefined);
    assert.equal(where.featuredOnHome, true, 'preview still requires featuring');
  } finally {
    restores.reverse().forEach((r) => r());
  }
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function installSettingsDb(seed = {}) {
  const store = new Map(Object.entries(seed));
  const writes = [];
  const restores = [
    swap(prisma.siteSetting, 'findMany', async ({ where }) => where.key.in.filter((k) => store.has(k)).map((key) => ({ key, value: store.get(key) }))),
    swap(prisma.siteSetting, 'upsert', async ({ where, update }) => { store.set(where.key, update.value); writes.push(where.key); return {}; }),
    swap(prisma, '$transaction', async (ops) => Promise.all(ops)),
  ];
  return { store, writes, restore: () => restores.reverse().forEach((r) => r()) };
}

test('defaults: enabled slow carousel, 3/2/1 cards, arrows + dots, left to right, cream', async () => {
  const db = installSettingsDb();
  try {
    const s = await reviews.getHomeReviewSettings();
    assert.deepEqual(s, {
      enabled: true, eyebrow: 'Learner stories', heading: 'What our learners say', subheading: '', carouselEnabled: true, carouselRotate: true,
      autoplayInterval: 6000, direction: 'LEFT_TO_RIGHT', cardsDesktop: 3, cardsTablet: 2, showArrows: true, showDots: true, backgroundStyle: 'CREAM',
    });
  } finally { db.restore(); }
});

test('settings validation: interval range, 2-3 desktop cards, 1-2 tablet cards, direction + background allowlists, text lengths', () => {
  const v = (o) => reviews.validateHomeReviewSettings(o);
  assert.equal(v({ autoplayInterval: '1000' }).ok, false);
  assert.equal(v({ autoplayInterval: '20000' }).ok, false);
  assert.equal(v({ autoplayInterval: 'abc' }).ok, false);
  assert.equal(v({ autoplayInterval: '2000' }).ok, true);
  assert.equal(v({ autoplayInterval: '15000' }).ok, true);
  assert.equal(v({ cardsDesktop: '4' }).ok, false);
  assert.equal(v({ cardsDesktop: '1' }).ok, false);
  assert.equal(v({ cardsDesktop: '2' }).ok, true);
  assert.equal(v({ cardsTablet: '3' }).ok, false);
  assert.equal(v({ cardsTablet: '1' }).ok, true);
  assert.equal(v({ direction: 'UP' }).ok, false);
  assert.equal(v({ direction: 'RIGHT_TO_LEFT' }).ok, true);
  assert.equal(v({ backgroundStyle: 'url(x)' }).ok, false);
  assert.equal(v({ eyebrow: 'x'.repeat(81) }).ok, false);
  assert.equal(v({ heading: 'x'.repeat(121) }).ok, false);
  assert.equal(v({ subheading: 'x'.repeat(301) }).ok, false);
  assert.equal(v({ heading: '', enabled: 'on' }).values.heading, reviews.DEFAULTS.heading);
});

test('saving settings is patch-style: only submitted fields are written; booleans: checked true / unchecked false / absent untouched', async () => {
  const db = installSettingsDb({ 'homeReviews.heading': 'Keep', 'homeReviews.showDots': 'true', 'homeReviews.enabled': 'true', 'home.sections.order': '["HERO"]' });
  try {
    await reviews.saveHomeReviewSettings({ eyebrow: 'New eyebrow' });
    assert.deepEqual(db.writes, ['homeReviews.eyebrow']);
    assert.equal(db.store.get('homeReviews.heading'), 'Keep');
    assert.equal(db.store.get('homeReviews.showDots'), 'true', 'an absent checkbox is not flipped');
    assert.equal(db.store.get('homeReviews.enabled'), 'true');

    db.writes.length = 0;
    await reviews.saveHomeReviewSettings({ showDots: ['false'], showArrows: ['false', 'true'], carouselRotate: 'false', autoplayInterval: '8000', direction: 'RIGHT_TO_LEFT', cardsDesktop: '2', cardsTablet: '1', backgroundStyle: 'DARK' });
    assert.equal(db.store.get('homeReviews.showDots'), 'false');
    assert.equal(db.store.get('homeReviews.showArrows'), 'true');
    assert.equal(db.store.get('homeReviews.autoplay'), 'false');
    assert.equal(db.store.get('homeReviews.autoplayInterval'), '8000');
    assert.equal(db.store.get('homeReviews.direction'), 'RIGHT_TO_LEFT');
    assert.equal(db.store.get('homeReviews.backgroundStyle'), 'DARK');
    assert.ok(!db.writes.includes('homeReviews.heading') && !db.writes.includes('homeReviews.enabled'));
    assert.equal(db.store.get('home.sections.order'), '["HERO"]', 'other homepage settings are never touched');

    const loaded = await reviews.getHomeReviewSettings();
    assert.equal(loaded.showDots, false);
    assert.equal(loaded.carouselRotate, false);
    assert.equal(loaded.cardsDesktop, 2);
    assert.equal(loaded.direction, 'RIGHT_TO_LEFT');
    assert.equal(loaded.heading, 'Keep');

    await assert.rejects(() => reviews.saveHomeReviewSettings({ cardsDesktop: '9' }), (e) => Boolean(e.validation));
    assert.equal(db.store.get('homeReviews.cardsDesktop'), '2', 'a rejected save writes nothing');
  } finally { db.restore(); }
});

test('clearing the eyebrow hides it (no hardcoded copy comes back); a never-saved eyebrow uses the default', async () => {
  const db = installSettingsDb();
  try {
    assert.equal((await reviews.getHomeReviewSettings()).eyebrow, 'Learner stories');
    await reviews.saveHomeReviewSettings({ eyebrow: '' });
    assert.equal((await reviews.getHomeReviewSettings()).eyebrow, '');
  } finally { db.restore(); }
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
test('admin: set an explicit homepage order only on featured genuine reviews, validated', async () => {
  const rows = new Map([[1, { id: 1, featuredOnHome: true, homeSortOrder: 4 }], [2, { id: 2, featuredOnHome: false, homeSortOrder: 0 }]]);
  const restores = [
    swap(prisma.courseTestimonial, 'findUnique', async ({ where }) => rows.get(where.id) || null),
    swap(prisma.courseTestimonial, 'update', async ({ where, data }) => { Object.assign(rows.get(where.id), data); return rows.get(where.id); }),
  ];
  try {
    await reviewsAdmin.setHomeOrder(1, '2');
    assert.equal(rows.get(1).homeSortOrder, 2);
    await assert.rejects(() => reviewsAdmin.setHomeOrder(1, '-1'), /between 0 and 9999/);
    await assert.rejects(() => reviewsAdmin.setHomeOrder(1, 'abc'), /between 0 and 9999/);
    await assert.rejects(() => reviewsAdmin.setHomeOrder(2, '1'), /Feature the review/);
    await assert.rejects(() => reviewsAdmin.setHomeOrder(99, '1'), /not found/i);
  } finally { restores.reverse().forEach((r) => r()); }
});

test('admin settings controller passes only the submitted fields', async () => {
  const controller = require('../src/controllers/admin/homeReviews.controller');
  const db = installSettingsDb();
  try {
    const flash = [];
    const req = { body: { showArrows: ['false', 'true'], _csrf: 'x', bogus: 'y' }, flashSuccess: (m) => flash.push(m), flashError: (m) => flash.push(m) };
    let redirected;
    await controller.saveSettings(req, { redirect: (u) => { redirected = u; } }, (e) => { throw e; });
    assert.equal(redirected, '/admin/homepage/reviews');
    assert.deepEqual(db.writes, ['homeReviews.showArrows']);
    assert.match(flash[0], /saved/);
  } finally { db.restore(); }
});

test('admin reviews page: carousel controls, featuring + explicit order; no "which reviews" mode', async () => {
  const base = { csrfToken: 't', currentUser: { name: 'A' }, site: {}, flash: {}, metaDescription: '' };
  const html = await ejs.renderFile(path.join(root, 'views/admin/homepage/reviews.ejs'), {
    ...base, pageTitle: 'x', settings: { ...reviews.DEFAULTS, enabled: true },
    genuine: [
      { id: 1, reviewerName: 'Featured One', rating: 4, quote: 'q', featuredOnHome: true, homeSortOrder: 2, reviewType: 'VIDEO', course: { title: 'C' } },
      { id: 2, reviewerName: 'Plain Two', rating: 5, quote: 'q2', featuredOnHome: false, homeSortOrder: 0, course: { title: 'C' } },
    ],
    demo: [{ id: 3, reviewerName: 'D', course: { title: 'C' } }],
  });
  for (const n of ['enabled', 'eyebrow', 'heading', 'subheading', 'carouselEnabled', 'carouselRotate', 'autoplayInterval', 'direction', 'cardsDesktop', 'cardsTablet', 'showArrows', 'showDots', 'backgroundStyle']) {
    assert.match(html, new RegExp(`name="${n}"`), n);
  }
  assert.doesNotMatch(html, /name="sourceMode"/);
  assert.match(html, /<input type="hidden" name="showDots" value="false">/);
  assert.match(html, /LEFT_TO_RIGHT/);
  assert.match(html, /RIGHT_TO_LEFT/);
  assert.match(html, /homepage\/reviews\/1\/order/);
  assert.match(html, /homepage\/reviews\/1\/move/);
  assert.match(html, /homepage\/reviews\/2\/feature/);
  assert.match(html, /Remove from homepage/);
  assert.match(html, /Show on homepage/);
  assert.match(html, /DEMO REVIEW/);
});

// ---------------------------------------------------------------------------
// Carousel markup + script
// ---------------------------------------------------------------------------
const render = (homeReviews, homeReviewSettings) => ejs.renderFile(path.join(root, 'views/partials/home-reviews.ejs'), { homeReviews, homeReviewSettings });
const cards = (n, o = {}) => reviews.selectHomeReviews(Array.from({ length: n }, (_, i) => rv(i + 1, o)), {});
const cfg = (o = {}) => ({ ...reviews.DEFAULTS, ...o });

test('carousel markup: region/roundedescription, labelled controls, slides, dots, settings as data attributes', async () => {
  const html = await render(cards(5), cfg({ autoplayInterval: 7000, direction: 'RIGHT_TO_LEFT', cardsDesktop: 2, cardsTablet: 1 }));
  assert.match(html, /data-hr-carousel/);
  assert.match(html, /role="region" aria-roledescription="carousel"/);
  assert.match(html, /data-rotate="1"/);
  assert.match(html, /data-interval="7000"/);
  assert.match(html, /data-direction="rtl"/);
  assert.match(html, /--hr-cols-desktop: 2; --hr-cols-tablet: 1;/);
  assert.match(html, /aria-label="Previous reviews"/);
  assert.match(html, /aria-label="Next reviews"/);
  assert.match(html, /data-hr-dots/);
  assert.match(html, /tabindex="0"/);
  assert.equal((html.match(/aria-roledescription="slide"/g) || []).length, 5);
  assert.match(html, /aria-label="Review 3 of 5"/);
  assert.match(html, /home-reviews-carousel\.css/);
  assert.match(html, /home-reviews-carousel\.js/);
  assert.match(html, /Learner stories/);
});

test('carousel options: arrows / dots off, autoplay off, direction left to right, background', async () => {
  const html = await render(cards(4), cfg({ showArrows: false, showDots: false, carouselRotate: false, direction: 'LEFT_TO_RIGHT', backgroundStyle: 'DARK' }));
  assert.doesNotMatch(html, /data-hr-prev|data-hr-next|class="hr-arrow/);
  assert.doesNotMatch(html, /data-hr-dots/);
  assert.match(html, /data-rotate="0"/);
  assert.match(html, /data-direction="ltr"/);
  assert.match(html, /home-reviews--bg-dark/);
});

test('carousel disabled, or a single review, renders the static grid (no slider script)', async () => {
  const off = await render(cards(4), cfg({ carouselEnabled: false }));
  assert.match(off, /home-reviews-grid/);
  assert.doesNotMatch(off, /data-hr-carousel|home-reviews-carousel\.js/);
  const one = await render(cards(1), cfg());
  assert.match(one, /home-reviews-grid/);
  assert.doesNotMatch(one, /data-hr-carousel/);
});

test('section hidden when disabled or when no review is featured; eyebrow hidden when blank', async () => {
  assert.equal((await render(cards(3), cfg({ enabled: false }))).trim(), '');
  assert.equal((await render([], cfg())).trim(), '');
  assert.equal((await render(undefined, cfg())).trim(), '');
  const html = await render(cards(3), cfg({ eyebrow: '' }));
  assert.doesNotMatch(html, /section-tag/);
});

test('star ratings use the saved rating with an accessible label; no fabricated stars for rating 0', async () => {
  const html = await ejs.renderFile(path.join(root, 'views/partials/home-reviews.ejs'), {
    homeReviews: reviews.selectHomeReviews([rv(1, { rating: 4 }), rv(2, { rating: 5 }), rv(3, { rating: 0 })], {}),
    homeReviewSettings: cfg(),
  });
  assert.match(html, /role="img" aria-label="Rated 4 out of 5"/);
  assert.match(html, /role="img" aria-label="Rated 5 out of 5"/);
  assert.equal((html.match(/class="home-review-stars"/g) || []).length, 2);
  const four = html.split('aria-label="Rated 4 out of 5"')[1].split('</div>')[0];
  assert.equal((four.match(/bi-star-fill/g) || []).length, 4);
  assert.equal((four.match(/bi-star"/g) || []).length, 1);
});

test('video review cards: poster, play icon, name, rating, quote; open the existing player; never autoplay', async () => {
  const items = reviews.selectHomeReviews([
    rv(1, { reviewType: 'VIDEO', quote: '', videoObjectKey: KEY(5, 1), videoThumbnailUrl: '/uploads/thumbnails/t.jpg', rating: 5 }),
    rv(2, { reviewType: 'TEXT_VIDEO', quote: 'Great course', videoUrl: 'https://youtu.be/abcdefghijk', rating: 4 }),
  ], {});
  const html = await render(items, cfg());
  assert.match(html, /class="home-review-video" data-testimonial-video data-kind="hosted" data-id="1"/);
  assert.match(html, /data-kind="embed" data-id="2" data-embed="https:\/\/www\.youtube\.com\/embed\/abcdefghijk"/);
  assert.match(html, /aria-label="Play video review from Reviewer 1"/);
  assert.match(html, /src="\/uploads\/thumbnails\/t\.jpg"/);
  assert.match(html, /home-review-play/);
  assert.match(html, /Great course/);
  assert.match(html, /<script src="\/js\/testimonial-player\.js" defer><\/script>/);
  assert.doesNotMatch(html, /<video|autoplay/i);
  assert.ok(!html.includes('courses/5/testimonials') && !html.includes(KEY(5, 1)));
  const textOnly = await render(cards(3), cfg());
  assert.doesNotMatch(textOnly, /testimonial-player\.js/);
});

test('card content is escaped and DEMO badge shows only for demo rows (preview)', async () => {
  const items = reviews.selectHomeReviews([rv(1, { quote: '<img src=x onerror=alert(1)>', reviewerName: '<b>Bad</b>' }), rv(2, { isDemo: true })], {}, { includeDemo: true });
  const html = await render(items, cfg());
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<b>Bad</b>'));
  assert.equal((html.match(/DEMO REVIEW/g) || []).length, 1);
});

test('carousel script: accessible, calm, reduced-motion aware, endless, drag + keyboard + pause', () => {
  const js = read('public/js/home-reviews-carousel.js');
  assert.match(js, /prefers-reduced-motion/);
  assert.match(js, /ArrowLeft/);
  assert.match(js, /ArrowRight/);
  assert.match(js, /mouseenter/);
  assert.match(js, /focusin/);
  assert.match(js, /pointerdown/);
  assert.match(js, /pointerup/);
  assert.match(js, /visibilitychange|document\.hidden/);
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /setAttribute\('inert'/);
  assert.match(js, /aria-current/);
  assert.match(js, /insertBefore\(track\.lastElementChild/, 'endless: slides are rotated, never rewound');
  assert.doesNotMatch(js, /\.play\(|<video/, 'the carousel never plays video');
  const interval = js.match(/Math\.min\((\d+), Math\.max\((\d+), parseInt/);
  assert.deepEqual([interval[1], interval[2]], ['15000', '2000']);
  assert.match(js, /duration = 900/, 'slow premium motion');
});

test('carousel css: 3 / 2 / 1 cards, no horizontal overflow, reduced motion, focus styles', () => {
  const css = read('public/css/home-reviews-carousel.css');
  assert.match(css, /--hr-cols: var\(--hr-cols-desktop, 3\)/);
  assert.match(css, /--hr-cols: var\(--hr-cols-tablet, 2\)/);
  assert.match(css, /max-width: 575\.98px\)[\s\S]*--hr-cols: 1/);
  assert.match(css, /\.hr-viewport \{[^}]*overflow: hidden/);
  assert.match(css, /touch-action: pan-y/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
});

test('source-of-truth: every value the reviews partial reads comes from the settings service / review shape', () => {
  const partial = read('views/partials/home-reviews.ejs');
  const usedCfg = new Set([...partial.matchAll(/\bhrCfg\.(\w+)/g)].map((m) => m[1]));
  for (const k of usedCfg) assert.ok(k in reviews.DEFAULTS, `hrCfg.${k} is a real setting`);
  const adminView = read('views/admin/homepage/reviews-content.ejs');
  for (const k of usedCfg) assert.match(adminView, new RegExp(`name="${k}"`), `admin input for ${k}`);
  const shape = Object.keys(reviews.selectHomeReviews([rv(1)], {})[0]);
  const usedRow = new Set([...partial.matchAll(/\br\.(\w+)/g)].map((m) => m[1]));
  assert.deepEqual([...usedRow].filter((k) => !shape.includes(k)), []);
  assert.ok(r2); // keep the r2 import used (key shape is asserted in homepageMedia tests)
});
