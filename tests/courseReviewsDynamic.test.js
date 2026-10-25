process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

// Course reviews: course-specific, genuine-only, real ratings, Admin-controlled
// homepage selection/ordering, carousel markup and honest rating summary.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const { prisma } = require('../src/config/db');
const landing = require('../src/services/courseLanding.service');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').split('\r\n').join('\n');
const publicViewPath = path.join(root, 'views/public/course-detail-content.ejs');
const publicView = read('views/public/course-detail-content.ejs');

function swap(obj, key, impl) {
  const orig = obj[key];
  obj[key] = impl;
  return () => { obj[key] = orig; };
}

// ---------------------------------------------------------------------------
// Public data: course-specific + genuine only + honest summary
// ---------------------------------------------------------------------------
async function publicData(aggregate, captured = {}) {
  const empty = async () => [];
  const restores = [
    swap(prisma.courseLandingContent, 'findUnique', async () => ({})),
    swap(prisma.courseHeroChip, 'findMany', empty), swap(prisma.courseTakeaway, 'findMany', empty),
    swap(prisma.courseQuestion, 'findMany', empty), swap(prisma.courseAudienceItem, 'findMany', empty),
    swap(prisma.courseFaq, 'findMany', empty), swap(prisma.courseWhyRegisterItem, 'findMany', empty),
    swap(prisma.courseHighlight, 'findMany', empty),
    swap(prisma.courseTestimonial, 'findMany', async (args) => { captured.testimonials = args; return []; }),
    swap(prisma.courseAccessPlan, 'findMany', empty), swap(prisma.courseStat, 'findMany', empty),
    swap(prisma.courseComparisonColumn, 'findMany', empty), swap(prisma.courseAccessStep, 'findMany', empty),
    swap(prisma.courseLandingSection, 'findMany', empty),
    swap(prisma.courseTestimonial, 'aggregate', async (args) => { captured.aggregate = args; return aggregate; }),
  ];
  try {
    return await landing.getPublicLandingData(7);
  } finally {
    restores.reverse().forEach((r) => r());
  }
}

test('course reviews query is scoped to THIS course, published and non-demo; ordered by the course order', async () => {
  const cap = {};
  await publicData({ _count: { id: 3 }, _avg: { rating: 4.6667 } }, cap);
  assert.equal(cap.testimonials.where.courseId, 7);
  assert.equal(cap.testimonials.where.isPublished, true);
  assert.equal(cap.testimonials.where.isDemo, false);
  assert.deepEqual(cap.testimonials.orderBy, { sortOrder: 'asc' });
  assert.equal(cap.aggregate.where.courseId, 7);
  assert.equal(cap.aggregate.where.isPublished, true);
  assert.equal(cap.aggregate.where.isDemo, false);
});

