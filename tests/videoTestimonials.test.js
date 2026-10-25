process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

// Video testimonials on the existing CourseTestimonial model: TEXT / VIDEO / TEXT_VIDEO.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const { prisma } = require('../src/config/db');
const landing = require('../src/services/courseLanding.service');
const homeReviews = require('../src/services/homeReviews.service');
const tv = require('../src/lib/testimonialVideo');
const r2 = require('../src/lib/r2');

const root = path.join(__dirname, '..');
const courseView = fs.readFileSync(path.join(root, 'views/public/course-detail-content.ejs'), 'utf8');

function swap(obj, key, impl) {
  const orig = obj[key];
  obj[key] = impl;
  return () => { obj[key] = orig; };
}

function memory(seed = []) {
  const rows = seed.map((r) => ({ ...r }));
  let nextId = rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  return {
    rows,
    async count() { return rows.length; },
    async create({ data }) { const row = { id: nextId++, ...data }; rows.push(row); return { ...row }; },
    async findUnique({ where }) { const r = rows.find((x) => x.id === where.id); return r ? { ...r } : null; },
    async update({ where, data }) { const r = rows.find((x) => x.id === where.id); Object.assign(r, data); return { ...r }; },
    async delete({ where }) { rows.splice(rows.findIndex((x) => x.id === where.id), 1); },
    async findMany() { return rows.map((r) => ({ ...r })); },
  };
}

const KEY = (courseId, id = 'new') => `courses/${courseId}/testimonials/${id}/0b9b1d58-8a3d-4a0e-9d5c-6f1a2b3c4d5e.mp4`;
const base = { reviewerName: 'Dr. QA', rating: 5, isPublished: true };

// ---------------------------------------------------------------------------
// Validation + CRUD
// ---------------------------------------------------------------------------
test('TEXT review: quote required, no video kept', async () => {
  const store = memory();
  const restore = swap(prisma, 'courseTestimonial', store);
  try {
    await assert.rejects(() => landing.addTestimonial(5, { ...base, reviewType: 'TEXT', quote: '  ' }), /quote is required/i);
    const t = await landing.addTestimonial(5, { ...base, reviewType: 'TEXT', quote: 'Great course', videoUrl: 'https://youtu.be/dQw4w9WgXcQ' });
    assert.equal(t.reviewType, 'TEXT');
    assert.equal(t.videoUrl, null, 'a text review never keeps a video');
    assert.equal(t.videoObjectKey, null);
    // legacy callers that send no type still create a TEXT review
    const legacy = await landing.addTestimonial(5, { ...base, quote: 'old style' });
    assert.equal(legacy.reviewType, 'TEXT');
  } finally { restore(); }
});

