process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

// Course pricing: ONE server-side helper (getEffectiveCoursePrice) decides the
// payable price everywhere - landing hero, purchase card, sticky CTA, cards,
// checkout and the Razorpay order. Nothing is hardcoded in templates.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const { getEffectiveCoursePrice, getCoursePurchasePrice, isSaleActive } = require('../src/lib/pricing');
const { validateCourse } = require('../src/validators/course.validator');
const { toPaise } = require('../src/lib/money');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').split('\r\n').join('\n');
const publicViewPath = path.join(root, 'views/public/course-detail-content.ejs');
const publicView = read('views/public/course-detail-content.ejs');

const fmr = (extra = {}) => ({ currency: 'INR', price: 24999, salePrice: 7999, saleEnabled: true, saleStartsAt: null, saleEndsAt: null, saleBadgeLabel: null, ...extra });
const NOW = new Date('2026-10-25T10:00:00Z');

// ---------------------------------------------------------------------------
// Helper semantics
// ---------------------------------------------------------------------------
test('regular price, sale price and the discount % are calculated (never hardcoded)', () => {
  const p = getEffectiveCoursePrice(fmr(), NOW);
  assert.equal(p.regular, 24999);
  assert.equal(p.effective, 7999);
  assert.equal(p.onSale, true);
  assert.equal(p.discountPercent, 68);
  assert.equal(p.badgeLabel, '68% OFF');
  assert.equal(p.regularLabel, '₹24,999');
  assert.equal(p.effectiveLabel, '₹7,999');
  assert.equal(p.effectiveString, '7999.00');
  // different numbers => different calculated percent, same code path
  assert.equal(getEffectiveCoursePrice(fmr({ price: 1000, salePrice: 750 }), NOW).badgeLabel, '25% OFF');
  assert.equal(getEffectiveCoursePrice(fmr({ price: 1000, salePrice: 999 }), NOW).discountPercent, 1);
});

test('no discount is shown without a valid sale', () => {
  for (const c of [fmr({ salePrice: null }), fmr({ salePrice: '' }), fmr({ salePrice: 24999 }), fmr({ salePrice: 30000 }), fmr({ saleEnabled: false })]) {
    const p = getEffectiveCoursePrice(c, NOW);
    assert.equal(p.onSale, false);
    assert.equal(p.discountPercent, 0);
    assert.equal(p.badgeLabel, '');
    assert.equal(p.effective, 24999, 'regular price applies');
  }
});

test('sale window: starts later / already ended revert to the regular price automatically', () => {
  assert.equal(getEffectiveCoursePrice(fmr({ saleStartsAt: new Date('2026-11-01T00:00:00Z') }), NOW).effective, 24999);
  assert.equal(getEffectiveCoursePrice(fmr({ saleEndsAt: new Date('2026-10-01T00:00:00Z') }), NOW).effective, 24999);
  const live = getEffectiveCoursePrice(fmr({ saleStartsAt: new Date('2026-10-01T00:00:00Z'), saleEndsAt: new Date('2026-11-01T00:00:00Z') }), NOW);
  assert.equal(live.effective, 7999);
  assert.ok(live.saleEndsAt instanceof Date);
  // same row, later clock => reverts with no edit
  assert.equal(getEffectiveCoursePrice(fmr({ saleEndsAt: new Date('2026-10-26T00:00:00Z') }), new Date('2026-10-27T00:00:00Z')).effective, 24999);
  assert.equal(isSaleActive(fmr(), NOW), true);
});

test('custom badge label overrides the calculated one; free courses are free and never discounted', () => {
  assert.equal(getEffectiveCoursePrice(fmr({ saleBadgeLabel: 'Launch offer' }), NOW).badgeLabel, 'Launch offer');
  const free = getEffectiveCoursePrice({ currency: 'INR', price: 0, salePrice: null }, NOW);
  assert.equal(free.isFree, true);
  assert.equal(free.onSale, false);
  assert.equal(free.badgeLabel, '');
});

test('Decimal-like Prisma values keep exact amounts', () => {
  const dec = (v) => ({ toFixed: (n) => Number(v).toFixed(n), valueOf: () => v, toString: () => String(v) });
  const p = getEffectiveCoursePrice({ currency: 'INR', price: dec(24999), salePrice: dec(7999.5) }, NOW);
  assert.equal(p.effectiveString, '7999.50');
});

// ---------------------------------------------------------------------------
// Checkout / Razorpay amount
// ---------------------------------------------------------------------------
test('checkout and Razorpay charge the EFFECTIVE (sale) price, not the regular price', () => {
  assert.equal(getCoursePurchasePrice(fmr(), NOW), '7999.00');
  assert.equal(toPaise(getCoursePurchasePrice(fmr(), NOW)), 799900);
  assert.equal(getCoursePurchasePrice(fmr({ saleEnabled: false }), NOW), '24999.00');
  assert.equal(toPaise(getCoursePurchasePrice(fmr({ saleEndsAt: new Date('2026-01-01') }), NOW)), 2499900);
});

