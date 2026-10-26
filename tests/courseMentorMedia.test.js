process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

// Per-course mentor photo / video (course landing Mentor section): DEFAULT keeps today's markup, PHOTO override,
// VIDEO card (muted autoplay option), per-course isolation, safe public delivery, validation, patch saves,
// replace/remove + cleanup, admin wiring and the source-of-truth chain.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const { prisma } = require('../src/config/db');
const r2 = require('../src/lib/r2');
const svc = require('../src/services/courseMentorMedia.service');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').split('\r\n').join('\n');

const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const MENTOR_KEY = (courseId = 5, ext = '.mp4') => r2.buildMentorObjectKey(courseId, ext);
const LESSON_KEY = `courses/5/lessons/9/${UUID}.mp4`;
const TESTIMONIAL_KEY = `courses/5/testimonials/3/${UUID}.mp4`;
const DOCTOR_KEY = `site/doctor/${UUID}.mp4`;
const PROMO_KEY = `site/promo/${UUID}.mp4`;
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const VIMEO = 'https://vimeo.com/76979871';

function swap(obj, key, impl) {
  const orig = obj[key];
  obj[key] = impl;
  return () => { obj[key] = orig; };
}

// In-memory course_mentor_media rows keyed by courseId + a course table (ids 5 and 6 exist)
function memoryDb(initial = {}) {
  const state = { rows: { ...initial } };
  const restores = [
    swap(prisma.course, 'findUnique', async ({ where }) => ([5, 6].includes(where.id) ? { id: where.id } : null)),
    swap(prisma.courseMentorMedia, 'findUnique', async ({ where }) => state.rows[where.courseId] || null),
    swap(prisma.courseMentorMedia, 'upsert', async ({ where, create, update }) => {
      const cur = state.rows[where.courseId];
      state.rows[where.courseId] = cur ? { ...cur, ...update } : { id: where.courseId, ...create };
      return state.rows[where.courseId];
    }),
    swap(prisma.courseMentorMedia, 'delete', async ({ where }) => { delete state.rows[where.courseId]; return {}; }),
  ];
  state.restore = () => restores.reverse().forEach((r) => r());
  return state;
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------
test('mentor R2 key: own prefix, bound to ITS course, never a lesson/testimonial/doctor/promo key, not an "owned lesson" key', () => {
  const k = MENTOR_KEY(5);
  assert.match(k, /^courses\/5\/mentor\/[0-9a-f-]{36}\.mp4$/);
  assert.ok(r2.isMentorObjectKey(k));
  assert.ok(r2.isMentorObjectKey(k, 5));
  assert.ok(r2.isMentorObjectKey(k, '5'));
  assert.equal(r2.isMentorObjectKey(k, 6), false, 'another course never matches');
  assert.ok(r2.isMentorObjectKey(MENTOR_KEY(7, '.webm'), 7));
  for (const bad of [LESSON_KEY, TESTIMONIAL_KEY, DOCTOR_KEY, PROMO_KEY, 'courses/5/mentor/../x.mp4', 'courses/5/mentor/not-a-uuid.mp4', `courses/5/mentor/${UUID}.exe`, '', null, undefined, 42, `${k}x`]) {
    assert.equal(r2.isMentorObjectKey(bad), false, String(bad));
  }
  assert.equal(r2.isOwnedObjectKey(k), false, 'mentor keys are NOT part of the lesson-owned key set');
  for (const other of [LESSON_KEY, TESTIMONIAL_KEY, DOCTOR_KEY, PROMO_KEY]) assert.equal(r2.isMentorObjectKey(other), false);
  assert.throws(() => r2.buildMentorObjectKey(0, '.mp4'), /Invalid course id/);
  assert.throws(() => r2.buildMentorObjectKey(5, '.exe'), /Unsupported/);
});

// ---------------------------------------------------------------------------
// Public view-model
// ---------------------------------------------------------------------------
test('no row / DEFAULT / unusable settings => null (the page keeps today\'s mentor photo markup)', () => {
  assert.equal(svc.toPublicCourseMentorMedia(null, 5, '/p.jpg', 'Dr T'), null);
  assert.equal(svc.toPublicCourseMentorMedia({ mediaMode: 'DEFAULT', photoUrl: '/uploads/thumbnails/a.jpg', videoType: 'YOUTUBE', videoUrl: YT }, 5), null, 'DEFAULT ignores any stored media');
  assert.equal(svc.toPublicCourseMentorMedia({ mediaMode: 'PHOTO' }, 5), null, 'PHOTO without an uploaded photo');
  assert.equal(svc.toPublicCourseMentorMedia({ mediaMode: 'VIDEO', videoType: null }, 5), null, 'VIDEO without a playable video');
  assert.equal(svc.toPublicCourseMentorMedia({ mediaMode: 'VIDEO', videoType: 'UPLOAD', videoObjectKey: LESSON_KEY }, 5), null, 'a lesson key is not playable');
  assert.equal(svc.toPublicCourseMentorMedia({ mediaMode: 'VIDEO', videoType: 'UPLOAD', videoObjectKey: MENTOR_KEY(6) }, 5), null, 'another course\'s mentor key is not playable');
});

test('PHOTO + VIDEO view-models: shapes, per-course endpoint url, no object key / raw url leak', () => {
  const photo = svc.toPublicCourseMentorMedia({ mediaMode: 'PHOTO', photoUrl: '/uploads/thumbnails/a.jpg' }, 5, '/p.jpg', 'Dr T');
  assert.equal(photo.mode, 'PHOTO');
  assert.equal(photo.photoUrl, '/uploads/thumbnails/a.jpg');
  assert.equal(photo.video, null);

  const embed = svc.toPublicCourseMentorMedia({ mediaMode: 'VIDEO', videoType: 'YOUTUBE', videoUrl: YT, caption: ' Hello ', posterUrl: '/uploads/thumbnails/p.jpg' }, 5, '/p.jpg', 'Dr T');
  assert.equal(embed.mode, 'VIDEO');
  assert.equal(embed.video.kind, 'embed');
  assert.equal(embed.video.provider, 'youtube');
  assert.match(embed.video.embedUrl, /^https:\/\/www\.youtube(-nocookie)?\.com\/embed\/dQw4w9WgXcQ/);
  assert.equal(embed.caption, 'Hello');
  assert.equal(svc.toPublicCourseMentorMedia({ mediaMode: 'VIDEO', videoType: 'VIMEO', videoUrl: VIMEO }, 5).video.provider, 'vimeo');

  const key = MENTOR_KEY(5);
  const hosted = svc.toPublicCourseMentorMedia({ mediaMode: 'VIDEO', videoType: 'UPLOAD', videoObjectKey: key }, 5, '/p.jpg', 'Dr T');
  assert.equal(hosted.video.kind, 'hosted');
  assert.equal(hosted.sourceUrl, '/api/courses/5/mentor-video/source');
  assert.ok(!JSON.stringify(hosted).includes('/mentor/'), 'object key must not leak');
  assert.ok(!JSON.stringify(embed).includes('videoUrl'));
});

// ---------------------------------------------------------------------------
// Rendering on the course landing page
// ---------------------------------------------------------------------------
const viewPath = path.join(root, 'views/public/course-detail-content.ejs');
const INSTRUCTOR = { name: 'Dr. Tanu Raghav', photoUrl: '/uploads/thumbnails/doctor-own.jpg', experienceLabel: '11+ Years', designation: 'Prosthodontist', credentials: [] };

function renderCourse(extra = {}) {
  return ejs.render(read('views/public/course-detail-content.ejs'), {
    cms: { course: {}, brand: {} },
    course: { id: 5, title: 'FMR', slug: 'fmr', price: 24999, salePrice: 7999, currency: 'INR', shortDescription: '', description: '', category: null, thumbnailUrl: null, lessons: [], instructor: INSTRUCTOR },
    isFree: false, priceLabel: '₹7,999', isEnrolled: false, hasPendingRequest: false, paymentsEnabled: true,
    stats: { publishedModuleCount: 1, publishedLessonCount: 3, totalDurationFormatted: '1h', resourceCount: 0, videoCount: 3 },
    curriculum: [], resources: [], faqs: [], csrfToken: 't', cspNonce: 'n',
    landing: {
      content: { heroEnabled: true, mentorSectionEnabled: true, mentorEyebrow: 'Your mentor', mentorHeading: 'Meet your mentor' },
      heroChips: [], stats: [], takeaways: [], questions: [], audienceFor: [], audienceNotFor: [], faqs: [], whyRegisterWant: [], whyRegisterGet: [],
      highlights: [], testimonials: [], accessPlans: [], comparisonColumns: [], accessSteps: [], realReviewCount: 0,
      renderList: ['MENTOR'], landingSections: ['MENTOR'],
    },
    ...extra,
  }, { filename: viewPath });
}

test('DEFAULT renders exactly today\'s mentor markup: null === undefined === DEFAULT mode, no video assets', () => {
  const missing = renderCourse();
  const nul = renderCourse({ courseMentorMedia: null });
  const def = renderCourse({ courseMentorMedia: svc.toPublicCourseMentorMedia({ mediaMode: 'DEFAULT' }, 5, '/p.jpg', 'Dr') });
  assert.equal(missing, nul);
  assert.equal(missing, def);
  assert.match(missing, /<div class="mentor-portrait-card">\s*<img src="\/uploads\/thumbnails\/doctor-own\.jpg"\s+alt="Dr\. Tanu Raghav"\s+loading="lazy"/);
  assert.match(missing, /mentor-exp-badge/);
  assert.doesNotMatch(missing, /doctor-media|data-intro-reel|mentor-media-video/);
});

test('PHOTO override replaces the instructor photo in the course mentor card (same card chrome)', () => {
  const vm = svc.toPublicCourseMentorMedia({ mediaMode: 'PHOTO', photoUrl: '/uploads/thumbnails/override.jpg' }, 5, '/uploads/thumbnails/doctor-own.jpg', 'Dr');
  const html = renderCourse({ courseMentorMedia: vm });
  assert.match(html, /<div class="mentor-portrait-card">\s*<img src="\/uploads\/thumbnails\/override\.jpg"/);
  const mentor = html.slice(html.indexOf('class="mentor-layout"'), html.indexOf('class="mentor-details"'));
  assert.ok(!mentor.includes('doctor-own.jpg'), 'the override replaces the instructor photo inside the mentor card');
  assert.doesNotMatch(html, /data-intro-reel/);
});

test('VIDEO card: poster + labelled play button, nothing loaded before start, course endpoint for hosted, theme classes', () => {
  const embed = renderCourse({ courseMentorMedia: svc.toPublicCourseMentorMedia({ mediaMode: 'VIDEO', videoType: 'YOUTUBE', videoUrl: YT, caption: 'From your mentor', posterUrl: '/uploads/thumbnails/poster.jpg' }, 5, '/uploads/thumbnails/doctor-own.jpg', 'Dr. Tanu Raghav') });
  assert.match(embed, /class="mentor-media-video"/);
  assert.match(embed, /doctor-media--course/);
  assert.match(embed, /data-intro-reel/);
  assert.match(embed, /data-kind="embed"/);
  assert.match(embed, /data-embed="https:\/\/www\.youtube(-nocookie)?\.com\/embed\/dQw4w9WgXcQ/);
  assert.match(embed, /aria-label="Play video: Dr\. Tanu Raghav"/);
  assert.ok(embed.includes('/uploads/thumbnails/poster.jpg'));
  assert.match(embed, /From your mentor/);
  assert.doesNotMatch(embed, /<iframe|<video\b/i, 'no iframe / video element in the initial HTML');
  assert.doesNotMatch(embed, /autoplay=/i);
  assert.match(embed, /data-muted-start="1"/, 'muted autoplay on by default');
  assert.match(embed, /data-autoplay-mobile="1"/);
  assert.match(embed, /data-loop="0"/);
  assert.match(embed, /mentor-exp-badge/, 'experience badge still shown (below the card)');
  assert.doesNotMatch(embed, /class="mentor-portrait-card"/, 'the photo card is replaced');

  const hosted = renderCourse({ courseMentorMedia: svc.toPublicCourseMentorMedia({ mediaMode: 'VIDEO', videoType: 'UPLOAD', videoObjectKey: MENTOR_KEY(5) }, 5, '', 'Dr') });
  assert.match(hosted, /data-kind="hosted"/);
  assert.match(hosted, /data-source-url="\/api\/courses\/5\/mentor-video\/source"/);
  assert.ok(!hosted.includes('/mentor/') && !hosted.includes('.mp4'), 'no object key / file name in the page');
});

test('autoplay and loop are options rendered into the card', () => {
  const off = renderCourse({ courseMentorMedia: svc.toPublicCourseMentorMedia({ mediaMode: 'VIDEO', videoType: 'YOUTUBE', videoUrl: YT, autoplayMuted: false, loopVideo: true }, 5, '', 'Dr') });
  assert.match(off, /data-muted-start="0"/);
  assert.match(off, /data-loop="1"/);
  assert.equal(svc.DEFAULTS.autoplayMuted, true);
  assert.equal(svc.DEFAULTS.loopVideo, false);
});

test('the shared partial keeps the global doctor endpoint as its default source', async () => {
  const dm = { mode: 'VIDEO', photoUrl: '', caption: '', fallbackPhotoUrl: '', fallbackAlt: 'Dr', video: { kind: 'hosted', embedUrl: null, provider: null, posterUrl: '', autoplayMuted: true, loop: false } };
  const html = await ejs.renderFile(path.join(root, 'views/partials/doctor-media.ejs'), { dm, variant: 'mentor', name: 'Dr' });
  assert.match(html, /data-source-url="\/api\/home\/doctor-video\/source"/);
  const course = await ejs.renderFile(path.join(root, 'views/partials/doctor-media.ejs'), { dm, variant: 'course', name: 'Dr', sourceUrl: '/api/courses/5/mentor-video/source' });
  assert.match(course, /data-source-url="\/api\/courses\/5\/mentor-video\/source"/);
});

// ---------------------------------------------------------------------------
// Per-course isolation + ownership
// ---------------------------------------------------------------------------
test('per-course isolation: course A video, course B default; saving one never touches the other', async () => {
  const db = memoryDb();
  try {
    await svc.saveCourseMentorMedia(5, { mediaMode: 'VIDEO', videoUrl: YT, caption: 'A only' });
    const a = await svc.getPublicCourseMentorMedia(5, '/p.jpg', 'Dr');
    const b = await svc.getPublicCourseMentorMedia(6, '/p.jpg', 'Dr');
    assert.equal(a.mode, 'VIDEO');
    assert.equal(a.caption, 'A only');
    assert.equal(b, null, 'course B keeps the default look');
    assert.equal(db.rows[6], undefined, 'no row created for B');
    await svc.saveCourseMentorMedia(6, { mediaMode: 'PHOTO', photoUrl: '/uploads/thumbnails/b.jpg' });
    assert.equal((await svc.getPublicCourseMentorMedia(5)).mode, 'VIDEO');
    assert.equal((await svc.getPublicCourseMentorMedia(6)).mode, 'PHOTO');
    assert.equal(db.rows[5].photoUrl ?? null, null, 'A unchanged by B');
  } finally { db.restore(); }
});

test('ownership: unknown course 404s; a hosted key must be a mentor key of THIS course', async () => {
  const db = memoryDb();
  try {
    await assert.rejects(() => svc.saveCourseMentorMedia(999, { mediaMode: 'PHOTO' }), (e) => e instanceof svc.CourseMentorMediaError && e.status === 404);
    await assert.rejects(() => svc.saveCourseMentorMedia('abc', {}), /Invalid course id/);
    await assert.rejects(() => svc.resetCourseMentorMedia(999), /Course not found/);
    for (const bad of [LESSON_KEY, TESTIMONIAL_KEY, DOCTOR_KEY, PROMO_KEY, MENTOR_KEY(6)]) {
      await assert.rejects(() => svc.saveCourseMentorMedia(5, { mediaMode: 'VIDEO' }, { videoObjectKey: bad }), /Invalid hosted video reference/, bad);
    }
    assert.equal(Object.keys(db.rows).length, 0, 'nothing written on rejection');
    await svc.saveCourseMentorMedia(5, { mediaMode: 'VIDEO' }, { videoObjectKey: MENTOR_KEY(5) });
    assert.equal(db.rows[5].videoType, 'UPLOAD');
  } finally { db.restore(); }
});

// ---------------------------------------------------------------------------
// Validation + patch + replace/remove
// ---------------------------------------------------------------------------
test('validation: bad mode / url / caption / type are rejected and nothing is written', async () => {
  const db = memoryDb();
  try {
    await assert.rejects(() => svc.saveCourseMentorMedia(5, { mediaMode: 'GALLERY' }), /not an allowed option/);
    await assert.rejects(() => svc.saveCourseMentorMedia(5, { videoUrl: 'javascript:alert(1)' }), /YouTube or Vimeo/);
    await assert.rejects(() => svc.saveCourseMentorMedia(5, { videoUrl: 'https://evil.example/video.mp4' }), /YouTube or Vimeo/);
    await assert.rejects(() => svc.saveCourseMentorMedia(5, { caption: 'x'.repeat(201) }), /200 characters/);
    await assert.rejects(() => svc.saveCourseMentorMedia(5, { posterUrl: 'javascript:1' }), /Poster/);
    await assert.rejects(() => svc.saveCourseMentorMedia(5, { photoUrl: 'data:image/png;base64,xx' }), /Photo/);
    await assert.rejects(() => svc.saveCourseMentorMedia(5, { videoType: 'UPLOAD' }), /Upload a video file/);
    await assert.rejects(() => svc.saveCourseMentorMedia(5, { videoType: 'FLASH' }), /not an allowed option/);
    assert.equal(Object.keys(db.rows).length, 0);
  } finally { db.restore(); }
});

test('partial save: changing the caption or mode leaves video / poster / photo untouched; booleans are explicit', async () => {
  const db = memoryDb({ 5: { courseId: 5, mediaMode: 'VIDEO', videoType: 'YOUTUBE', videoUrl: YT, posterUrl: '/uploads/thumbnails/p.jpg', photoUrl: '/uploads/thumbnails/ph.jpg', caption: 'Old', autoplayMuted: true, loopVideo: false } });
  try {
    await svc.saveCourseMentorMedia(5, { caption: 'New' });
    assert.equal(db.rows[5].caption, 'New');
    assert.equal(db.rows[5].videoUrl, YT);
    assert.equal(db.rows[5].posterUrl, '/uploads/thumbnails/p.jpg');
    assert.equal(db.rows[5].photoUrl, '/uploads/thumbnails/ph.jpg');
    await svc.saveCourseMentorMedia(5, { mediaMode: 'PHOTO' });
    assert.equal(db.rows[5].videoUrl, YT, 'switching mode keeps the video for later');
    assert.equal(db.rows[5].autoplayMuted, true);
    await svc.saveCourseMentorMedia(5, { autoplayMuted: ['false'], loopVideo: ['false', 'true'] });
    assert.equal(db.rows[5].autoplayMuted, false);
    assert.equal(db.rows[5].loopVideo, true);
    await svc.saveCourseMentorMedia(5, { caption: '' });
    assert.equal(db.rows[5].caption, null, 'a cleared caption stays cleared (hidden)');
    assert.equal(db.rows[5].autoplayMuted, false, 'untouched');
  } finally { db.restore(); }
});

test('replace / remove semantics and orphan reporting for video, poster and photo; reset deletes the row', async () => {
  const oldKey = MENTOR_KEY(5);
  const db = memoryDb({ 5: { courseId: 5, mediaMode: 'VIDEO', videoType: 'UPLOAD', videoObjectKey: oldKey, posterUrl: '/uploads/thumbnails/old-poster.jpg', photoUrl: '/uploads/thumbnails/old-photo.jpg' } });
  try {
    // paste a link => the uploaded file is replaced + reported as orphan
    let r = await svc.saveCourseMentorMedia(5, { videoUrl: YT });
    assert.equal(r.row.videoType, 'YOUTUBE');
    assert.equal(r.row.videoObjectKey, null);
    assert.equal(r.orphanedVideoKey, oldKey);
    // upload a new file => the link is replaced
    const newKey = MENTOR_KEY(5, '.webm');
    r = await svc.saveCourseMentorMedia(5, {}, { videoObjectKey: newKey, posterUrl: '/uploads/thumbnails/new-poster.jpg' });
    assert.equal(r.row.videoType, 'UPLOAD');
    assert.ok(!r.row.videoUrl, 'the link is gone once a file is uploaded');
    assert.equal(r.orphanedPosterUrl, '/uploads/thumbnails/old-poster.jpg');
    // remove wins over the re-posted link box
    r = await svc.saveCourseMentorMedia(5, { removeVideo: 'true', videoUrl: YT, removePoster: 'true', removePhoto: 'true' });
    assert.equal(r.row.videoType, null);
    assert.equal(r.row.videoUrl, '');
    assert.equal(r.orphanedVideoKey, newKey);
    assert.equal(r.orphanedPosterUrl, '/uploads/thumbnails/new-poster.jpg');
    assert.equal(r.orphanedPhotoUrl, '/uploads/thumbnails/old-photo.jpg');
    // reset
    await svc.saveCourseMentorMedia(5, { photoUrl: '/uploads/thumbnails/z.jpg', mediaMode: 'PHOTO' });
    const reset = await svc.resetCourseMentorMedia(5);
    assert.equal(reset.orphanedPhotoUrl, '/uploads/thumbnails/z.jpg');
    assert.equal(db.rows[5], undefined);
    assert.equal(await svc.getPublicCourseMentorMedia(5), null);
  } finally { db.restore(); }
});

test('deleteHostedVideo only ever deletes mentor keys of that course', async () => {
  const videoStorageSettings = require('../src/services/videoStorageSettings.service');
  const deleted = [];
  const restores = [
    swap(videoStorageSettings, 'getR2ConfigOrNull', async () => ({ bucket: 'b' })),
    swap(r2, 'deleteObject', async (_c, k) => { deleted.push(k); }),
  ];
  try {
    const k = MENTOR_KEY(5);
    assert.equal(await svc.deleteHostedVideo(k, 5), true);
    for (const bad of [LESSON_KEY, TESTIMONIAL_KEY, DOCTOR_KEY, PROMO_KEY, MENTOR_KEY(6), 'x']) assert.equal(await svc.deleteHostedVideo(bad, 5), false);
    assert.deepEqual(deleted, [k]);
  } finally { restores.reverse().forEach((r) => r()); }
});

// ---------------------------------------------------------------------------
// Public signed-URL endpoint
// ---------------------------------------------------------------------------
test('mentor-video endpoint signs ONLY mentor keys of the SAME published course, only while displayed (or for an admin)', async () => {
  const controller = require('../src/controllers/courseMentorVideo.controller');
  const videoStorageSettings = require('../src/services/videoStorageSettings.service');
  const signed = [];
  const own = MENTOR_KEY(5);
  const rows = {
    5: { courseId: 5, mediaMode: 'VIDEO', videoObjectKey: own, course: { status: 'PUBLISHED' } },
    6: { courseId: 6, mediaMode: 'PHOTO', videoObjectKey: MENTOR_KEY(6), course: { status: 'PUBLISHED' } },
    7: { courseId: 7, mediaMode: 'VIDEO', videoObjectKey: MENTOR_KEY(7), course: { status: 'DRAFT' } },
    8: { courseId: 8, mediaMode: 'VIDEO', videoObjectKey: MENTOR_KEY(5), course: { status: 'PUBLISHED' } }, // another course's key
    9: { courseId: 9, mediaMode: 'VIDEO', videoObjectKey: LESSON_KEY, course: { status: 'PUBLISHED' } },
    10: { courseId: 10, mediaMode: 'VIDEO', videoObjectKey: TESTIMONIAL_KEY, course: { status: 'PUBLISHED' } },
    11: { courseId: 11, mediaMode: 'VIDEO', videoObjectKey: DOCTOR_KEY, course: { status: 'PUBLISHED' } },
    12: { courseId: 12, mediaMode: 'VIDEO', videoObjectKey: null, course: { status: 'PUBLISHED' } },
  };
  const restores = [
    swap(prisma.courseMentorMedia, 'findUnique', async ({ where }) => rows[where.courseId] || null),
    swap(videoStorageSettings, 'getR2ConfigOrNull', async () => ({ bucket: 'b', accountId: 'a', accessKeyId: 'k', secretAccessKey: 's' })),
    swap(r2, 'signedGetUrl', async (_cfg, key) => { signed.push(key); return { url: 'https://acct.r2.cloudflarestorage.com/signed', expiresInSeconds: 600 }; }),
  ];
  const call = async (courseId, currentUser) => {
    const res = { code: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await controller.getCourseMentorVideoSource({ params: { courseId: String(courseId) }, currentUser }, res, (e) => { throw e; });
    return res;
  };
  try {
    const ok = await call(5);
    assert.equal(ok.code, 200);
    assert.match(ok.body.url, /^https:\/\//);
    assert.equal(ok.headers['Cache-Control'], 'private, no-store, max-age=0');
    assert.ok(!JSON.stringify(ok.body).includes('/mentor/'), 'key never leaves the server');
    assert.equal((await call(6)).code, 404, 'not displayed => not signed for the public');
    assert.equal((await call(6, { role: 'STUDENT' })).code, 404);
    assert.equal((await call(6, { role: 'ADMIN' })).code, 200, 'admin preview');
    assert.equal((await call(7)).code, 404, 'draft course is not public');
    assert.equal((await call(7, { role: 'ADMIN' })).code, 200, 'admin may preview a draft');
    for (const id of [8, 9, 10, 11, 12]) assert.equal((await call(id, { role: 'ADMIN' })).code, 404, `row ${id}: foreign / non-mentor key never signed`);
    for (const bad of ['abc', '-1', '0', '99999999999', '1;DROP', '']) assert.equal((await call(bad)).code, 404, `bad id ${bad}`);
    assert.equal((await call(404)).code, 404, 'no row');
    assert.deepEqual(signed.slice(0, 1), [own], 'the public call signed the own mentor key of that course');
    assert.ok(signed.every((k) => r2.isMentorObjectKey(k)));
    assert.equal(signed.length, 3);
  } finally { restores.reverse().forEach((r) => r()); }
});

test('mentor-video endpoint is rate limited and mounted on the public api router', () => {
  const routes = read('src/routes/api/courseMedia.routes.js');
  assert.match(routes, /rateLimit\(/);
  assert.match(routes, /router\.get\('\/:courseId\/mentor-video\/source', limiter, controller\.getCourseMentorVideoSource\)/);
  assert.match(read('server.js'), /app\.use\('\/api\/courses', courseMediaApiRoutes\)/);
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
test('admin routes: multipart POST (upload middleware BEFORE csrf) + reset, mounted behind the ADMIN guard', () => {
  const routes = read('src/routes/adminCourseMentorMedia.routes.js');
  assert.match(routes, /router\.post\('\/courses\/:courseId\/mentor-media', uploadCourseMentorMedia\(\), doubleCsrfProtection, controller\.save\)/);
  assert.match(routes, /router\.post\('\/courses\/:courseId\/mentor-media\/reset', doubleCsrfProtection, controller\.reset\)/);
  const admin = read('src/routes/admin.routes.js');
  assert.match(admin, /router\.use\(require\('\.\/adminCourseMentorMedia\.routes'\)\)/);
  assert.ok(admin.indexOf("router.use(requireRole('ADMIN'))") < admin.indexOf("require('./adminCourseMentorMedia.routes')"));
});

test('upload middleware: mentor key builder bound to the course, mp4/webm only, images to shared storage, adoption cleanup', () => {
  const mw = read('src/middleware/courseMentorMediaUpload.middleware.js');
  assert.match(mw, /r2\.buildMentorObjectKey\(courseId, ext\)/);
  assert.match(mw, /isAllowedVideoFile\(file\.originalname, file\.mimetype\)/);
  assert.match(mw, /name: 'video', maxCount: 1[\s\S]*name: 'poster', maxCount: 1[\s\S]*name: 'photo', maxCount: 1/);
  assert.match(mw, /rejectIfSpoofed/);
  assert.match(mw, /courseMentorMediaAdopted/);
  assert.doesNotMatch(mw, /buildPromoObjectKey|buildTestimonialObjectKey|buildDoctorObjectKey|buildObjectKey\(/);
});

test('admin card renders every control, CSRF, the course-scoped actions and the current state', async () => {
  const media = { mediaMode: 'VIDEO', photoUrl: '/uploads/thumbnails/ph.jpg', videoType: 'YOUTUBE', videoUrl: YT, videoObjectKey: null, posterUrl: '/uploads/thumbnails/po.jpg', caption: 'Cap', autoplayMuted: true, loopVideo: false };
  const html = await ejs.renderFile(path.join(root, 'views/admin/courses/mentor-media-card.ejs'), { csrfToken: 'tok', course: { id: 5, title: 'FMR' }, mentorMediaView: { media, r2Configured: true } });
  assert.match(html, /action="\/admin\/courses\/5\/mentor-media" enctype="multipart\/form-data"/);
  assert.match(html, /action="\/admin\/courses\/5\/mentor-media\/reset"[^>]*data-confirm=/);
  assert.equal((html.match(/name="_csrf" value="tok"/g) || []).length, 2);
  for (const n of ['mediaMode', 'caption', 'photo', 'poster', 'video', 'videoUrl', 'autoplayMuted', 'loopVideo', 'removeVideo', 'removePhoto', 'removePoster']) assert.match(html, new RegExp(`name="${n}"`), n);
  assert.match(html, /<option value="VIDEO" selected>/);
  assert.match(html, /name="autoplayMuted" value="false"/);
  assert.match(html, /value="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"/);
  assert.match(html, /This course only/);
  const noR2 = await ejs.renderFile(path.join(root, 'views/admin/courses/mentor-media-card.ejs'), { csrfToken: 't', course: { id: 5, title: 'FMR' }, mentorMediaView: { media: { ...svc.DEFAULTS }, r2Configured: false } });
  assert.match(noR2, /id="mmVideo"[^>]*disabled/);
  assert.match(noR2, /Reset to default<\/button>/);
  assert.match(noR2, /disabled><i class="bi bi-arrow-counterclockwise/);
});

test('the Mentor Display tab of the landing editor includes the card (and still renders without it)', async () => {
  const base = {
    csrfToken: 't', activeTab: 'mentor', cms: { brand: {} },
    course: { id: 5, title: 'C', slug: 'c', status: 'PUBLISHED', instructor: null }, landingContent: {},
    heroChips: [], takeaways: [], questions: [], audienceItems: [], faqs: [], whyRegisterItems: [], highlights: [], testimonials: [],
    accessPlans: [], courseStats: [], landingSections: [], resources: [], accessSteps: [], comparisonColumns: [],
  };
  const file = path.join(root, 'views/admin/courses/landing-page-content.ejs');
  const without = await ejs.renderFile(file, base);
  assert.doesNotMatch(without, /id="mentorMediaCard"/);
  const withCard = await ejs.renderFile(file, { ...base, mentorMediaView: { media: { ...svc.DEFAULTS }, r2Configured: false } });
  assert.match(withCard, /id="mentorMediaCard"/);
  assert.match(withCard, /Meet Your Mentor Section Settings/, 'the existing mentor settings form is untouched');
  assert.ok(withCard.indexOf('id="mentorMediaCard"') < withCard.indexOf('Meet Your Mentor Section Settings'));
});

test('admin controller: saves, adopts uploads, cleans orphans, resets, flashes and redirects to the Mentor tab', async () => {
  const controller = require('../src/controllers/admin/courseMentorMedia.controller');
  const imageStorage = require('../src/lib/imageStorage');
  const oldKey = MENTOR_KEY(5);
  const db = memoryDb({ 5: { courseId: 5, mediaMode: 'VIDEO', photoUrl: '/uploads/thumbnails/old-photo.jpg', videoType: 'UPLOAD', videoObjectKey: oldKey, posterUrl: '/uploads/thumbnails/old-poster.jpg' } });
  const calls = { deleted: [], images: [] };
  const restores = [
    swap(svc, 'deleteHostedVideo', async (k, c) => { calls.deleted.push([k, c]); }),
    swap(imageStorage, 'deleteIfOwned', (u) => { calls.images.push(u); }),
  ];
  const mk = (params, body, files) => {
    const flash = [];
    return {
      flash,
      req: { params, body, files, courseMentorMediaAdopted: { video: false, poster: false, photo: false }, flashSuccess: (m) => flash.push(['ok', m]), flashError: (m) => flash.push(['err', m]) },
      res: { redirectTo: null, redirect(u) { this.redirectTo = u; } },
    };
  };
  try {
    const newKey = MENTOR_KEY(5);
    const ok = mk({ courseId: '5' }, { mediaMode: 'VIDEO', caption: 'Cap' }, {
      video: [{ r2Key: newKey }],
      poster: [{ filename: '0b9b1d58-8a3d-4a0e-9d5c-6f1a2b3c4d5e.jpg' }],
      photo: [{ filename: '1c0c2e69-9b4e-4b1e-8e6d-7a2b3c4d5e6f.png' }],
    });
    await controller.save(ok.req, ok.res, (e) => { throw e; });
    assert.equal(ok.res.redirectTo, '/admin/courses/5/landing-page?tab=mentor');
    assert.equal(ok.flash[0][0], 'ok');
    assert.deepEqual(ok.req.courseMentorMediaAdopted, { video: true, poster: true, photo: true });
    assert.deepEqual(calls.deleted, [[oldKey, 5]], 'replaced R2 video deleted');
    assert.deepEqual(calls.images.sort(), ['/uploads/thumbnails/old-photo.jpg', '/uploads/thumbnails/old-poster.jpg']);
    assert.equal(db.rows[5].videoObjectKey, newKey);

    const bad = mk({ courseId: '5' }, { mediaMode: 'GALLERY' }, {});
    await controller.save(bad.req, bad.res, (e) => { throw e; });
    assert.equal(bad.flash[0][0], 'err');
    assert.equal(bad.res.redirectTo, '/admin/courses/5/landing-page?tab=mentor');
    assert.equal(db.rows[5].mediaMode, 'VIDEO');

    const missing = mk({ courseId: '999' }, { mediaMode: 'PHOTO' }, {});
    await controller.save(missing.req, missing.res, (e) => { throw e; });
    assert.equal(missing.res.redirectTo, '/admin/courses');

    calls.deleted.length = 0; calls.images.length = 0;
    const rs = mk({ courseId: '5' }, {}, {});
    await controller.reset(rs.req, rs.res, (e) => { throw e; });
    assert.equal(rs.res.redirectTo, '/admin/courses/5/landing-page?tab=mentor');
    assert.equal(db.rows[5], undefined, 'row deleted');
    assert.deepEqual(calls.deleted, [[newKey, 5]]);
  } finally { restores.reverse().forEach((r) => r()); db.restore(); }
});

// ---------------------------------------------------------------------------
// Public page + admin preview use it
// ---------------------------------------------------------------------------
test('course controller loads the course mentor media and passes it to the view; the view lists the local', () => {
  const ctrl = read('src/controllers/course.controller.js');
  assert.match(ctrl, /getPublicCourseMentorMedia\(course\.id, course\.instructor && course\.instructor\.photoUrl/);
  assert.match(ctrl, /\n\s+courseMentorMedia,\n/);
  assert.match(read('views/public/course-detail.ejs'), /courseMentorMedia: typeof courseMentorMedia !== 'undefined' \? courseMentorMedia : null/);
});

test('admin preview renders with the course saved mentor media', async () => {
  const controller = require('../src/controllers/admin/courseLanding.controller');
  const curriculumService = require('../src/services/curriculum.service');
  const landingService = require('../src/services/courseLanding.service');
  const db = memoryDb({ 5: { courseId: 5, mediaMode: 'VIDEO', videoType: 'YOUTUBE', videoUrl: YT } });
  const swaps = [];
  const sw = (o, k, v) => { const prev = o[k]; o[k] = v; swaps.push(() => { o[k] = prev; }); };
  const prevFind = prisma.course.findUnique;
  sw(prisma.course, 'findUnique', async ({ where }) => (where.id === 5 ? { id: 5, title: 'C', slug: 'c', price: 0, instructor: { name: 'Dr. T', photoUrl: '/uploads/thumbnails/i.jpg' } } : null));
  sw(curriculumService, 'getCourseCurriculum', async () => []);
  sw(curriculumService, 'getPublicCourseStats', async () => ({ lessonCount: 0 }));
  sw(curriculumService, 'listResourcesForCourse', async () => []);
  sw(landingService, 'getPublicLandingData', async () => null);
  let rendered = null;
  try {
    await controller.previewLanding({ params: { courseId: '5' }, flashError() {} }, { render: (view, data) => { rendered = { view, data }; }, redirect() {} }, (e) => { throw e; });
  } finally {
    swaps.reverse().forEach((r) => r());
    db.restore();
    prisma.course.findUnique = prevFind;
  }
  assert.equal(rendered.view, 'public/course-detail');
  assert.equal(rendered.data.courseMentorMedia.mode, 'VIDEO');
  assert.equal(rendered.data.courseMentorMedia.fallbackPhotoUrl, '/uploads/thumbnails/i.jpg');
  assert.equal(rendered.data.courseMentorMedia.video.provider, 'youtube');
});

test('landing editor passes the mentor media view to the Admin template', () => {
  const ctrl = read('src/controllers/admin/courseLanding.controller.js');
  assert.match(ctrl, /mentorMediaView = \{[\s\S]*getCourseMentorMedia\(courseId\)[\s\S]*r2Configured/);
  assert.match(ctrl, /\n\s+mentorMediaView,\n/);
  assert.match(read('views/admin/courses/landing-page.ejs'), /mentorMediaView: typeof mentorMediaView !== 'undefined' \? mentorMediaView : null/);
});

// ---------------------------------------------------------------------------
// Source of truth + migration + founder/about audit
// ---------------------------------------------------------------------------
test('source of truth: every public mentor-media value flows view -> service -> DB column -> admin input', () => {
  const schema = read('prisma/schema.prisma');
  const model = schema.match(/model CourseMentorMedia \{([\s\S]*?)\n\}/)[1];
  assert.match(model, /courseId\s+Int\s+@unique/);
  assert.match(model, /onDelete: Cascade/);
  for (const col of ['mediaMode', 'photoUrl', 'videoType', 'videoUrl', 'videoObjectKey', 'posterUrl', 'caption', 'autoplayMuted', 'loopVideo']) {
    assert.match(model, new RegExp(`\\b${col}\\b`), `column ${col}`);
  }
  const card = read('views/admin/courses/mentor-media-card.ejs');
  const publicPartial = read('views/partials/doctor-media.ejs');
  for (const [pub, input] of [['caption', 'caption'], ['autoplayMuted', 'autoplayMuted'], ['loop', 'loopVideo'], ['posterUrl', 'poster'], ['embedUrl', 'videoUrl'], ['photoUrl', 'photo']]) {
    assert.ok(publicPartial.includes(pub) || read('views/public/course-detail-content.ejs').includes(pub), `public uses ${pub}`);
    assert.match(card, new RegExp(`name="${input}"`), `admin input for ${pub}`);
  }
  assert.match(svc.toPublicCourseMentorMedia.toString(), /autoplayMuted/);
});

test('migration is a single additive CREATE TABLE + FK (no change to any existing table)', () => {
  const dirs = fs.readdirSync(path.join(root, 'prisma/migrations')).filter((d) => d.includes('add_course_mentor_media'));
  assert.equal(dirs.length, 1);
  const sql = read('prisma/migrations', dirs[0], 'migration.sql');
  assert.match(sql, /CREATE TABLE `course_mentor_media`/);
  assert.match(sql, /ALTER TABLE `course_mentor_media` ADD CONSTRAINT/);
  assert.doesNotMatch(sql, /^\s*(?:DROP|DELETE|UPDATE|TRUNCATE|INSERT)\b/im);
  assert.equal((sql.match(/ALTER TABLE `(?!course_mentor_media)/g) || []).length, 0);
});

test('founder + about + homepage doctor blocks all go through the doctor-media partial (global option applies everywhere)', () => {
  for (const f of ['views/partials/mentor.ejs', 'views/public/founder-content.ejs', 'views/public/about-content.ejs']) {
    assert.match(read(f), /doctor-media/, f);
  }
  // the only instructor-photo <img> left in these templates are the PHOTO-mode fallbacks next to a partial include
  const founder = read('views/public/founder-content.ejs');
  assert.equal((founder.match(/<img class="fp-portrait"/g) || []).length, 1);
  assert.match(read('views/public/course-detail-content.ejs'), /partials\/doctor-media/);
});
