process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

// Client showcase mode (demo.showReviewsPublicly = true): demo testimonials are visible on the
// homepage + course page but stay clearly marked and never count as genuine reviews.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const reviews = require('../src/services/homeReviews.service');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').split('\r\n').join('\n');
const viewPath = path.join(root, 'views/public/course-detail-content.ejs');

const demo = (id, extra = {}) => ({ id, isPublished: true, isDemo: true, featuredOnHome: false, reviewType: 'TEXT', quote: `demo quote ${id}`, rating: 5, reviewerName: `Demo ${id}`, sortOrder: id, homeSortOrder: 0, course: { title: 'FMR', slug: 'fmr', status: 'PUBLISHED' }, ...extra });
const real = (id, extra = {}) => ({ ...demo(id), isDemo: false, featuredOnHome: true, reviewerName: `Real ${id}`, ...extra });

test('homepage selection: demo reviews appear only in showcase mode, keep isDemo=true, genuine still need featuring', () => {
  const rows = [demo(1), demo(2), real(3), real(4, { featuredOnHome: false })];
  const off = reviews.selectHomeReviews(rows, null, { includeDemo: false });
  assert.deepEqual(off.map((r) => r.id), [3], 'public: only featured genuine');
  const on = reviews.selectHomeReviews(rows, null, { includeDemo: true });
  assert.deepEqual(on.map((r) => r.id).sort(), [1, 2, 3]);
  assert.ok(on.filter((r) => r.id !== 3).every((r) => r.isDemo === true), 'demo rows stay marked');
  assert.equal(on.find((r) => r.id === 3).isDemo, false);
  assert.ok(!on.some((r) => r.id === 4), 'unfeatured genuine review is still excluded');
});

test('homepage partial renders the DEMO REVIEW badge for demo cards', async () => {
  const items = reviews.selectHomeReviews([demo(1), real(3)], null, { includeDemo: true });
  const html = await ejs.renderFile(path.join(root, 'views/partials/home-reviews.ejs'), {
    homeReviews: items, homeReviewSettings: { ...reviews.DEFAULTS, enabled: true }, cms: { brand: {} },
  });
  assert.equal((html.match(/home-review-demo">DEMO REVIEW/g) || []).length, 1, 'only the demo card is badged');
});

test('controllers never strip the demo marking', () => {
  assert.doesNotMatch(read('src/controllers/home.controller.js'), /isDemo: false/);
  assert.doesNotMatch(read('src/controllers/course.controller.js'), /isDemo: false/);
});

function render(testimonials, landingExtra = {}, extra = {}) {
  return ejs.render(read('views/public/course-detail-content.ejs'), {
    cms: { course: {}, brand: {} },
    course: { id: 1, title: 'FMR', slug: 'fmr', price: 24999, salePrice: 7999, currency: 'INR', shortDescription: '', description: '', category: null, thumbnailUrl: null, lessons: [], instructor: { name: 'Dr T', photoUrl: null, credentials: [] } },
    isFree: false, priceLabel: '₹7,999', isEnrolled: false, hasPendingRequest: false, paymentsEnabled: true,
    stats: { publishedModuleCount: 1, publishedLessonCount: 3, totalDurationFormatted: '1h', resourceCount: 0, videoCount: 3 },
    curriculum: [], resources: [], faqs: [], csrfToken: 't', cspNonce: 'n',
    landing: {
      // FMR keeps reviewsEnabled OFF in production: showcase must still be able to show demo cards
      content: { heroEnabled: true, reviewsEnabled: false, reviewsHeading: 'What clinicians say' },
      heroChips: [], stats: [], takeaways: [], questions: [], audienceFor: [], audienceNotFor: [], faqs: [], whyRegisterWant: [], whyRegisterGet: [],
      highlights: [], testimonials, accessPlans: [], comparisonColumns: [], accessSteps: [], realReviewCount: 0, ratingSummary: null,
      renderList: ['HERO', 'REVIEWS'], landingSections: ['HERO', 'REVIEWS'], ...landingExtra,
    },
    ...extra,
  }, { filename: viewPath });
}
const card = (id, extra) => ({ id, sortOrder: id, isPublished: true, isDemo: true, hasQuote: true, hasVideo: false, reviewerName: `Demo ${id}`, quote: `q${id}`, rating: 5, ...extra });

test('course page showcase: demo carousel visible, every card marked, banner is honest, no genuine metrics', () => {
  const html = render([card(1), card(2), card(3)], { demoShowcase: true });
  assert.match(html, /data-reviews-carousel/);
  assert.equal((html.match(/>DEMO REVIEW</g) || []).length, 3);
  assert.match(html, /Demo reviews shown for presentation only/);
  assert.doesNotMatch(html, /Visible in Admin Preview Only/);
  assert.doesNotMatch(html, /reviews-summary"|hero-rating-row/, 'demo reviews create no rating summary');
});

test('course page without showcase: demo reviews and the section stay hidden', () => {
  const html = render([card(1)], { demoShowcase: false });
  assert.doesNotMatch(html, /data-reviews-carousel|DEMO REVIEW|Demo 1/);
});

test('demo reviews never feed genuine metrics (aggregate query + JSON-LD)', () => {
  const svc = read('src/services/courseLanding.service.js');
  assert.match(svc, /aggregate\(\{\s*where: \{ courseId: numericCourseId, isPublished: true, isDemo: false \}/);
  for (const f of ['src/controllers/course.controller.js', 'src/controllers/home.controller.js', 'src/lib/seo.js']) {
    assert.doesNotMatch(read(f), /aggregateRating|AggregateRating|"@type": 'Review'|'@type': 'Review'/, f);
  }
});