test('every payment path derives the amount from the single pricing helper', () => {
  const checkout = read('src/controllers/checkout.controller.js');
  assert.equal((checkout.match(/getCoursePurchasePrice\(course\)/g) || []).length, 3, 'page, createOrder and enrollFree');
  assert.doesNotMatch(checkout, /course\.salePrice|course\.price/, 'no ad-hoc price maths in checkout');
  const orders = read('src/services/order.service.js');
  assert.doesNotMatch(orders, /\.salePrice/, 'orders never read salePrice directly');
  // the tax breakdown (Razorpay total) is computed from the effective list price
  assert.match(checkout, /taxSettings\.getPricing\(course, listPrice\)/);
  assert.match(checkout, /const amount = pricing\.total/);
});

// ---------------------------------------------------------------------------
// Admin validation + form
// ---------------------------------------------------------------------------
const body = (extra = {}) => ({ title: 'Course title', price: '24999', salePrice: '7999', level: 'ADVANCED', status: 'PUBLISHED', thumbnailUrl: '', ...extra });

test('admin validation: sale must be lower than regular; window and badge are validated', () => {
  assert.deepEqual(validateCourse(body()).errors, []);
  assert.ok(validateCourse(body({ salePrice: '30000' })).errors.some((e) => /Sale price/i.test(e)));
  assert.ok(validateCourse(body({ salePrice: '24999' })).errors.some((e) => /lower than the regular/i.test(e)));
  assert.ok(validateCourse(body({ price: '-1' })).errors.length);
  assert.ok(validateCourse(body({ salePrice: 'abc' })).errors.length);
  const w = validateCourse(body({ saleEnabled: ['false', 'true'], saleStartsAt: '2026-10-01T10:00', saleEndsAt: '2026-11-01T10:00', saleBadgeLabel: ' Diwali ' }));
  assert.deepEqual(w.errors, []);
  assert.equal(w.values.saleEnabled, true);
  assert.equal(w.values.saleBadgeLabel, 'Diwali');
  assert.ok(w.values.saleStartsAt instanceof Date);
  assert.ok(validateCourse(body({ saleEnabled: 'true', saleStartsAt: '2026-11-01T10:00', saleEndsAt: '2026-10-01T10:00' })).errors.some((e) => /after the sale start/i.test(e)));
  assert.ok(validateCourse(body({ saleEnabled: 'true', saleStartsAt: 'not a date' })).errors.length);
});

test('boolean safety: unchecked sale toggle saves false; omitted sale fields are left untouched', () => {
  assert.equal(validateCourse(body({ saleEnabled: 'false' })).values.saleEnabled, false);
  assert.equal(validateCourse(body({ saleEnabled: ['false', 'true'] })).values.saleEnabled, true);
  const none = validateCourse(body()).values; // older callers do not post sale fields
  assert.equal(none.saleEnabled, undefined);
  assert.equal('saleStartsAt' in none, false);
});

