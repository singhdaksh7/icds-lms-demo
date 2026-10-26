process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

// Continuous review marquee: Admin-controlled mode/speed/direction (homepage + per course),
// allowlisted durations, seamless looping engine, pause/reduced-motion rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const { prisma } = require('../src/config/db');
const reviews = require('../src/services/homeReviews.service');
const courseCarousel = require('../src/services/courseReviewsCarousel.service');
const opts = require('../src/lib/carouselOptions');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').split('\r\n').join('\n');
const swap = (o, k, v) => { const prev = o[k]; o[k] = v; return () => { o[k] = prev; }; };

test('speed presets map to the predefined loop durations only', () => {
  assert.deepEqual(opts.SPEED_SECONDS, { VERY_SLOW: 45, SLOW: 32, NORMAL: 22 });
  assert.deepEqual(opts.MODES, ['STATIC', 'SLIDE', 'CONTINUOUS']);
});

test('homepage settings: mode + speed validate against allowlists and derive the duration', () => {
  const v = (o) => reviews.validateHomeReviewSettings(o);
  assert.equal(v({ carouselMode: 'CONTINUOUS', continuousSpeed: 'SLOW' }).ok, true);
  assert.equal(v({ carouselMode: 'CONTINUOUS', continuousSpeed: 'SLOW' }).values.continuousSeconds, 32);
  assert.equal(v({ continuousSpeed: 'NORMAL' }).values.continuousSeconds, 22);
  for (const bad of ['FAST', '10', 'continuous', '', 'CONTINUOUS; x']) {
    assert.equal(v({ carouselMode: bad }).ok, false, `mode ${bad}`);
    assert.equal(v({ continuousSpeed: bad }).ok, false, `speed ${bad}`);
  }
});

test('mode wins over the legacy on/off flag; an unsaved mode is derived so old sites behave as before', () => {
  assert.equal(reviews.normalizeSettings({ carouselEnabled: false }).carouselMode, 'STATIC');
  assert.equal(reviews.normalizeSettings({ carouselEnabled: true }).carouselMode, 'SLIDE');
  const c = reviews.normalizeSettings({ carouselEnabled: false, carouselMode: 'CONTINUOUS' });
  assert.equal(c.carouselMode, 'CONTINUOUS');
  assert.equal(c.carouselEnabled, true);
  assert.equal(reviews.normalizeSettings({ carouselMode: 'STATIC' }).carouselEnabled, false);
  assert.equal(reviews.normalizeSettings({}).continuousSpeed, 'SLOW');
});

test('saving mode/speed is patch-style: no other homepage review setting is written', async () => {
  const writes = [];
  const restores = [
    swap(prisma, '$transaction', async (ops) => ops),
    swap(prisma.siteSetting, 'upsert', (args) => { writes.push(args.where.key); return args; }),
  ];
  try {
    await reviews.saveHomeReviewSettings({ carouselMode: 'CONTINUOUS', continuousSpeed: 'SLOW' });
    assert.deepEqual(writes.sort(), ['homeReviews.carouselMode', 'homeReviews.continuousSpeed']);
  } finally { restores.reverse().forEach((r) => r()); }
});

async function renderHome(cfg, n = 4) {
  const items = Array.from({ length: n }, (_, i) => ({ id: i + 1, reviewType: 'TEXT', hasVideo: false, quote: `q${i}`, rating: 5, reviewerName: `N${i}`, reviewerDesignation: 'Dentist', reviewerLocation: 'Delhi', initials: 'N', isDemo: false }));
  return ejs.renderFile(path.join(root, 'views/partials/home-reviews.ejs'), { homeReviews: items, homeReviewSettings: reviews.normalizeSettings({ enabled: true, ...cfg }), cms: { brand: {} } });
}