test('VIDEO review: video required, quote optional', async () => {
  const store = memory();
  const restore = swap(prisma, 'courseTestimonial', store);
  try {
    await assert.rejects(() => landing.addTestimonial(5, { ...base, reviewType: 'VIDEO', quote: 'only words' }), /need a video/i);
    const hosted = await landing.addTestimonial(5, { ...base, reviewType: 'VIDEO', videoObjectKey: KEY(5) });
    assert.equal(hosted.reviewType, 'VIDEO');
    assert.equal(hosted.quote, '');
    assert.equal(hosted.videoObjectKey, KEY(5));
    const ext = await landing.addTestimonial(5, { ...base, reviewType: 'VIDEO', videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    assert.equal(ext.videoObjectKey, null);
    assert.match(ext.videoUrl, /youtube/);
  } finally { restore(); }
});

test('TEXT_VIDEO review: both video and quote required', async () => {
  const store = memory();
  const restore = swap(prisma, 'courseTestimonial', store);
  try {
    await assert.rejects(() => landing.addTestimonial(5, { ...base, reviewType: 'TEXT_VIDEO', videoObjectKey: KEY(5) }), /need a quote/i);
    await assert.rejects(() => landing.addTestimonial(5, { ...base, reviewType: 'TEXT_VIDEO', quote: 'words' }), /need a video/i);
    const t = await landing.addTestimonial(5, { ...base, reviewType: 'TEXT_VIDEO', quote: 'words', videoObjectKey: KEY(5) });
    assert.equal(t.reviewType, 'TEXT_VIDEO');
  } finally { restore(); }
});

test('video inputs are validated: URL scheme/provider, object key ownership, thumbnail source', async () => {
  const store = memory();
  const restore = swap(prisma, 'courseTestimonial', store);
  try {
    for (const bad of ['javascript:alert(1)', 'http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://evil.example/video.mp4', 'ftp://x/y.mp4', 'https://vimeo.com/notanumber']) {
      await assert.rejects(() => landing.addTestimonial(5, { ...base, reviewType: 'VIDEO', videoUrl: bad }), /YouTube or Vimeo|https/i, bad);
    }
    // a lesson (protected) key, another course's key and a traversal key are all refused
    for (const key of ['courses/5/lessons/9/0b9b1d58-8a3d-4a0e-9d5c-6f1a2b3c4d5e.mp4', KEY(99), 'courses/5/testimonials/../../x.mp4', 'courses/5/testimonials/new/evil.exe']) {
      await assert.rejects(() => landing.addTestimonial(5, { ...base, reviewType: 'VIDEO', videoObjectKey: key }), /Invalid hosted video|need a video/i, key);
    }
    await assert.rejects(() => landing.addTestimonial(5, { ...base, reviewType: 'VIDEO', videoUrl: 'https://youtu.be/dQw4w9WgXcQ', videoThumbnailUrl: 'javascript:alert(1)' }), /Thumbnail/i);
    const ok = await landing.addTestimonial(5, { ...base, reviewType: 'VIDEO', videoUrl: 'https://youtu.be/dQw4w9WgXcQ', videoThumbnailUrl: '/uploads/thumbnails/0b9b1d58-8a3d-4a0e-9d5c-6f1a2b3c4d5e.jpg' });
    assert.equal(ok.videoThumbnailUrl, '/uploads/thumbnails/0b9b1d58-8a3d-4a0e-9d5c-6f1a2b3c4d5e.jpg');
  } finally { restore(); }
});

test('R2 testimonial keys are separate from protected lesson keys', () => {
  const k = r2.buildTestimonialObjectKey(7, 'new', '.webm');
  assert.ok(r2.isTestimonialObjectKey(k));
  assert.ok(r2.isOwnedObjectKey(k));
  assert.ok(!r2.isTestimonialObjectKey(r2.buildObjectKey(7, 3, '.mp4')), 'lesson key must not pass the testimonial check');
  assert.throws(() => r2.buildTestimonialObjectKey(7, 'new', '.exe'));
  assert.throws(() => r2.buildTestimonialObjectKey(0, 'new', '.mp4'));
});

test('edit: switching types, replacing and removing video report the orphaned object; publish/hide stays explicit', async () => {
  const store = memory([{ id: 1, courseId: 5, reviewType: 'VIDEO', reviewerName: 'Dr. A', quote: '', rating: 5, isPublished: true, isDemo: false, videoObjectKey: KEY(5, 1), videoUrl: null, videoThumbnailUrl: '/uploads/thumbnails/0b9b1d58-8a3d-4a0e-9d5c-6f1a2b3c4d5e.jpg' }]);
  const restore = swap(prisma, 'courseTestimonial', store);
  try {
    const newKey = `courses/5/testimonials/1/11111111-2222-4333-8444-555555555555.mp4`;
    let r = await landing.updateTestimonial(5, 1, { videoObjectKey: newKey });
    assert.equal(r.orphanedVideoKey, KEY(5, 1), 'replaced upload must be cleaned up');
    assert.equal(r.videoObjectKey, newKey);
    // editing the name alone never hides it or drops the video
    r = await landing.updateTestimonial(5, 1, { reviewerName: 'Dr. A Renamed' });
    assert.equal(r.isPublished, true);
    assert.equal(r.videoObjectKey, newKey);
    // hide / publish
    r = await landing.updateTestimonial(5, 1, { isPublished: ['false'] });
    assert.equal(r.isPublished, false);
    r = await landing.updateTestimonial(5, 1, { isPublished: ['false', 'on'] });
    assert.equal(r.isPublished, true);
    // VIDEO without any video left is rejected
    await assert.rejects(() => landing.updateTestimonial(5, 1, { removeVideo: ['false', 'on'] }), /need a video/i);
    // switch to TEXT: quote required; video fields cleared and old object reported
    await assert.rejects(() => landing.updateTestimonial(5, 1, { reviewType: 'TEXT' }), /quote is required/i);
    r = await landing.updateTestimonial(5, 1, { reviewType: 'TEXT', quote: 'now text' });
    assert.equal(r.videoObjectKey, null);
    assert.equal(r.orphanedVideoKey, newKey);
    assert.ok(r.orphanedThumbnailUrl);
    // delete reports files to remove
    const gone = await landing.deleteTestimonial(5, 1);
    assert.equal(store.rows.length, 0);
    assert.ok('orphanedVideoKey' in gone);
  } finally { restore(); }
});

test('cross-course ownership: a review of course A cannot be edited, hidden or deleted via course B', async () => {
  const store = memory([{ id: 1, courseId: 5, reviewType: 'TEXT', reviewerName: 'x', quote: 'q', isPublished: true, sortOrder: 10 }]);
  const restore = swap(prisma, 'courseTestimonial', store);
  try {
    await assert.rejects(() => landing.updateTestimonial(99, 1, { isPublished: 'false' }), (e) => e.statusCode === 403);
    await assert.rejects(() => landing.updateTestimonial(99, 1, { reviewType: 'VIDEO', videoObjectKey: KEY(99) }), (e) => e.statusCode === 403);
    await assert.rejects(() => landing.deleteTestimonial(99, 1), (e) => e.statusCode === 403);
    await assert.rejects(() => landing.moveTestimonial(99, 1, 'up'), (e) => e.statusCode === 403);
    assert.equal(store.rows[0].isPublished, true);
  } finally { restore(); }
});

// ---------------------------------------------------------------------------
// Controller: checkbox pairs are parsed explicitly (regression for "hide never works")
// ---------------------------------------------------------------------------
test('review controller hides/publishes from the checkbox pair and adopts uploaded media', async () => {
  const controller = require('../src/controllers/admin/courseLanding.controller');
  const store = memory([{ id: 1, courseId: 5, reviewType: 'TEXT', reviewerName: 'Dr. A', quote: 'q', rating: 5, isPublished: true, isDemo: false }]);
  const restore = swap(prisma, 'courseTestimonial', store);
  const mkRes = () => { const r = { redirected: null, redirect(u) { r.redirected = u; } }; return r; };
  const mkReq = (body, files) => ({ params: { courseId: '5', testimonialId: '1' }, body, files, flash: [], testimonialMediaAdopted: { video: false, thumbnail: false }, flashSuccess() {}, flashError(m) { this.flash.push(m); } });
  try {
    let req = mkReq({ formSubmitted: '1', reviewerName: 'Dr. A', quote: 'q', isPublished: 'false', isDemo: 'false' });
    await controller.updateTestimonial(req, mkRes());
    assert.deepEqual(req.flash, []);
    assert.equal(store.rows[0].isPublished, false, 'unticked Published must hide the review');

    req = mkReq({ formSubmitted: '1', isPublished: ['false', 'on'], isDemo: ['false', 'on'] });
    await controller.updateTestimonial(req, mkRes());
    assert.equal(store.rows[0].isPublished, true);
    assert.equal(store.rows[0].isDemo, true);

    // an uploaded hosted video becomes the object key (adopted so cleanup keeps it)
    req = mkReq({ formSubmitted: '1', reviewType: 'VIDEO', isPublished: ['false', 'on'], isDemo: ['false', 'on'] }, { video: [{ r2Key: KEY(5, 1) }] });
    await controller.updateTestimonial(req, mkRes());
    assert.deepEqual(req.flash, []);
    assert.equal(store.rows[0].videoObjectKey, KEY(5, 1));
    assert.deepEqual(req.testimonialMediaAdopted, { video: true, thumbnail: true });

    // validation failure leaves media un-adopted so the middleware deletes the upload
    req = mkReq({ formSubmitted: '1', reviewType: 'TEXT_VIDEO', quote: '', isPublished: ['false', 'on'] }, { video: [{ r2Key: KEY(5, 1) }] });
    await controller.updateTestimonial(req, mkRes());
    assert.equal(req.flash.length, 1);
    assert.deepEqual(req.testimonialMediaAdopted, { video: false, thumbnail: false });
  } finally { restore(); }
});

// ---------------------------------------------------------------------------
// Public shaping + demo safety + metrics
// ---------------------------------------------------------------------------
test('public shape never exposes the object key or raw video URL', () => {
  const hosted = tv.toPublicTestimonial({ id: 1, reviewType: 'VIDEO', videoObjectKey: KEY(5, 1), videoUrl: null, quote: '' });
  assert.equal(hosted.hasVideo, true);
  assert.equal(hosted.videoKind, 'hosted');
  assert.ok(!('videoObjectKey' in hosted) && !('videoUrl' in hosted));
  assert.ok(!JSON.stringify(hosted).includes('courses/'));
  const emb = tv.toPublicTestimonial({ id: 2, reviewType: 'TEXT_VIDEO', videoUrl: 'https://youtu.be/dQw4w9WgXcQ', quote: 'q' });
  assert.equal(emb.videoKind, 'embed');
  assert.equal(emb.embedUrl, 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  const text = tv.toPublicTestimonial({ id: 3, reviewType: 'TEXT', videoUrl: 'https://youtu.be/dQw4w9WgXcQ', quote: 'q' });
  assert.equal(text.hasVideo, false, 'TEXT reviews never show video even if data lingers');
  const broken = tv.toPublicTestimonial({ id: 4, reviewType: 'VIDEO', videoObjectKey: 'courses/5/lessons/9/0b9b1d58-8a3d-4a0e-9d5c-6f1a2b3c4d5e.mp4' });
  assert.equal(broken.hasVideo, false, 'a protected lesson key is never treated as a testimonial video');
});

async function publicData(rows, { includeDemo = false } = {}) {
  const empty = async () => [];
  const restores = [
    swap(prisma.courseLandingContent, 'findUnique', async () => ({ socialProofMode: 'AUTO', socialProofEnabled: true })),
    swap(prisma.courseHeroChip, 'findMany', empty), swap(prisma.courseTakeaway, 'findMany', empty), swap(prisma.courseQuestion, 'findMany', empty),
    swap(prisma.courseAudienceItem, 'findMany', empty), swap(prisma.courseFaq, 'findMany', empty), swap(prisma.courseWhyRegisterItem, 'findMany', empty),
    swap(prisma.courseHighlight, 'findMany', empty), swap(prisma.courseAccessPlan, 'findMany', empty), swap(prisma.courseStat, 'findMany', empty),
    swap(prisma.courseComparisonColumn, 'findMany', empty), swap(prisma.courseAccessStep, 'findMany', empty), swap(prisma.courseLandingSection, 'findMany', empty),
    swap(prisma.courseTestimonial, 'findMany', async ({ where }) => rows.filter((r) => r.isPublished && (where.isDemo === false ? !r.isDemo : true))),
    swap(prisma.courseTestimonial, 'aggregate', async () => {
      const real = rows.filter((r) => r.isPublished && !r.isDemo);
      return { _count: { id: real.length }, _avg: { rating: real.length ? real.reduce((a, r) => a + r.rating, 0) / real.length : null } };
    }),
  ];
  try { return await landing.getPublicLandingData(5, { includeDemo }); } finally { restores.reverse().forEach((r) => r()); }
}

const rv = (id, extra) => ({ id, courseId: 5, reviewType: 'TEXT', reviewerName: `Dr ${id}`, quote: `quote ${id}`, rating: 5, isPublished: true, isDemo: false, sortOrder: id, featuredOnHome: true, ...extra });

test('demo video review: hidden publicly, visible in Admin Preview, excluded from count/average/social proof', async () => {
  const rows = [
    rv(1, { rating: 5 }),
    rv(2, { reviewType: 'VIDEO', quote: '', videoObjectKey: KEY(5, 2), rating: 4 }),
    rv(3, { reviewType: 'VIDEO', quote: '', videoObjectKey: KEY(5, 3), rating: 1, isDemo: true }),
  ];
  const pub = await publicData(rows, { includeDemo: false });
  assert.deepEqual(pub.testimonials.map((t) => t.id), [1, 2], 'demo video hidden from the public');
  const preview = await publicData(rows, { includeDemo: true });
  assert.deepEqual(preview.testimonials.map((t) => t.id).sort(), [1, 2, 3], 'Admin Preview sees the demo video');
  for (const d of [pub, preview]) {
    assert.equal(d.realReviewCount, 2, 'text + genuine video count equally; demo excluded');
    assert.equal(d.realAverageRating, 4.5, 'average of genuine published reviews only (5 and 4)');
    assert.match(d.content.socialProofValue, /^2\+/, 'social proof counts genuine reviews only');
    assert.ok(!JSON.stringify(d).includes('courses/5/testimonials'), 'no object key anywhere in public data');
  }
});

test('hidden (unpublished) video reviews are never public', async () => {
  const pub = await publicData([rv(1, { reviewType: 'VIDEO', quote: '', videoObjectKey: KEY(5, 1), isPublished: false })]);
  assert.equal(pub.testimonials.length, 0);
  assert.equal(pub.realReviewCount, 0);
});

test('JSON-LD for the course page carries no review data (demo or video)', () => {
  const src = fs.readFileSync(path.join(root, 'src/controllers/course.controller.js'), 'utf8');
  const ld = src.slice(src.indexOf('const jsonLd'), src.indexOf("res.render('public/course-detail'"));
  assert.ok(ld.length > 50);
  assert.ok(!/review|aggregateRating|testimonial|video/i.test(ld), 'JSON-LD must not include reviews/ratings/video');
});

// ---------------------------------------------------------------------------
// Rendering: course page + homepage + modal markup
// ---------------------------------------------------------------------------
function renderCourse(testimonials) {
  const shaped = testimonials.map(tv.toPublicTestimonial);
  return ejs.render(courseView, {
    cms: { course: {}, brand: {} },
    course: { id: 5, title: 'C', slug: 'c', price: 0, currency: 'INR', shortDescription: '', description: '', category: null, lessons: [], instructor: null },
    isFree: true, priceLabel: 'Free', isEnrolled: false, hasPendingRequest: false, paymentsEnabled: false,
    stats: { publishedModuleCount: 1, publishedLessonCount: 1, totalDurationFormatted: '1h', resourceCount: 0, videoCount: 1 },
    curriculum: [], resources: [], faqs: [], csrfToken: 't', cspNonce: 'n',
    landing: {
      content: { reviewsEnabled: true, reviewsHeading: 'Reviews' }, testimonials: shaped, heroChips: [], stats: [], takeaways: [], questions: [],
      audienceFor: [], audienceNotFor: [], faqs: [], whyRegisterWant: [], whyRegisterGet: [], highlights: [], accessPlans: [], comparisonColumns: [],
      accessSteps: [], renderList: ['REVIEWS'], landingSections: ['REVIEWS'], realReviewCount: 3,
    },
  });
}

test('course page: text, video and text+video cards render; video opens a modal (no raw key, no autoplay)', () => {
  const html = renderCourse([
    rv(1, { quote: 'Plain text praise' }),
    rv(2, { reviewType: 'VIDEO', quote: '', videoObjectKey: KEY(5, 2), videoThumbnailUrl: '/uploads/thumbnails/0b9b1d58-8a3d-4a0e-9d5c-6f1a2b3c4d5e.jpg', reviewerName: 'Dr Video' }),
    rv(3, { reviewType: 'TEXT_VIDEO', quote: 'Both quote and clip', videoUrl: 'https://youtu.be/dQw4w9WgXcQ', reviewerName: 'Dr Both' }),
  ]);
  assert.match(html, /Plain text praise/);
  assert.equal((html.match(/data-testimonial-video/g) || []).length, 2, 'two video triggers (video + text+video)');
  assert.match(html, /data-kind="hosted" data-id="2"/);
  assert.match(html, /data-kind="embed" data-id="3" data-embed="https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ"/);
  assert.match(html, /Both quote and clip/, 'TEXT_VIDEO shows its quote too');
  assert.match(html, /review-video-play/);
  assert.match(html, /<img src="\/uploads\/thumbnails\/0b9b1d58[^"]+" alt="" loading="lazy">/, 'uploaded thumbnail used');
  assert.match(html, /review-video-poster/, 'default poster when no thumbnail');
  assert.match(html, /<script src="\/js\/testimonial-player\.js" defer><\/script>/);
  assert.ok(!html.includes('courses/5/testimonials'), 'object key must never be in the page');
  assert.ok(!/autoplay/i.test(html), 'no autoplay');
  assert.ok(!/<video/i.test(html), 'the player is created only after a click');
});

test('course page without video reviews does not load the player script', () => {
  const html = renderCourse([rv(1, { quote: 'Only text' })]);
  assert.ok(!html.includes('testimonial-player.js'));
  assert.ok(!html.includes('data-testimonial-video'));
});

test('homepage reviews: video cards render beside text cards and use the same records', () => {
  const rows = [
    { ...rv(1, { quote: 'Home text' }), course: { title: 'C', slug: 'c' } },
    { ...rv(2, { reviewType: 'VIDEO', quote: '', videoObjectKey: KEY(5, 2) }), course: { title: 'C', slug: 'c' } },
    { ...rv(3, { reviewType: 'VIDEO', quote: '', videoObjectKey: null }), course: { title: 'C', slug: 'c' } },
    { ...rv(4, { reviewType: 'VIDEO', quote: '', videoObjectKey: KEY(5, 4), isDemo: true }), course: { title: 'C', slug: 'c' } },
  ];
  const list = homeReviews.selectHomeReviews(rows, { sourceMode: 'ALL_APPROVED' });
  assert.deepEqual(list.map((r) => r.id), [1, 2], 'video without a playable source and demo reviews are not shown');
  assert.equal(list[1].hasVideo, true);
  assert.ok(!JSON.stringify(list).includes('courses/5/testimonials'));
  const html = ejs.render(fs.readFileSync(path.join(root, 'views/partials/home-reviews.ejs'), 'utf8'), {
    homeReviews: list, homeReviewSettings: { enabled: true, heading: 'Learners', subheading: '' },
  });
  assert.match(html, /Home text/);
  assert.match(html, /class="home-review-video" data-testimonial-video data-kind="hosted" data-id="2"/);
  assert.match(html, /testimonial-player\.js/);
  assert.ok(!/autoplay/i.test(html));
  const showcase = homeReviews.selectHomeReviews(rows, { sourceMode: 'ALL_APPROVED' }, { includeDemo: true });
  assert.ok(!showcase.some((r) => r.id === 4), 'a demo VIDEO review is never public, even in demo-showcase mode');
  const demoText = homeReviews.selectHomeReviews([{ ...rv(9, { isDemo: true, quote: 'demo text' }), course: { title: 'C', slug: 'c' } }], { sourceMode: 'ALL_APPROVED' }, { includeDemo: true });
  assert.equal(demoText.length, 1, 'existing text-demo showcase behaviour is unchanged');
});

// ---------------------------------------------------------------------------
// Public delivery endpoint
// ---------------------------------------------------------------------------
test('video-source endpoint: only published, genuine, testimonial-prefixed videos are signed', async () => {
  const controller = require('../src/controllers/testimonialMedia.controller');
  const videoStorageSettings = require('../src/services/videoStorageSettings.service');
  let signed = [];
  const rows = {
    1: { id: 1, reviewType: 'VIDEO', isPublished: true, isDemo: false, videoObjectKey: KEY(5, 1), course: { status: 'PUBLISHED' } },
    2: { id: 2, reviewType: 'VIDEO', isPublished: false, isDemo: false, videoObjectKey: KEY(5, 2), course: { status: 'PUBLISHED' } },
    3: { id: 3, reviewType: 'VIDEO', isPublished: true, isDemo: true, videoObjectKey: KEY(5, 3), course: { status: 'PUBLISHED' } },
    4: { id: 4, reviewType: 'VIDEO', isPublished: true, isDemo: false, videoObjectKey: 'courses/5/lessons/9/0b9b1d58-8a3d-4a0e-9d5c-6f1a2b3c4d5e.mp4', course: { status: 'PUBLISHED' } },
    5: { id: 5, reviewType: 'VIDEO', isPublished: true, isDemo: false, videoObjectKey: KEY(5, 5), course: { status: 'DRAFT' } },
    6: { id: 6, reviewType: 'TEXT', isPublished: true, isDemo: false, videoObjectKey: KEY(5, 6), course: { status: 'PUBLISHED' } },
  };
  const restores = [
    swap(prisma.courseTestimonial, 'findUnique', async ({ where }) => rows[where.id] || null),
    swap(prisma.siteSetting, 'findUnique', async () => ({ value: 'true' })), // demo-showcase switch ON must not matter
    swap(videoStorageSettings, 'getR2ConfigOrNull', async () => ({ bucket: 'b', accountId: 'a', accessKeyId: 'k', secretAccessKey: 's' })),
    swap(r2, 'signedGetUrl', async (_cfg, key) => { signed.push(key); return { url: 'https://acct.r2.cloudflarestorage.com/signed', expiresInSeconds: 600 }; }),
  ];
  const call = async (id, currentUser) => {
    const res = { code: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await controller.getTestimonialVideoSource({ params: { id: String(id) }, currentUser }, res, (e) => { throw e; });
    return res;
  };
  try {
    const ok = await call(1);
    assert.equal(ok.code, 200);
    assert.match(ok.body.url, /^https:\/\//);
    assert.equal(ok.headers['Cache-Control'], 'private, no-store, max-age=0');
    assert.ok(!('key' in ok.body) && !JSON.stringify(ok.body).includes('courses/'));
    assert.equal((await call(2)).code, 404, 'hidden review');
    assert.equal((await call(3)).code, 404, 'demo review, anonymous (even with the showcase switch on)');
    assert.equal((await call(3, { role: 'STUDENT' })).code, 404, 'demo review, student');
    assert.equal((await call(3, { role: 'ADMIN' })).code, 200, 'demo review, Admin preview');
    assert.equal((await call(4)).code, 404, 'protected lesson key must never be signed here');
    assert.equal((await call(5)).code, 404, 'draft course');
    assert.equal((await call(6)).code, 404, 'text review');
    assert.equal((await call('abc')).code, 404);
    assert.deepEqual(signed, [KEY(5, 1), KEY(5, 3)]);
  } finally { restores.reverse().forEach((r) => r()); }
});

test('testimonial media middleware is wired before CSRF on the review routes and CSP allows R2 media', () => {
  const routes = fs.readFileSync(path.join(root, 'src/routes/admin.routes.js'), 'utf8');
  assert.match(routes, /reviews', uploadTestimonialMedia\(\), doubleCsrfProtection, courseLandingController\.createTestimonial/);
  assert.match(routes, /reviews\/:testimonialId\/edit', uploadTestimonialMedia\(\), doubleCsrfProtection, courseLandingController\.updateTestimonial/);
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /'media-src': \["'self'", 'https:\/\/\*\.r2\.cloudflarestorage\.com'\]/);
  assert.match(server, /app\.use\('\/api\/testimonials'/);
});

test('Admin review forms are multipart with type, upload, link, thumbnail and explicit publish state', async () => {
  const html = await ejs.renderFile(path.join(root, 'views/admin/courses/landing-page-content.ejs'), {
    csrfToken: 't', activeTab: 'reviews',
    course: { id: 5, title: 'C', slug: 'c', status: 'PUBLISHED', instructor: null }, landingContent: {},
    heroChips: [], takeaways: [], questions: [], audienceItems: [], faqs: [], whyRegisterItems: [], highlights: [], accessPlans: [], courseStats: [],
    comparisonColumns: [], accessSteps: [], landingSections: [], resources: [],
    testimonials: [rv(1, { reviewType: 'TEXT_VIDEO', videoObjectKey: KEY(5, 1), sortOrder: 1 })],
  });
  assert.equal((html.match(/enctype="multipart\/form-data"/g) || []).length >= 2, true);
  for (const needle of ['name="reviewType"', 'name="video"', 'name="videoUrl"', 'name="thumbnail"', 'name="removeVideo"', 'Hosted video uploaded']) assert.ok(html.includes(needle), needle);
  assert.match(html, /<option value="TEXT_VIDEO" selected>/);
});

test('course controller strips demo VIDEO reviews even in demo-showcase mode (source guard)', () => {
  const src = fs.readFileSync(path.join(root, 'src/controllers/course.controller.js'), 'utf8');
  const i = src.indexOf('Demo VIDEO testimonials');
  assert.ok(i > 0);
  assert.match(src.slice(i, i + 400), /filter\(\(t\) => !\(t\.isDemo && t\.hasVideo\)\)/);
  assert.ok(src.indexOf('filter((t) => !(t.isDemo && t.hasVideo))') < src.indexOf('isDemo: false'), 'filter runs before demo marking is removed');
});