test('rating summary = genuine average (1 decimal) + count; absent when there are no genuine reviews', async () => {
  const some = await publicData({ _count: { id: 24 }, _avg: { rating: 4.79166 } });
  assert.deepEqual(some.ratingSummary, { count: 24, average: 4.8 });
  const none = await publicData({ _count: { id: 0 }, _avg: { rating: null } });
  assert.equal(none.ratingSummary, null);
  const zero = await publicData({ _count: { id: 2 }, _avg: { rating: 0 } });
  assert.equal(zero.ratingSummary, null);
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const it = (id, extra) => ({ id, sortOrder: id, isPublished: true, isDemo: false, hasQuote: true, hasVideo: false, ...extra });
function render(testimonials, extraLanding = {}, extra = {}) {
  return ejs.render(publicView, {
    cms: { course: {}, brand: {} },
    course: { id: 1, title: 'Some Course', slug: 'some-course', price: 0, salePrice: null, currency: 'INR', shortDescription: '', description: '', category: null, thumbnailUrl: null, lessons: [], instructor: { name: 'Dr T', photoUrl: null, credentials: [] } },
    isFree: true, priceLabel: 'Free', isEnrolled: false, hasPendingRequest: false, paymentsEnabled: false,
    stats: { publishedModuleCount: 1, publishedLessonCount: 3, totalDurationFormatted: '1h', resourceCount: 0, videoCount: 3 },
    curriculum: [], resources: [], faqs: [], csrfToken: 't', cspNonce: 'n',
    landing: {
      content: { heroEnabled: true, reviewsEnabled: true, reviewsEyebrow: 'Student Reviews', reviewsHeading: 'What clinicians say', reviewsIntro: '' },
      heroChips: [], stats: [], takeaways: [], questions: [], audienceFor: [], audienceNotFor: [], faqs: [], whyRegisterWant: [], whyRegisterGet: [],
      highlights: [], testimonials, accessPlans: [], comparisonColumns: [], accessSteps: [], realReviewCount: 0,
      renderList: ['HERO', 'REVIEWS'], landingSections: ['HERO', 'REVIEWS'], ...extraLanding,
    },
    ...extra,
  }, { filename: publicViewPath });
}

test('rating summary renders from real data with accessible labels, in the hero and the reviews section', () => {
  const html = render([it(1, { reviewerName: 'A', quote: 'Great', rating: 5 })], { ratingSummary: { count: 24, average: 4.4 }, realReviewCount: 24 });
  assert.equal((html.match(/Rated 4\.4 out of 5, based on 24 reviews/g) || []).length, 2);
  assert.match(html, /Based on 24 reviews/);
  assert.match(html, /reviews-summary-score" aria-hidden="true">4\.4</);
  assert.match(html, /bi-star-half/, '4.4 shows 4.5 stars: four full and a half');
});

test('no rating summary, no 0.0, no empty stars and no fake rating when there are no genuine reviews', () => {
  const html = render([it(1, { reviewerName: 'A', quote: 'Great', rating: 5 })], { ratingSummary: null, realReviewCount: 0 });
  assert.doesNotMatch(html, /reviews-summary"|hero-rating-row|Based on 0|0\.0|4\.9|rated<\/strong>/);
  const none = render([], {}, {});
  assert.doesNotMatch(none, /hero-rating-row|reviews-summary"/);
});

test('review cards use the saved rating only (5.0 / 4.0), with an accessible label', () => {
  const html = render([it(1, { reviewerName: 'Five', quote: 'q5', rating: 5 }), it(2, { reviewerName: 'Four', quote: 'q4', rating: 4 })]);
  assert.match(html, /aria-label="Rated 5 out of 5"/);
  assert.match(html, /aria-label="Rated 4 out of 5"/);
  assert.match(html, /review-rating-num" aria-hidden="true">5\.0</);
  assert.match(html, /review-rating-num" aria-hidden="true">4\.0</);
  // 4-star card shows 4 filled + 1 empty star
  const four = html.split('Four')[0].split('role="group"').pop() + html.split('Four')[1].split('</blockquote>')[0];
  assert.equal((four.match(/bi-star-fill/g) || []).length, 4);
  assert.equal((four.match(/class="bi bi-star"/g) || []).length, 1);
  // a review with no saved rating renders no stars (no fabricated 5)
  const noRating = render([it(3, { reviewerName: 'NoStars', quote: 'q', rating: 0 })]);
  assert.doesNotMatch(noRating.split('NoStars')[0].split('review-card').pop(), /review-stars/);
});

test('carousel markup: region, slides, arrows, dots, keyboard focus, script', () => {
  const html = render([1, 2, 3].map((i) => it(i, { reviewerName: `R${i}`, quote: `q${i}`, rating: 5 })));
  assert.match(html, /data-reviews-carousel data-rotate="true" role="region" aria-roledescription="carousel"/);
  assert.match(html, /class="reviews-viewport" tabindex="0"/);
  assert.equal((html.match(/aria-roledescription="slide"/g) || []).length, 3);
  assert.match(html, /aria-label="Previous reviews"/);
  assert.match(html, /aria-label="Next reviews"/);
  assert.match(html, /class="reviews-dots"/);
  assert.match(html, /\/js\/course-reviews-carousel\.js/);
  const two = render([1, 2].map((i) => it(i, { reviewerName: `R${i}`, quote: `q${i}`, rating: 5 })));
  assert.match(two, /data-rotate="false"/, 'no autoplay when everything fits');
});

test('text, video and text+video reviews all render; video cards open the existing player, never autoplay', () => {
  const html = render([
    it(1, { reviewerName: 'TextOnly', quote: 'only text', reviewType: 'TEXT', rating: 5 }),
    it(2, { reviewerName: 'VideoOnly', quote: '', hasQuote: false, hasVideo: true, videoKind: 'embed', embedUrl: 'https://www.youtube-nocookie.com/embed/abc', reviewType: 'VIDEO', rating: 5 }),
    it(3, { reviewerName: 'Both', quote: 'text and video', hasVideo: true, videoKind: 'hosted', reviewType: 'TEXT_VIDEO', rating: 4 }),
  ]);
  assert.match(html, /only text/);
  assert.match(html, /text and video/);
  assert.equal((html.match(/data-testimonial-video/g) || []).length, 2);
  assert.match(html, /aria-label="Play video review from VideoOnly"/);
  assert.doesNotMatch(html, /<video|autoplay(?!=)/i);
  assert.match(html, /\/js\/testimonial-player\.js/);
});

test('demo reviews stay hidden publicly (and in showcase mode only when the owner enables it)', () => {
  const demo = it(9, { reviewerName: 'DemoPerson', quote: 'demo quote', isDemo: true, rating: 5 });
  const html = render([it(1, { reviewerName: 'Real', quote: 'real quote', rating: 5 }), demo]);
  assert.doesNotMatch(html, /DemoPerson|DEMO REVIEW/);
  const preview = render([demo], {}, { isPreview: true });
  assert.match(preview, /DemoPerson/);
});

test('template has no hardcoded ratings or review counts', () => {
  assert.doesNotMatch(publicView, /4\.9|4\.8|24 reviews|\+ reviews'/);
  assert.doesNotMatch(publicView, /<strong>[\d.]+ rated/);
});

// ---------------------------------------------------------------------------
// Admin persistence: homepage selection + ordering + safety
// ---------------------------------------------------------------------------
async function withReviewDb(fn) {
  const created = [];
  const updated = [];
  const row = { id: 11, courseId: 5, reviewerName: 'Old', quote: 'q', reviewType: 'TEXT', videoObjectKey: null, videoUrl: null, videoThumbnailUrl: null, featuredOnHome: true, homeSortOrder: 4, sortOrder: 20, rating: 5, isPublished: true, isDemo: false };
  const restores = [
    swap(prisma.courseTestimonial, 'count', async () => 2),
    swap(prisma.courseTestimonial, 'create', async ({ data }) => { created.push(data); return { id: 1, ...data }; }),
    swap(prisma.courseTestimonial, 'findUnique', async () => row),
    swap(prisma.courseTestimonial, 'update', async ({ data }) => { updated.push(data); return { ...row, ...data }; }),
  ];
  try {
    await fn({ created, updated });
  } finally {
    restores.reverse().forEach((r) => r());
  }
}

test('new reviews are NOT on the homepage unless explicitly selected; order values persist', async () => {
  await withReviewDb(async ({ created }) => {
    await landing.addTestimonial(5, { reviewerName: 'A', quote: 'q' });
    assert.equal(created[0].featuredOnHome, false);
    assert.equal(created[0].homeSortOrder, 0);
    await landing.addTestimonial(5, { reviewerName: 'B', quote: 'q', featuredOnHome: true, homeSortOrder: '30', sortOrder: '40' });
    assert.equal(created[1].featuredOnHome, true);
    assert.equal(created[1].homeSortOrder, 30);
    assert.equal(created[1].sortOrder, 40);
  });
});

test('editing another field never toggles Show on Homepage or the orders (partial save)', async () => {
  await withReviewDb(async ({ updated }) => {
    await landing.updateTestimonial(5, 11, { reviewerName: 'Renamed' });
    assert.equal(updated[0].reviewerName, 'Renamed');
    for (const k of ['featuredOnHome', 'homeSortOrder', 'sortOrder', 'isPublished', 'isDemo']) assert.equal(k in updated[0], false, `${k} must be untouched`);
    await landing.updateTestimonial(5, 11, { featuredOnHome: false });
    assert.equal(updated[1].featuredOnHome, false);
    await landing.updateTestimonial(5, 11, { homeSortOrder: '7', sortOrder: '' });
    assert.equal(updated[2].homeSortOrder, 7);
    assert.equal('sortOrder' in updated[2], false, 'blank order leaves the value alone');
  });
});

test('admin controller parses the hidden-false + checkbox pair for Show on Homepage', async () => {
  const controller = require('../src/controllers/admin/courseLanding.controller');
  const seen = [];
  const restore = swap(landing, 'addTestimonial', async (courseId, payload) => { seen.push(payload); return {}; });
  try {
    const mk = (body) => ({ params: { courseId: '5' }, body: { formSubmitted: '1', reviewerName: 'N', ...body }, flashSuccess() {}, flashError() {}, files: {} });
    const res = { redirect() {} };
    await controller.createTestimonial(mk({ featuredOnHome: ['false', 'true'] }), res, () => {});
    await controller.createTestimonial(mk({ featuredOnHome: 'false' }), res, () => {});
    assert.equal(seen[0].featuredOnHome, true);
    assert.equal(seen[1].featuredOnHome, false);
  } finally {
    restore();
  }
});

test('Admin review forms expose Show on Homepage, Homepage order and Course page order (create + edit)', async () => {
  const adminView = read('views/admin/courses/landing-page-content.ejs');
  assert.ok((adminView.match(/name="featuredOnHome"/g) || []).length >= 4, 'create + edit modals');
  assert.match(adminView, /name="homeSortOrder"/);
  assert.match(adminView, /Show on Homepage/);
  assert.match(adminView, /Course page order/);
  const html = await ejs.renderFile(path.join(root, 'views/admin/courses/landing-page-content.ejs'), {
    csrfToken: 't', activeTab: 'reviews', course: { id: 5, title: 'C', slug: 'c', status: 'PUBLISHED', instructor: null }, landingContent: {},
    heroChips: [], takeaways: [], questions: [], audienceItems: [], faqs: [], whyRegisterItems: [], highlights: [], accessPlans: [], courseStats: [], landingSections: [], resources: [], accessSteps: [], comparisonColumns: [],
    testimonials: [{ id: 3, courseId: 5, reviewerName: 'Ravi', quote: 'q', rating: 5, reviewType: 'TEXT', isPublished: true, isDemo: false, featuredOnHome: true, homeSortOrder: 12, sortOrder: 30 }],
  });
  assert.match(html, /id="editRev-3Home"[^>]*checked/);
  assert.match(html, /name="homeSortOrder" id="editRev-3HomeOrder"[^>]*value="12"/);
  assert.match(html, /name="sortOrder" id="editRev-3CourseOrder"[^>]*value="30"/);
});