test('homepage partial: CONTINUOUS emits mode/seconds/direction + the marquee script; SLIDE does not; STATIC is a plain grid', async () => {
  const c = await renderHome({ carouselMode: 'CONTINUOUS', continuousSpeed: 'SLOW', direction: 'RIGHT_TO_LEFT' });
  assert.match(c, /data-mode="CONTINUOUS"/);
  assert.match(c, /data-seconds="32"/);
  assert.match(c, /data-direction="rtl"/);
  assert.match(c, /\/js\/review-marquee\.js/);
  assert.match(c, /\/js\/home-reviews-carousel\.js/);
  assert.match(await renderHome({ carouselMode: 'CONTINUOUS', direction: 'LEFT_TO_RIGHT' }), /data-direction="ltr"/);
  const slide = await renderHome({ carouselMode: 'SLIDE' });
  assert.match(slide, /data-mode="SLIDE"/);
  assert.doesNotMatch(slide, /review-marquee\.js/);
  const stat = await renderHome({ carouselMode: 'STATIC' });
  assert.match(stat, /home-reviews-grid/);
  assert.doesNotMatch(stat, /data-hr-carousel|review-marquee/);
  assert.match(c, /home-review-rating-num" aria-hidden="true">5\.0</);
});

test('admin homepage reviews form exposes mode + speed selects with the three presets', async () => {
  const html = await ejs.renderFile(path.join(root, 'views/admin/homepage/reviews-content.ejs'), {
    csrfToken: 't', settings: reviews.normalizeSettings({ carouselMode: 'CONTINUOUS', continuousSpeed: 'SLOW' }), genuine: [], demo: [],
  });
  assert.match(html, /name="carouselMode"/);
  assert.match(html, /<option value="CONTINUOUS" selected>/);
  assert.match(html, /name="continuousSpeed"/);
  for (const s of ['VERY_SLOW', 'SLOW', 'NORMAL']) assert.match(html, new RegExp(`<option value="${s}"`));
});

test('course reviews carousel: defaults, validation, patch save, per-course isolation', async () => {
  const store = new Map();
  const restores = [
    swap(prisma.siteSetting, 'findMany', async ({ where }) => where.key.in.filter((k) => store.has(k)).map((k) => ({ key: k, value: store.get(k) }))),
    swap(prisma.siteSetting, 'upsert', async ({ where, create }) => { store.set(where.key, create.value); return create; }),
    swap(prisma, '$transaction', async (ops) => Promise.all(ops)),
    swap(prisma.course, 'findUnique', async ({ where }) => ([1, 2].includes(where.id) ? { id: where.id } : null)),
  ];
  try {
    assert.deepEqual(await courseCarousel.getCourseReviewsCarousel(1), { mode: 'SLIDE', speed: 'SLOW', direction: 'RIGHT_TO_LEFT', seconds: 32, dir: 'rtl' });
    await courseCarousel.saveCourseReviewsCarousel(1, { mode: 'CONTINUOUS', speed: 'VERY_SLOW', direction: 'LEFT_TO_RIGHT' });
    const one = await courseCarousel.getCourseReviewsCarousel(1);
    assert.equal(one.mode, 'CONTINUOUS');
    assert.equal(one.seconds, 45);
    assert.equal(one.dir, 'ltr');
    assert.equal((await courseCarousel.getCourseReviewsCarousel(2)).mode, 'SLIDE', 'course 2 unaffected');
    await courseCarousel.saveCourseReviewsCarousel(1, { speed: 'NORMAL' });
    assert.equal((await courseCarousel.getCourseReviewsCarousel(1)).mode, 'CONTINUOUS', 'partial save keeps other fields');
    for (const bad of [{ mode: 'FAST' }, { speed: '5' }, { direction: 'UP' }]) await assert.rejects(() => courseCarousel.saveCourseReviewsCarousel(1, bad), /allowed option/);
    await assert.rejects(() => courseCarousel.saveCourseReviewsCarousel(99, { mode: 'STATIC' }), /Course not found/);
    await assert.rejects(() => courseCarousel.saveCourseReviewsCarousel('abc', {}), /Invalid course id/);
  } finally { restores.reverse().forEach((r) => r()); }
});

test('course view carries mode/seconds/direction and loads the marquee only for CONTINUOUS', () => {
  const view = read('views/public/course-detail-content.ejs');
  assert.match(view, /data-mode="<%= rc\.mode %>" data-seconds="<%= rc\.seconds %>" data-direction="<%= rc\.dir %>"/);
  assert.match(view, /if \(rc\.mode === 'CONTINUOUS'\) \{ %><script src="\/js\/review-marquee\.js"/);
  assert.match(view, /rc\.mode === 'SLIDE' && testimonialsList\.length > 2/);
});

test('Admin course Reviews tab has the carousel presentation form and a CSRF-protected route', () => {
  assert.match(read('views/admin/courses/landing-page-content.ejs'), /action="\/admin\/courses\/<%= course\.id %>\/reviews-carousel"/);
  assert.match(read('src/routes/adminPlayer.routes.js'), /router\.post\('\/courses\/:courseId\/reviews-carousel', doubleCsrfProtection/);
});

test('marquee engine: continuous rAF motion, seamless clone loop, pauses, reduced motion, accessible clones', () => {
  const js = read('public/js/review-marquee.js');
  assert.match(js, /requestAnimationFrame\(frame\)/, 'continuous, not timer jumps');
  assert.match(js, /cloneNode\(true\)/, 'seamless loop via cloned cards');
  assert.match(js, /function wrap\(v\)/, 'offset wraps by exactly one set width');
  for (const pause of ['hovering', 'focusInside', 'dragging', 'modalOpen()', 'document.hidden', 'onScreen']) assert.ok(js.includes(pause), `pauses on ${pause}`);
  assert.match(js, /tv-modal-open/, 'pauses while a review video modal is open');
  assert.match(js, /reduced\(\)\) return null/, 'never starts for prefers-reduced-motion');
  assert.match(js, /MIN_SPEED = 18/);
  assert.match(js, /MAX_SPEED = 80/);
  assert.match(js, /aria-hidden', 'true'/);
  assert.match(js, /tabindex', '-1'/);
  assert.match(js, /opts\.dots\.hidden = true/, 'dots hidden in continuous mode');
  assert.match(js, /pointerdown/);
  assert.match(js, /ArrowRight/);
  assert.doesNotMatch(js, /eval\(|innerHTML\s*=/);
});

test('visible-card targets: ~2.75 desktop, ~2.15 tablet, ~1.12 mobile (partial peek of the next card)', () => {
  const home = read('public/js/home-reviews-carousel.js');
  assert.match(home, /Math\.min\(3, cd\) - 0\.25/);
  assert.match(home, /ct \+ 0\.15/);
  assert.match(home, /mobile: 1\.12/);
  assert.match(read('public/js/course-reviews-carousel.js'), /desktop: 2\.75, tablet: 2\.15, mobile: 1\.12/);
});

test('marquee CSS: viewport clips overflow (no page overflow), edge fade, dots hidden', () => {
  for (const f of ['public/css/home-reviews-carousel.css', 'public/css/course-landing.css']) {
    const css = read(f);
    assert.match(css, /is-marquee [^{]*viewport \{[^}]*overflow: hidden/);
    assert.match(css, /--rm-slide-w/);
    assert.match(css, /mask-image: linear-gradient/);
  }
});
