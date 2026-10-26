process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

// Doctor photo / video for the "about the doctor" blocks (homepage mentor, /founder, /about):
// default PHOTO keeps today's markup, VIDEO shows a click-to-play card, safe public delivery,
// validation, patch saves, replace/remove + cleanup, admin wiring and the source-of-truth chain.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const { prisma } = require('../src/config/db');
const r2 = require('../src/lib/r2');
const svc = require('../src/services/doctorMedia.service');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').split('\r\n').join('\n');

const DOCTOR_KEY = () => r2.buildDoctorObjectKey('.mp4');
const PROMO_KEY = () => r2.buildPromoObjectKey('.mp4');
const LESSON_KEY = 'courses/5/lessons/9/0f8fad5b-d9cb-469f-a165-70867728950e.mp4';
const TESTIMONIAL_KEY = 'courses/5/testimonials/3/0f8fad5b-d9cb-469f-a165-70867728950e.mp4';
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const VIMEO = 'https://vimeo.com/76979871';

function swap(obj, key, impl) {
  const orig = obj[key];
  obj[key] = impl;
  return () => { obj[key] = orig; };
}

// In-memory doctor_media row
function memoryDb(initial = null) {
  const state = { row: initial };
  const restores = [
    swap(prisma.doctorMedia, 'findUnique', async () => state.row),
    swap(prisma.doctorMedia, 'upsert', async ({ create, update }) => {
      state.row = state.row ? { ...state.row, ...update } : { id: 1, ...create };
      return state.row;
    }),
  ];
  state.restore = () => restores.reverse().forEach((r) => r());
  return state;
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------
test('doctor R2 key shape is its own prefix: accepted only for site/doctor/, rejected for every other kind', () => {
  assert.ok(r2.isDoctorObjectKey(DOCTOR_KEY()));
  assert.ok(r2.isDoctorObjectKey(r2.buildDoctorObjectKey('.webm')));
  for (const bad of [PROMO_KEY(), LESSON_KEY, TESTIMONIAL_KEY, 'site/doctor/../x.mp4', 'site/doctor/not-a-uuid.mp4', '', null, undefined, 42, `${DOCTOR_KEY()}x`]) {
    assert.equal(r2.isDoctorObjectKey(bad), false, String(bad));
  }
  assert.ok(r2.isOwnedObjectKey(DOCTOR_KEY()));
  assert.throws(() => r2.buildDoctorObjectKey('.exe'), /Unsupported/);
  assert.equal(r2.isPromoObjectKey(DOCTOR_KEY()), false, 'a doctor key is never a promo key');
  assert.equal(r2.isTestimonialObjectKey(DOCTOR_KEY()), false);
});

// ---------------------------------------------------------------------------
// Public view-model
// ---------------------------------------------------------------------------
test('no row / PHOTO without override => null (pages keep their existing photo markup)', () => {
  assert.equal(svc.toPublicDoctorMedia(null, '/p.jpg', 'Dr T'), null);
  assert.equal(svc.toPublicDoctorMedia({ mediaMode: 'PHOTO' }, '/p.jpg', 'Dr T'), null);
  assert.equal(svc.toPublicDoctorMedia({ mediaMode: 'VIDEO', videoType: null }, '/p.jpg', 'Dr T'), null, 'VIDEO without a playable video falls back to the photo');
  assert.equal(svc.toPublicDoctorMedia({ mediaMode: 'VIDEO', videoType: 'UPLOAD', videoObjectKey: LESSON_KEY }, '/p.jpg', 'Dr T'), null, 'a non-doctor key is not playable');
  const photo = svc.toPublicDoctorMedia({ mediaMode: 'PHOTO', photoUrl: '/uploads/thumbnails/a.jpg' }, '/p.jpg', 'Dr T');
  assert.equal(photo.mode, 'PHOTO');
  assert.equal(photo.photoUrl, '/uploads/thumbnails/a.jpg');
  assert.equal(photo.video, null);
});

test('VIDEO view-model: embed + hosted shapes never expose the object key or the raw stored url', () => {
  const embed = svc.toPublicDoctorMedia({ mediaMode: 'VIDEO', videoType: 'YOUTUBE', videoUrl: YT, caption: ' Hello ', posterUrl: '/uploads/thumbnails/p.jpg' }, '/p.jpg', 'Dr T');
  assert.equal(embed.mode, 'VIDEO');
  assert.equal(embed.video.kind, 'embed');
  assert.match(embed.video.embedUrl, /^https:\/\/www\.youtube(-nocookie)?\.com\/embed\/dQw4w9WgXcQ/);
  assert.equal(embed.video.provider, 'youtube');
  const vimeo = svc.toPublicDoctorMedia({ mediaMode: 'VIDEO', videoType: 'VIMEO', videoUrl: VIMEO }, '', '');
  assert.equal(vimeo.video.provider, 'vimeo');
  const key = DOCTOR_KEY();
  const hosted = svc.toPublicDoctorMedia({ mediaMode: 'VIDEO', videoType: 'UPLOAD', videoObjectKey: key }, '/p.jpg', 'Dr T');
  assert.equal(hosted.video.kind, 'hosted');
  assert.equal(hosted.video.embedUrl, null);
  assert.ok(!JSON.stringify(hosted).includes('site/doctor'), 'object key must not leak');
  assert.ok(!JSON.stringify(embed).includes('videoUrl'));
});

// ---------------------------------------------------------------------------
// Rendering: all three places
// ---------------------------------------------------------------------------
const INSTRUCTOR = { name: 'Dr. Tanu Raghav', photoUrl: '/uploads/thumbnails/doctor-own.jpg', experienceLabel: '11+ Years', designation: 'Prosthodontist', credentials: [] };
const renderMentor = (extra = {}) => ejs.renderFile(path.join(root, 'views/partials/mentor.ejs'), { cms: { mentor: { enabled: true }, brand: {} }, mentorInstructor: INSTRUCTOR, ...extra });
const renderFounder = (extra = {}) => ejs.renderFile(path.join(root, 'views/public/founder-content.ejs'), {
  vm: { sections: ['HERO'], instructor: { name: 'Dr. Tanu Raghav', title: 'Founder', photoUrl: '/uploads/thumbnails/doctor-own.jpg', bioParagraphs: [] } },
  ...extra,
});
const renderAbout = (extra = {}) => ejs.renderFile(path.join(root, 'views/public/about-content.ejs'), {
  cms: { featured: {} }, page: { heading: 'About ICDS', eyebrow: '', intro: '' }, sections: [], courses: [],
  founder: { name: 'Dr. Tanu Raghav', title: 'Founder', photoUrl: '/uploads/thumbnails/doctor-own.jpg', shortBio: 'Bio' },
  ...extra,
});
const PLACES = [['mentor', renderMentor], ['founder', renderFounder], ['about', renderAbout]];

test('default PHOTO renders exactly the existing markup in all three places (null === undefined, no doctor-media assets)', async () => {
  for (const [name, render] of PLACES) {
    const withNull = await render({ doctorMedia: null });
    const withUndefined = await render();
    assert.equal(withNull, withUndefined, `${name}: null and missing doctorMedia render identically`);
    assert.ok(withNull.includes('/uploads/thumbnails/doctor-own.jpg'), `${name}: the doctor's own photo`);
    assert.doesNotMatch(withNull, /doctor-media|data-intro-reel/, `${name}: no video card assets`);
  }
  assert.match(await renderMentor(), /<img\s+class="mentor-portrait-img img-fluid"/);
  assert.match(await renderFounder(), /<img class="fp-portrait" src="\/uploads\/thumbnails\/doctor-own\.jpg"/);
  assert.match(await renderAbout(), /<img src="\/uploads\/thumbnails\/doctor-own\.jpg"[^>]*width="120"/);
});

test('PHOTO with an uploaded override replaces the instructor photo in all three places', async () => {
  const dm = svc.toPublicDoctorMedia({ mediaMode: 'PHOTO', photoUrl: '/uploads/thumbnails/override.jpg' }, '/x.jpg', 'Dr');
  for (const [name, render] of PLACES) {
    const html = await render({ doctorMedia: dm });
    assert.ok(html.includes('/uploads/thumbnails/override.jpg'), `${name}: override shown`);
    assert.ok(!html.includes('doctor-own.jpg'), `${name}: instructor photo replaced`);
    assert.doesNotMatch(html, /data-intro-reel/);
  }
});

test('VIDEO mode renders the card in all three places: poster + play button, nothing loaded before the click, never autoplay', async () => {
  const dm = svc.toPublicDoctorMedia({ mediaMode: 'VIDEO', videoType: 'YOUTUBE', videoUrl: YT, caption: 'A message from our founder', posterUrl: '/uploads/thumbnails/poster.jpg' }, '/uploads/thumbnails/doctor-own.jpg', 'Dr. Tanu Raghav');
  for (const [name, render] of PLACES) {
    const html = await render({ doctorMedia: dm });
    assert.match(html, /data-intro-reel/, `${name}: card`);
    assert.match(html, /data-kind="embed"/);
    assert.match(html, /data-embed="https:\/\/www\.youtube(-nocookie)?\.com\/embed\/dQw4w9WgXcQ/);
    assert.match(html, /aria-label="Play video: Dr\. Tanu Raghav"/, `${name}: labelled play button`);
    assert.ok(html.includes('/uploads/thumbnails/poster.jpg'), `${name}: poster`);
    assert.match(html, /A message from our founder/, `${name}: caption`);
    assert.doesNotMatch(html, /<iframe|<video\b/i, `${name}: no iframe / video element before the click`);
    assert.doesNotMatch(html, /\bautoplay\b/i, `${name}: no autoplay`);
    assert.match(html, /data-muted-start="0"/);
    assert.match(html, /\/js\/home-intro-video\.js/);
    assert.ok(!html.includes('doctor-own.jpg') || name === 'x', `${name}: poster set explicitly, instructor photo not used as poster`);
  }
});

test('VIDEO poster falls back to the doctor photo; blank caption stays hidden; vimeo + hosted shapes', async () => {
  const noPoster = svc.toPublicDoctorMedia({ mediaMode: 'VIDEO', videoType: 'VIMEO', videoUrl: VIMEO, caption: '   ' }, '/uploads/thumbnails/doctor-own.jpg', 'Dr');
  const html = await renderMentor({ doctorMedia: noPoster });
  assert.ok(html.includes('class="intro-reel-poster" src="/uploads/thumbnails/doctor-own.jpg"'), 'doctor photo used as poster');
  assert.doesNotMatch(html, /doctor-media-caption/, 'blank caption hidden');
  assert.match(html, /data-provider="vimeo"/);
  const hosted = svc.toPublicDoctorMedia({ mediaMode: 'VIDEO', videoType: 'UPLOAD', videoObjectKey: DOCTOR_KEY() }, '', 'Dr');
  const h = await renderFounder({ doctorMedia: hosted });
  assert.match(h, /data-kind="hosted"/);
  assert.match(h, /data-source-url="\/api\/home\/doctor-video\/source"/);
  assert.ok(!h.includes('site/doctor') && !h.includes('.mp4'), 'no object key / file name in the page');
  assert.match(h, /intro-reel-poster is-empty/, 'no poster and no photo => neutral placeholder');
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
test('validation: bad mode / url / caption / key / type are rejected and nothing is written', async () => {
  const db = memoryDb();
  try {
    await assert.rejects(() => svc.saveDoctorMedia({ mediaMode: 'GALLERY' }), /Display mode/);
    await assert.rejects(() => svc.saveDoctorMedia({ mediaMode: "VIDEO'; DROP" }), /Display mode/);
    for (const bad of ['javascript:alert(1)', 'http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://evil.example/v.mp4', 'https://youtube.com.evil.example/watch?v=1', 'data:text/html,x', '//youtube.com/watch?v=1']) {
      await assert.rejects(() => svc.saveDoctorMedia({ videoUrl: bad }), /YouTube or Vimeo|https|valid/i, bad);
    }
    await assert.rejects(() => svc.saveDoctorMedia({ caption: 'x'.repeat(201) }), /200 characters/);
    for (const key of [PROMO_KEY(), LESSON_KEY, TESTIMONIAL_KEY, 'site/doctor/x.mp4', '../../etc/passwd']) {
      await assert.rejects(() => svc.saveDoctorMedia({}, { videoObjectKey: key }), /Invalid hosted video/, key);
    }
    await assert.rejects(() => svc.saveDoctorMedia({ videoType: 'UPLOAD' }), /Upload a video file/);
    await assert.rejects(() => svc.saveDoctorMedia({ videoType: 'FLASH' }), /Video type/);
    await assert.rejects(() => svc.saveDoctorMedia({ photoUrl: 'javascript:alert(1)' }), /Photo/);
    await assert.rejects(() => svc.saveDoctorMedia({ posterUrl: 'http://insecure.example/p.jpg' }), /Poster/);
    assert.equal(db.row, null, 'no row written by any rejected save');
  } finally { db.restore(); }
});

test('partial save: changing the caption or mode leaves video / poster / photo untouched', async () => {
  const key = DOCTOR_KEY();
  const db = memoryDb({ id: 1, mediaMode: 'PHOTO', photoUrl: '/uploads/thumbnails/o.jpg', videoType: 'UPLOAD', videoUrl: null, videoObjectKey: key, posterUrl: '/uploads/thumbnails/p.jpg', caption: 'Old' });
  try {
    const r = await svc.saveDoctorMedia({ caption: 'New caption' });
    assert.equal(r.row.caption, 'New caption');
    assert.equal(r.row.videoObjectKey, key);
    assert.equal(r.row.posterUrl, '/uploads/thumbnails/p.jpg');
    assert.equal(r.row.photoUrl, '/uploads/thumbnails/o.jpg');
    assert.equal(r.orphanedVideoKey, null);
    const m = await svc.saveDoctorMedia({ mediaMode: 'VIDEO' });
    assert.equal(m.row.mediaMode, 'VIDEO');
    assert.equal(m.row.caption, 'New caption', 'mode change keeps the caption');
    const blank = await svc.saveDoctorMedia({ caption: '' });
    assert.equal(blank.row.caption, '', 'a saved blank caption clears it (stays hidden)');
  } finally { db.restore(); }
});

test('replace / remove semantics and orphan reporting for video, poster and photo', async () => {
  const oldKey = DOCTOR_KEY();
  const newKey = DOCTOR_KEY();
  const db = memoryDb({ id: 1, mediaMode: 'VIDEO', photoUrl: '/uploads/thumbnails/o.jpg', videoType: 'UPLOAD', videoUrl: null, videoObjectKey: oldKey, posterUrl: '/uploads/thumbnails/p.jpg', caption: '' });
  try {
    // replace upload: new key adopted, old key reported as orphan
    let r = await svc.saveDoctorMedia({}, { videoObjectKey: newKey });
    assert.equal(r.row.videoObjectKey, newKey);
    assert.equal(r.orphanedVideoKey, oldKey);
    // a link replaces the upload
    r = await svc.saveDoctorMedia({ videoUrl: YT });
    assert.equal(r.row.videoType, 'YOUTUBE');
    assert.equal(r.row.videoObjectKey, null);
    assert.equal(r.orphanedVideoKey, newKey);
    // remove wins over the (re-posted) link box
    r = await svc.saveDoctorMedia({ removeVideo: 'true', videoUrl: YT });
    assert.equal(r.row.videoType, null);
    assert.equal(r.row.videoUrl, '');
    // poster / photo replace + remove
    r = await svc.saveDoctorMedia({}, { posterUrl: '/uploads/thumbnails/p2.jpg', photoUrl: '/uploads/thumbnails/o2.jpg' });
    assert.equal(r.orphanedPosterUrl, '/uploads/thumbnails/p.jpg');
    assert.equal(r.orphanedPhotoUrl, '/uploads/thumbnails/o.jpg');
    r = await svc.saveDoctorMedia({ removePoster: ['false', 'true'], removePhoto: 'true' });
    assert.equal(r.row.posterUrl, '');
    assert.equal(r.row.photoUrl, '');
    assert.equal(r.orphanedPosterUrl, '/uploads/thumbnails/p2.jpg');
    assert.equal(r.orphanedPhotoUrl, '/uploads/thumbnails/o2.jpg');
    // an empty link box clears a LINK video but never an uploaded one
    await svc.saveDoctorMedia({ videoUrl: YT });
    r = await svc.saveDoctorMedia({ videoUrl: '' });
    assert.equal(r.row.videoType, null);
    const up = DOCTOR_KEY();
    await svc.saveDoctorMedia({}, { videoObjectKey: up });
    r = await svc.saveDoctorMedia({ videoUrl: '' });
    assert.equal(r.row.videoObjectKey, up, 'uploaded video survives an empty link box');
    assert.equal(r.row.videoType, 'UPLOAD');
  } finally { db.restore(); }
});

test('deleteHostedVideo only ever deletes doctor keys', async () => {
  const videoStorageSettings = require('../src/services/videoStorageSettings.service');
  const deleted = [];
  const restores = [
    swap(videoStorageSettings, 'getR2ConfigOrNull', async () => ({ bucket: 'b' })),
    swap(r2, 'deleteObject', async (_cfg, key) => { deleted.push(key); }),
  ];
  try {
    const key = DOCTOR_KEY();
    assert.equal(await svc.deleteHostedVideo(key), true);
    assert.equal(await svc.deleteHostedVideo(LESSON_KEY), false);
    assert.equal(await svc.deleteHostedVideo(PROMO_KEY()), false);
    assert.deepEqual(deleted, [key]);
  } finally { restores.reverse().forEach((r) => r()); }
});

// ---------------------------------------------------------------------------
// Public signed-URL endpoint
// ---------------------------------------------------------------------------
test('doctor-video source endpoint signs ONLY the doctor key shape, only while displayed (or for an admin)', async () => {
  const controller = require('../src/controllers/doctorVideo.controller');
  const videoStorageSettings = require('../src/services/videoStorageSettings.service');
  const signed = [];
  const rows = {
    video: { id: 1, mediaMode: 'VIDEO', videoObjectKey: DOCTOR_KEY() },
    photoMode: { id: 1, mediaMode: 'PHOTO', videoObjectKey: DOCTOR_KEY() },
    promo: { id: 1, mediaMode: 'VIDEO', videoObjectKey: PROMO_KEY() },
    lesson: { id: 1, mediaMode: 'VIDEO', videoObjectKey: LESSON_KEY },
    testimonial: { id: 1, mediaMode: 'VIDEO', videoObjectKey: TESTIMONIAL_KEY },
    none: { id: 1, mediaMode: 'VIDEO', videoObjectKey: null },
  };
  let current = rows.video;
  const restores = [
    swap(prisma.doctorMedia, 'findUnique', async () => current),
    swap(videoStorageSettings, 'getR2ConfigOrNull', async () => ({ bucket: 'b', accountId: 'a', accessKeyId: 'k', secretAccessKey: 's' })),
    swap(r2, 'signedGetUrl', async (_cfg, key) => { signed.push(key); return { url: 'https://acct.r2.cloudflarestorage.com/signed', expiresInSeconds: 600 }; }),
  ];
  const call = async (row, currentUser) => {
    current = row;
    const res = { code: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await controller.getDoctorVideoSource({ currentUser }, res, (e) => { throw e; });
    return res;
  };
  try {
    const ok = await call(rows.video);
    assert.equal(ok.code, 200);
    assert.match(ok.body.url, /^https:\/\//);
    assert.equal(ok.headers['Cache-Control'], 'private, no-store, max-age=0');
    assert.ok(!JSON.stringify(ok.body).includes('site/doctor'), 'key never leaves the server');
    assert.equal((await call(rows.photoMode)).code, 404, 'not displayed => not signed for the public');
    assert.equal((await call(rows.photoMode, { role: 'STUDENT' })).code, 404);
    assert.equal((await call(rows.photoMode, { role: 'ADMIN' })).code, 200, 'admin preview');
    for (const k of ['promo', 'lesson', 'testimonial', 'none']) assert.equal((await call(rows[k], { role: 'ADMIN' })).code, 404, `${k} key is never signed here`);
    assert.equal((await call(null)).code, 404, 'no row');
    assert.equal(signed.length, 2);
    assert.ok(signed.every((k) => r2.isDoctorObjectKey(k)));
  } finally { restores.reverse().forEach((r) => r()); }
});

test('doctor-video endpoint is rate limited and mounted on the public api router', () => {
  const routes = read('src/routes/api/home.routes.js');
  assert.match(routes, /router\.get\('\/doctor-video\/source', limiter, doctorVideoController\.getDoctorVideoSource\)/);
  assert.match(routes, /rateLimit\(/);
  assert.match(read('server.js'), /app\.use\('\/api\/home', homeApiRoutes\)/);
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
test('admin routes: GET page + multipart POST (upload middleware BEFORE csrf), mounted behind ADMIN', () => {
  const routes = read('src/routes/adminDoctorMedia.routes.js');
  assert.match(routes, /router\.get\('\/doctor-media', doctorMediaController\.show\)/);
  assert.match(routes, /router\.post\('\/doctor-media', uploadDoctorMedia\(\), doubleCsrfProtection, doctorMediaController\.save\)/);
  const admin = read('src/routes/admin.routes.js');
  assert.match(admin, /router\.use\(require\('\.\/adminDoctorMedia\.routes'\)\)/);
  assert.ok(admin.indexOf("router.use(requireRole('ADMIN'))") < admin.indexOf("require('./adminDoctorMedia.routes')"), 'mounted after the ADMIN guard');
  assert.match(read('views/partials/admin-header.ejs'), /href="\/admin\/doctor-media"/);
});

test('upload middleware: doctor key builder, mp4/webm only, poster+photo to image storage, adoption cleanup', () => {
  const mw = read('src/middleware/doctorMediaUpload.middleware.js');
  assert.match(mw, /r2\.buildDoctorObjectKey\(ext\)/);
  assert.match(mw, /isAllowedVideoFile\(file\.originalname, file\.mimetype\)/);
  assert.match(mw, /name: 'video', maxCount: 1[\s\S]*name: 'poster', maxCount: 1[\s\S]*name: 'photo', maxCount: 1/);
  assert.match(mw, /rejectIfSpoofed/);
  assert.match(mw, /doctorMediaAdopted/);
  assert.doesNotMatch(mw, /buildPromoObjectKey|buildTestimonialObjectKey/);
});

test('admin page renders every control and the current state', async () => {
  const media = { ...svc.DEFAULTS, mediaMode: 'VIDEO', videoType: 'YOUTUBE', videoUrl: YT, caption: 'Hi', posterUrl: '/uploads/thumbnails/p.jpg', photoUrl: '/uploads/thumbnails/o.jpg' };
  const html = await ejs.renderFile(path.join(root, 'views/admin/doctor-media/index-content.ejs'), { csrfToken: 'tok', media, preview: svc.toPublicDoctorMedia(media), r2Configured: false, modes: svc.MODES });
  for (const n of ['mediaMode', 'caption', 'photo', 'video', 'videoUrl', 'poster', 'removeVideo', 'removePhoto', 'removePoster']) assert.match(html, new RegExp(`name="${n}"`), n);
  assert.match(html, /name="_csrf" value="tok"/);
  assert.match(html, /enctype="multipart\/form-data"/);
  assert.match(html, /<option value="VIDEO" selected>/);
  assert.match(html, /value="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"/);
  assert.match(html, /name="video"[^>]*disabled/, 'upload disabled without R2, link still works');
  const empty = await ejs.renderFile(path.join(root, 'views/admin/doctor-media/index-content.ejs'), { csrfToken: 't', media: { ...svc.DEFAULTS }, preview: null, r2Configured: true, modes: svc.MODES });
  assert.match(empty, /<option value="PHOTO" selected>/);
  assert.match(empty, /No video yet/);
  assert.match(empty, /Using the doctor&rsquo;s own photo/);
});

test('admin controller: saves, adopts uploads, cleans orphans, flashes errors and success', async () => {
  const controller = require('../src/controllers/admin/doctorMedia.controller');
  const imageStorage = require('../src/lib/imageStorage');
  const db = memoryDb({ id: 1, mediaMode: 'VIDEO', photoUrl: '/uploads/thumbnails/old-photo.jpg', videoType: 'UPLOAD', videoObjectKey: DOCTOR_KEY(), posterUrl: '/uploads/thumbnails/old-poster.jpg', caption: '' });
  const oldKey = db.row.videoObjectKey;
  const calls = { deleted: [], images: [] };
  const restores = [
    swap(svc, 'deleteHostedVideo', async (k) => { calls.deleted.push(k); }),
    swap(imageStorage, 'deleteIfOwned', (u) => { calls.images.push(u); }),
  ];
  const mk = (body, files) => {
    const flash = [];
    return {
      flash,
      req: { body, files, doctorMediaAdopted: { video: false, poster: false, photo: false }, flashSuccess: (m) => flash.push(['ok', m]), flashError: (m) => flash.push(['err', m]) },
      res: { redirectTo: null, redirect(u) { this.redirectTo = u; } },
    };
  };
  try {
    const newKey = DOCTOR_KEY();
    const ok = mk({ mediaMode: 'VIDEO', caption: 'Cap' }, {
      video: [{ r2Key: newKey }],
      poster: [{ filename: '0b9b1d58-8a3d-4a0e-9d5c-6f1a2b3c4d5e.jpg' }],
      photo: [{ filename: '1c0c2e69-9b4e-4b1e-8e6d-7a2b3c4d5e6f.png' }],
    });
    await controller.save(ok.req, ok.res, (e) => { throw e; });
    assert.equal(ok.res.redirectTo, '/admin/doctor-media');
    assert.equal(ok.flash[0][0], 'ok');
    assert.deepEqual(ok.req.doctorMediaAdopted, { video: true, poster: true, photo: true }, 'uploads adopted (not discarded)');
    assert.deepEqual(calls.deleted, [oldKey], 'replaced R2 video deleted');
    assert.deepEqual(calls.images.sort(), ['/uploads/thumbnails/old-photo.jpg', '/uploads/thumbnails/old-poster.jpg']);
    assert.equal(db.row.videoObjectKey, newKey);

    const bad = mk({ mediaMode: 'GALLERY' }, {});
    await controller.save(bad.req, bad.res, (e) => { throw e; });
    assert.equal(bad.flash[0][0], 'err');
    assert.equal(bad.res.redirectTo, '/admin/doctor-media');
    assert.equal(db.row.mediaMode, 'VIDEO', 'rejected save changed nothing');

    const page = { rendered: null };
    const swapRender = swap(require('../src/services/videoStorageSettings.service'), 'getR2ConfigOrNull', async () => null);
    await controller.show({}, { render: (view, data) => { page.rendered = { view, data }; } }, (e) => { throw e; });
    swapRender();
    assert.equal(page.rendered.view, 'admin/doctor-media/index');
    assert.equal(page.rendered.data.r2Configured, false);
    assert.equal(page.rendered.data.media.mediaMode, 'VIDEO');
  } finally { restores.reverse().forEach((r) => r()); db.restore(); }
});

// ---------------------------------------------------------------------------
// Source-of-truth chain: public value -> view var -> service -> DB -> Admin input
// ---------------------------------------------------------------------------
test('source of truth: every public doctor-media value flows view -> service -> DB column -> admin input', () => {
  const schema = read('prisma/schema.prisma');
  const model = schema.match(/model DoctorMedia \{([\s\S]*?)\n\}/)[1];
  const chain = [
    // [public output, db column, admin input name]
    ['mode (photo/video)', 'mediaMode', 'mediaMode'],
    ['photo override', 'photoUrl', 'photo'],
    ['video link', 'videoUrl', 'videoUrl'],
    ['video file', 'videoObjectKey', 'video'],
    ['poster', 'posterUrl', 'poster'],
    ['caption', 'caption', 'caption'],
  ];
  const admin = read('views/admin/doctor-media/index-content.ejs');
  const service = read('src/services/doctorMedia.service.js');
  for (const [label, column, input] of chain) {
    assert.match(model, new RegExp(`\\b${column}\\b`), `${label}: DB column ${column}`);
    assert.ok(service.includes(column), `${label}: service handles ${column}`);
    assert.match(admin, new RegExp(`name="${input}"`), `${label}: admin input ${input}`);
  }
  // public templates read only the service view-model; each place receives it from its controller
  assert.match(read('src/controllers/home.controller.js'), /doctorMedia = await doctorMediaService\.getPublicDoctorMedia\(/);
  assert.match(read('src/controllers/home.controller.js'), /\n\s+doctorMedia,\n/);
  assert.match(read('src/controllers/founder.controller.js'), /getPublicDoctorMedia\(i\.photoUrl, i\.name\)/);
  assert.match(read('src/controllers/pages.controller.js'), /getPublicDoctorMedia\(founder && founder\.photoUrl, founder && founder\.name\)/);
  for (const f of ['views/partials/mentor.ejs', 'views/public/founder-content.ejs', 'views/public/about-content.ejs']) {
    assert.match(read(f), /doctor-media/, `${f} uses the shared partial`);
  }
  const partial = read('views/partials/doctor-media.ejs');
  for (const v of ['dmv.caption', 'dmv.video.posterUrl', 'dmv.video.embedUrl', 'dmv.video.kind']) assert.ok(partial.includes(v), v);
  assert.doesNotMatch(partial, /https?:\/\/(?!www\.w3)/, 'no hardcoded URLs in the partial');
  assert.doesNotMatch(partial, /Dr\. Tanu|Tanu Raghav/, 'no hardcoded doctor copy');
});

test('migration is a single additive CREATE TABLE', () => {
  const dirs = fs.readdirSync(path.join(root, 'prisma/migrations')).filter((d) => d.includes('add_doctor_media'));
  assert.equal(dirs.length, 1);
  const sql = read('prisma/migrations', dirs[0], 'migration.sql');
  assert.match(sql, /CREATE TABLE `doctor_media`/);
  assert.doesNotMatch(sql, /\bDROP\b|\bALTER TABLE\b|\bDELETE\b|\bUPDATE\b|TRUNCATE/i);
});