test('"free course" switch forces price 0 and drops the sale', () => {
  const r = validateCourse(body({ isFree: 'on' }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.values.price, '0');
  assert.equal(r.values.salePrice, null);
});

test('Admin course form has Regular / Sale price labels, sale toggle, window and badge fields', async () => {
  const html = await ejs.renderFile(path.join(root, 'views/admin/courses/form-content.ejs'), {
    csrfToken: 't', cms: require('../src/services/settings.service').defaultContent(), course: { id: 6, title: 'FMR', slug: 'fmr', status: 'PUBLISHED' }, categories: [], instructors: [], levels: ['BEGINNER'], statuses: ['DRAFT', 'PUBLISHED'], errors: [],
    values: { price: '24999', salePrice: '7999', saleEnabled: true, saleStartsAt: '', saleEndsAt: '', saleBadgeLabel: '', status: 'PUBLISHED', level: 'BEGINNER' },
  });
  for (const t of ['Regular Price', 'Sale Price / Discounted Price', 'Sale enabled', 'Sale starts', 'Sale ends', 'Discount badge label', 'Free course']) assert.ok(html.includes(t), t);
  assert.match(html, /name="saleEnabled" value="false"/);
  assert.match(html, /name="saleEnabled" id="courseSaleEnabled" value="true" checked/);
  assert.match(html, /value="24999"/);
  assert.match(html, /value="7999"/);
});

// ---------------------------------------------------------------------------
// Rendering: landing hero, purchase card, sticky CTA, cards
// ---------------------------------------------------------------------------
function renderLanding(course, extra = {}) {
  const coursePricing = getEffectiveCoursePrice(course, NOW);
  return ejs.render(publicView, {
    cms: { course: {}, brand: {} },
    course: { id: 1, title: 'Some Course', slug: 'some-course', shortDescription: '', description: '', category: null, thumbnailUrl: null, lessons: [], instructor: { name: 'Dr T', photoUrl: null, credentials: [] }, ...course },
    coursePricing,
    isFree: coursePricing.isFree, priceLabel: coursePricing.effectiveLabel, isEnrolled: false, hasPendingRequest: false, paymentsEnabled: true,
    stats: { publishedModuleCount: 1, publishedLessonCount: 3, totalDurationFormatted: '1h', resourceCount: 0, videoCount: 3 },
    curriculum: [], resources: [], faqs: [], csrfToken: 't', cspNonce: 'n',
    landing: {
      content: { purchaseCardEnabled: true, stickyCtaEnabled: true, heroEnabled: true },
      heroChips: [], stats: [], takeaways: [], questions: [], audienceFor: [], audienceNotFor: [], faqs: [], whyRegisterWant: [], whyRegisterGet: [],
      highlights: [], testimonials: [], accessPlans: [], comparisonColumns: [], accessSteps: [], realReviewCount: 0,
      renderList: ['HERO', 'PURCHASE'], landingSections: ['HERO', 'PURCHASE'],
    },
    ...extra,
  }, { filename: publicViewPath });
}

test('landing: regular price struck through, current price large, discount calculated - hero, purchase card and sticky CTA', () => {
  const html = renderLanding(fmr());
  assert.match(html, /<del>₹24,999<\/del>/, 'hero strike-through');
  assert.match(html, /hero-price-val">₹7,999</);
  assert.match(html, /hero-sale-badge">68% OFF</);
  assert.match(html, /class="purchase-price-old"><del[^>]*>₹24,999<\/del>/);
  assert.match(html, /purchase-sale-badge">68% OFF</);
  assert.match(html, /floating-price-old">₹24,999<\/del>/);
  assert.match(html, /<strong>₹7,999<\/strong>/);
  assert.match(html, /floating-sale-badge">68% OFF</);
  assert.match(html, /Buy Course – ₹7,999/, 'CTA shows the effective price');
  assert.doesNotMatch(html, /Buy Course – ₹24,999/);
});

test('landing: custom badge label wins; no sale => one price and no discount UI; free => no paid pricing', () => {
  assert.match(renderLanding(fmr({ saleBadgeLabel: 'Founders price' })), /hero-sale-badge">Founders price</);
  const plain = renderLanding(fmr({ salePrice: null }));
  assert.match(plain, /hero-price-val">₹24,999</);
  assert.doesNotMatch(plain, /hero-price-old|\d+% OFF|purchase-price-old|floating-sale-badge/);
  const invalid = renderLanding(fmr({ salePrice: 30000 }));
  assert.doesNotMatch(invalid, /\d+% OFF|hero-price-old/, 'sale >= regular never fakes a discount');
  const expired = renderLanding(fmr({ saleEndsAt: new Date('2026-01-01') }));
  assert.doesNotMatch(expired, /\d+% OFF/);
  assert.match(expired, /hero-price-val">₹24,999</);
  const free = renderLanding({ price: 0, salePrice: null });
  assert.doesNotMatch(free, /₹0|\d+% OFF|hero-price-old/);
  assert.match(free, /hero-price-val">Free</);
});

test('landing template contains no hardcoded prices or discount percentages', () => {
  assert.doesNotMatch(publicView, /24,?999|7,?999|68\s*%/);
  assert.doesNotMatch(publicView, /Math\.round\(\(\(Number\(course\.price\)/, 'no ad-hoc discount maths in the template');
  assert.doesNotMatch(publicView, /course\.salePrice/);
});

test('course cards show the effective price with a calculated badge', async () => {
  const VIEWS = path.join(root, 'views');
  const card = (course) => ejs.renderFile(path.join(VIEWS, 'partials', 'course-card.ejs'), { course, coursePriceOf: getEffectiveCoursePrice, fill: (s) => s, cms: require('../src/services/settings.service').defaultContent() }, { views: [VIEWS] });
  const base = { id: 1, slug: 'c', title: 'T', shortDescription: 'd', level: 'ADVANCED', currency: 'INR', thumbnailUrl: null, duration: null, category: null, instructor: null, reviews: [], _count: { lessons: 3 } };
  const html = await card({ ...base, ...fmr() });
  const price = html.match(/<div class="course-price">([\s\S]*?)<\/div>/)[1];
  assert.match(price, /₹7,999/);
  assert.match(price, /₹24,999/);
  assert.match(price, /68% OFF/);
});

test('single source of truth: controllers and middleware use the helper', () => {
  assert.match(read('src/controllers/course.controller.js'), /getEffectiveCoursePrice\(course\)/);
  assert.match(read('src/controllers/admin/courseLanding.controller.js'), /getEffectiveCoursePrice\(course\)/);
  assert.match(read('src/middleware/site.middleware.js'), /coursePriceOf = getEffectiveCoursePrice/);
  for (const f of ['views/partials/course-card.ejs', 'views/public/checkout-content.ejs']) {
    assert.match(read(f), /coursePriceOf/, f);
  }
});
