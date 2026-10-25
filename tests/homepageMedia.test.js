process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

// Homepage intro / promo video (CMS, safe public playback, partial markup), homepage
// section ordering, and the admin wiring for both.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const { prisma } = require('../src/config/db');
const r2 = require('../src/lib/r2');
const intro = require('../src/services/homeIntroVideo.service');
const sections = require('../src/services/homeSections.service');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').split('\r\n').join('\n');

const PROMO_KEY = () => r2.buildPromoObjectKey('.mp4');
const LESSON_KEY = 'courses/5/lessons/9/0f8fad5b-d9cb-469f-a165-70867728950e.mp4';
const TESTIMONIAL_KEY = 'courses/5/testimonials/3/0f8fad5b-d9cb-469f-a165-70867728950e.mp4';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------
function swap(obj, key, impl) {
  const orig = obj[key];
  obj[key] = impl;
  return () => { obj[key] = orig; };
}

function installIntroDb() {
  const state = { row: null };
  const restores = [
    swap(prisma.homeIntroVideo, 'findUnique', async () => (state.row ? { ...state.row } : null)),
    swap(prisma.homeIntroVideo, 'upsert', async ({ create, update }) => {
      state.row = state.row ? { ...state.row, ...update } : { id: 1, ...create };
      return { ...state.row };
    }),
  ];
  return { state, restore: () => restores.reverse().forEach((r) => r()) };
}

function installSettingsDb() {
  const store = new Map();
  const writes = [];
  const restores = [
    swap(prisma.siteSetting, 'findMany', async ({ where }) => where.key.in.filter((k) => store.has(k)).map((key) => ({ key, value: store.get(key) }))),
    swap(prisma.siteSetting, 'findUnique', async ({ where }) => (store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null)),
    swap(prisma.siteSetting, 'upsert', async ({ where, update }) => { store.set(where.key, update.value); writes.push(where.key); return {}; }),
  ];
  return { store, writes, restore: () => restores.reverse().forEach((r) => r()) };
}

async function withIntro(fn) {
  const db = installIntroDb();
  try { await fn(db); } finally { db.restore(); }
}
async function withSettings(fn) {
  const db = installSettingsDb();
  try { await fn(db); } finally { db.restore(); }
}

// ---------------------------------------------------------------------------
// r2 promo keys
// ---------------------------------------------------------------------------
test('promo object keys have their own prefix and are never confused with lesson/testimonial keys', () => {
  const k = PROMO_KEY();
  assert.match(k, /^site\/promo\/[0-9a-f-]{36}\.mp4$/);
  assert.equal(r2.isPromoObjectKey(k), true);
  assert.equal(r2.isPromoObjectKey(LESSON_KEY), false);
  assert.equal(r2.isPromoObjectKey(TESTIMONIAL_KEY), false);
  assert.equal(r2.isPromoObjectKey('site/promo/../../secret.mp4'), false);
  assert.equal(r2.isPromoObjectKey('site/promo/abc.mp4'), false);
  assert.equal(r2.isPromoObjectKey(null), false);
  assert.throws(() => r2.buildPromoObjectKey('.exe'), /Unsupported/);
  assert.equal(r2.isOwnedObjectKey(k), true, 'orphan cleanup may delete it');
});

// ---------------------------------------------------------------------------
// Intro video service
// ---------------------------------------------------------------------------
test('intro video is hidden when disabled, empty or without a playable source', async () => {
  assert.equal(intro.toPublicIntroVideo(null), null);
  assert.equal(intro.toPublicIntroVideo({ isEnabled: false, videoType: 'YOUTUBE', videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk' }), null, 'disabled');
  assert.equal(intro.toPublicIntroVideo({ isEnabled: true, heading: 'Hello' }), null, 'enabled but nothing to play');
  assert.equal(intro.toPublicIntroVideo({ isEnabled: true, videoType: 'UPLOAD', videoObjectKey: LESSON_KEY }), null, 'a lesson key is not a playable promo');
  assert.equal(intro.toPublicIntroVideo({ isEnabled: true, videoType: 'YOUTUBE', videoUrl: 'https://evil.example/v' }), null);
});

test('YouTube and Vimeo links become server-built embeds; the raw URL is not exposed', async () => {
  await withIntro(async () => {
    let r = await intro.saveIntroVideo({ isEnabled: 'true', heading: 'Meet us', videoUrl: 'https://youtu.be/abcdefghijk' });
    assert.equal(r.row.videoType, 'YOUTUBE');
    let pub = intro.toPublicIntroVideo(r.row);
    assert.equal(pub.videoKind, 'embed');
    assert.equal(pub.embedUrl, 'https://www.youtube.com/embed/abcdefghijk');
    assert.equal(pub.provider, 'youtube');
    assert.equal('videoUrl' in pub, false);

    r = await intro.saveIntroVideo({ videoUrl: 'https://vimeo.com/123456789' });
    assert.equal(r.row.videoType, 'VIMEO');
    pub = intro.toPublicIntroVideo(r.row);
    assert.equal(pub.embedUrl, 'https://player.vimeo.com/video/123456789');
  });
});

test('only valid https YouTube/Vimeo links are accepted', async () => {
  await withIntro(async (db) => {
    for (const bad of ['https://evil.example/video', 'http://www.youtube.com/watch?v=abcdefghijk', 'javascript:alert(1)', 'https://www.youtube.com/watch?v=<script>']) {
      await assert.rejects(() => intro.saveIntroVideo({ videoUrl: bad }), intro.HomeIntroVideoError, bad);
    }
    assert.equal(db.state.row, null, 'nothing persisted on rejection');
  });
});

test('uploaded promo video: public shape has a source endpoint but never the object key', async () => {
  await withIntro(async () => {
    const key = PROMO_KEY();
    const { row } = await intro.saveIntroVideo({ isEnabled: 'true', heading: 'Hi' }, { videoObjectKey: key });
    assert.equal(row.videoType, 'UPLOAD');
    assert.equal(row.videoObjectKey, key);
    const pub = intro.toPublicIntroVideo(row);
    assert.equal(pub.videoKind, 'hosted');
    assert.ok(!JSON.stringify(pub).includes(key), 'object key must not leave the server');
    assert.ok(!JSON.stringify(pub).includes('site/promo'));
  });
});

test('a non-promo object key is rejected as a hosted video', async () => {
  await withIntro(async () => {
    await assert.rejects(() => intro.saveIntroVideo({}, { videoObjectKey: LESSON_KEY }), /Invalid hosted video/);
    await assert.rejects(() => intro.saveIntroVideo({}, { videoObjectKey: TESTIMONIAL_KEY }), /Invalid hosted video/);
  });
});

test('replace / remove: orphaned objects are reported, an empty link box never wipes an upload', async () => {
  await withIntro(async () => {
    const k1 = PROMO_KEY();
    await intro.saveIntroVideo({}, { videoObjectKey: k1 });
    // The form always posts an (empty) link field: the upload survives.
    let r = await intro.saveIntroVideo({ videoUrl: '', heading: 'x' });
    assert.equal(r.row.videoObjectKey, k1);
    assert.equal(r.orphanedVideoKey, null);
    // Pasting a link replaces the upload and orphans the object.
    r = await intro.saveIntroVideo({ videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk' });
    assert.equal(r.row.videoType, 'YOUTUBE');
    assert.ok(!r.row.videoObjectKey);
    assert.equal(r.orphanedVideoKey, k1);
    // Uploading a new file replaces the link.
    const k2 = PROMO_KEY();
    r = await intro.saveIntroVideo({ videoUrl: '' }, { videoObjectKey: k2 });
    assert.equal(r.row.videoType, 'UPLOAD');
    assert.ok(!r.row.videoUrl);
    // Remove checkbox clears everything and orphans the object.
    r = await intro.saveIntroVideo({ removeVideo: ['', 'true'] });
    assert.ok(!r.row.videoType);
    assert.equal(r.orphanedVideoKey, k2);
    assert.equal(intro.toPublicIntroVideo({ ...r.row, isEnabled: true }), null);
  });
});

test('"Remove video" wins even though the form re-posts the current link', async () => {
  await withIntro(async () => {
    await intro.saveIntroVideo({ isEnabled: 'true', videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk' });
    const r = await intro.saveIntroVideo({ videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk', removeVideo: ['', 'true'] });
    assert.ok(!r.row.videoType && !r.row.videoUrl);
    assert.equal(intro.toPublicIntroVideo({ ...r.row, isEnabled: true }), null);
  });
});

test('poster: uploaded poster replaces and orphans the old one; remove clears it; only safe URLs accepted', async () => {
  await withIntro(async () => {
    await intro.saveIntroVideo({}, { posterUrl: '/uploads/thumbnails/a.jpg' });
    let r = await intro.saveIntroVideo({}, { posterUrl: '/uploads/thumbnails/b.jpg' });
    assert.equal(r.row.posterUrl, '/uploads/thumbnails/b.jpg');
    assert.equal(r.orphanedPosterUrl, '/uploads/thumbnails/a.jpg');
    r = await intro.saveIntroVideo({ removePoster: 'true' });
    assert.ok(!r.row.posterUrl);
    assert.equal(r.orphanedPosterUrl, '/uploads/thumbnails/b.jpg');
    await assert.rejects(() => intro.saveIntroVideo({ posterUrl: 'javascript:alert(1)' }), /Poster/);
  });
});

test('every text field is editable and clearing it clears it publicly (no fallback copy returns)', async () => {
  await withIntro(async () => {
    const key = PROMO_KEY();
    await intro.saveIntroVideo({
      isEnabled: 'true', eyebrow: 'Intro', heading: 'Learn from the best', highlightText: 'the best', description: 'Desc',
      ctaLabel: 'Go', ctaUrl: '/courses', secondaryCtaLabel: 'More', secondaryCtaUrl: 'https://example.com/x',
    }, { videoObjectKey: key });
    let pub = intro.toPublicIntroVideo((await intro.getIntroVideo()));
    assert.equal(pub.heading, 'Learn from the best');
    assert.deepEqual(pub.cta, { label: 'Go', url: '/courses' });
    assert.deepEqual(pub.secondaryCta, { label: 'More', url: 'https://example.com/x' });
    await intro.saveIntroVideo({ eyebrow: '', heading: '', highlightText: '', description: '', ctaLabel: '', secondaryCtaLabel: '' });
    pub = intro.toPublicIntroVideo((await intro.getIntroVideo()));
    assert.equal(pub.eyebrow, '');
    assert.equal(pub.heading, '');
    assert.equal(pub.description, '');
    assert.equal(pub.cta, null);
    assert.equal(pub.secondaryCta, null);
  });
});

test('CTA / secondary links must be a site path or https URL', async () => {
  for (const ok of ['/courses', '/#faq', '/courses?category=x', 'https://example.com/a?b=1']) assert.equal(intro.normalizeLinkUrl(ok, 'Link'), ok, ok);
  assert.equal(intro.normalizeLinkUrl('', 'Link'), null);
  assert.equal(intro.normalizeLinkUrl(undefined, 'Link'), undefined);
  for (const bad of ['//evil.example', 'javascript:alert(1)', 'data:text/html,hi', 'http://example.com', 'courses', '/a b', '/a\\b', 'https://', '/"onmouseover="x', '/<script>']) {
    assert.throws(() => intro.normalizeLinkUrl(bad, 'Link'), intro.HomeIntroVideoError, bad);
  }
});

test('boolean safety: unchecked saves false, an absent field never flips, only allowlisted enums', async () => {
  await withIntro(async (db) => {
    await intro.saveIntroVideo({ isEnabled: ['false', 'true'], ctaEnabled: ['false', 'true'], autoplayMuted: ['false', 'true'], loopVideo: ['false', 'true'] });
    assert.equal(db.state.row.isEnabled, true);
    assert.equal(db.state.row.autoplayMuted, true);
    // Editing a text field alone must not toggle any switch.
    await intro.saveIntroVideo({ heading: 'Only heading' });
    assert.equal(db.state.row.isEnabled, true);
    assert.equal(db.state.row.ctaEnabled, true);
    assert.equal(db.state.row.autoplayMuted, true);
    assert.equal(db.state.row.loopVideo, true);
    assert.equal(db.state.row.heading, 'Only heading');
    // Unchecked => false.
    await intro.saveIntroVideo({ autoplayMuted: ['false'], loopVideo: 'false' });
    assert.equal(db.state.row.autoplayMuted, false);
    assert.equal(db.state.row.loopVideo, false);
    assert.equal(db.state.row.isEnabled, true);
    // Enums
    await intro.saveIntroVideo({ layout: 'CENTERED', videoShape: 'SQUARE', backgroundStyle: 'DARK' });
    assert.equal(db.state.row.layout, 'CENTERED');
    await assert.rejects(() => intro.saveIntroVideo({ layout: 'DIAGONAL' }), /Layout/);
    await assert.rejects(() => intro.saveIntroVideo({ videoShape: '9:16; x' }), /shape/);
    await assert.rejects(() => intro.saveIntroVideo({ backgroundStyle: 'url(x)' }), /Background/);
    await assert.rejects(() => intro.saveIntroVideo({ heading: 'x'.repeat(201) }), /characters or fewer/);
  });
});

test('saving the intro video never touches other homepage settings', async () => {
  const sdb = installSettingsDb();
  try {
    sdb.store.set('homeReviews.heading', 'Keep me');
    sdb.store.set('home.sections.order', '["HERO"]');
    await withIntro(async () => { await intro.saveIntroVideo({ heading: 'x', isEnabled: 'true' }); });
    assert.deepEqual(sdb.writes, [], 'no SiteSetting row written');
    assert.equal(sdb.store.get('homeReviews.heading'), 'Keep me');
  } finally {
    sdb.restore();
  }
});

// ---------------------------------------------------------------------------
// Public source endpoint
// ---------------------------------------------------------------------------
test('intro-video source endpoint signs ONLY promo keys, never exposes the key and honours the enabled flag', async () => {
  const controller = require('../src/controllers/introVideo.controller');
  const videoStorageSettings = require('../src/services/videoStorageSettings.service');
  const signed = [];
  const restores = [
    swap(videoStorageSettings, 'getR2ConfigOrNull', async () => ({ bucket: 'b', secret: 'S3CRET' })),
    swap(r2, 'signedGetUrl', async (_cfg, key) => { signed.push(key); return { url: 'https://signed.example/x?sig=1', expiresInSeconds: 600 }; }),
  ];
  const call = async (row, user) => {
    const restoreDb = swap(prisma.homeIntroVideo, 'findUnique', async () => row);
    const out = { status: 200, body: null, headers: {} };
    const res = { setHeader: (k, v) => { out.headers[k] = v; }, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
    try { await controller.getIntroVideoSource({ currentUser: user }, res, (e) => { throw e; }); } finally { restoreDb(); }
    return out;
  };
  try {
    const key = PROMO_KEY();
    let out = await call({ isEnabled: true, videoObjectKey: key }, null);
    assert.equal(out.status, 200);
    assert.equal(out.body.url, 'https://signed.example/x?sig=1');
    assert.equal(out.body.mimeType, 'video/mp4');
    assert.deepEqual(signed, [key]);
    assert.ok(!JSON.stringify(out.body).includes('site/promo') && !JSON.stringify(out.body).includes('S3CRET'));
    assert.match(out.headers['Cache-Control'], /no-store/);

    signed.length = 0;
    for (const forbidden of [LESSON_KEY, TESTIMONIAL_KEY, 'site/promo/../x.mp4']) {
      out = await call({ isEnabled: true, videoObjectKey: forbidden }, null);
      assert.equal(out.status, 404, forbidden);
    }
    assert.deepEqual(signed, [], 'nothing but promo keys is ever signed');

    out = await call({ isEnabled: false, videoObjectKey: key }, null);
    assert.equal(out.status, 404, 'disabled block is not public');
    out = await call({ isEnabled: false, videoObjectKey: key }, { role: 'ADMIN' });
    assert.equal(out.status, 200, 'an admin can preview a disabled block');
    out = await call({ isEnabled: true, videoObjectKey: null }, null);
    assert.equal(out.status, 404);
    out = await call(null, null);
    assert.equal(out.status, 404);
  } finally {
    restores.reverse().forEach((r) => r());
  }
});

test('source endpoint is rate limited and mounted under /api/home; no enrollment auth', () => {
  const routes = read('src/routes/api/home.routes.js');
  assert.match(routes, /rateLimit\(/);
  assert.match(routes, /router\.get\('\/intro-video\/source', limiter,/);
  assert.doesNotMatch(routes, /requireRole|requireAuth|enrol/i);
  assert.match(read('server.js'), /app\.use\('\/api\/home', homeApiRoutes\)/);
});

// ---------------------------------------------------------------------------
// Public partial
// ---------------------------------------------------------------------------
const renderIntro = (introVideo) => ejs.renderFile(path.join(root, 'views/partials/home-intro-video.ejs'), { introVideo });
const basePublic = {
  eyebrow: 'Introducing', heading: 'Learn directly from our founder', highlightText: 'our founder', description: 'About text',
  videoKind: 'embed', embedUrl: 'https://www.youtube.com/embed/abcdefghijk', provider: 'youtube', posterUrl: '/uploads/thumbnails/p.jpg',
  cta: { label: 'Explore Courses', url: '/courses' }, secondaryCta: null, layout: 'VIDEO_RIGHT', videoShape: 'VERTICAL', backgroundStyle: 'CREAM',
  autoplayMuted: false, loopVideo: false,
};

test('intro partial renders nothing when there is no public intro video', async () => {
  assert.equal((await renderIntro(null)).trim(), '');
  assert.equal((await renderIntro(undefined)).trim(), '');
});

test('intro partial: copy, reel card, poster, labelled play button, safe embed data', async () => {
  const html = await renderIntro(basePublic);
  assert.match(html, /id="intro-video"/);
  assert.match(html, /Introducing/);
  assert.match(html, /Learn directly from <span class="home-intro-hl">our founder<\/span>/);
  assert.match(html, /About text/);
  assert.match(html, /href="\/courses"[^>]*>Explore Courses/);
  assert.match(html, /intro-reel--vertical/);
  assert.match(html, /home-intro--layout-video-right/);
  assert.match(html, /home-intro--bg-cream/);
  assert.match(html, /data-embed="https:\/\/www\.youtube\.com\/embed\/abcdefghijk"/);
  assert.match(html, /aria-label="Play video: Learn directly from our founder"/);
  assert.match(html, /src="\/uploads\/thumbnails\/p\.jpg"/);
  assert.match(html, /home-intro-video\.js/);
  assert.doesNotMatch(html, /<video|<iframe/i, 'the player is created only after a click');
  assert.doesNotMatch(html, /autoplay/i);
  assert.doesNotMatch(html, /Tanu/i, 'no hardcoded copy');
});

test('intro partial: layout / shape / background variants and hosted source (no key in HTML)', async () => {
  const key = PROMO_KEY();
  const html = await renderIntro({ ...basePublic, videoKind: 'hosted', embedUrl: null, provider: null, layout: 'CENTERED', videoShape: 'LANDSCAPE', backgroundStyle: 'DARK', autoplayMuted: true, loopVideo: true });
  assert.match(html, /home-intro--layout-centered/);
  assert.match(html, /intro-reel--landscape/);
  assert.match(html, /home-intro--bg-dark/);
  assert.match(html, /data-source-url="\/api\/home\/intro-video\/source"/);
  assert.match(html, /data-muted-start="1"/);
  assert.match(html, /data-loop="1"/);
  assert.ok(!html.includes('site/promo') && !html.includes(key));
  const left = await renderIntro({ ...basePublic, layout: 'VIDEO_LEFT', videoShape: 'SQUARE' });
  assert.match(left, /home-intro--layout-video-left/);
  assert.match(left, /intro-reel--square/);
});

test('intro partial: hidden copy stays hidden (empty heading / description / no CTA)', async () => {
  const html = await renderIntro({ ...basePublic, eyebrow: '', heading: '', highlightText: '', description: '', cta: null });
  assert.doesNotMatch(html, /section-tag|home-intro-title|home-intro-text|home-intro-actions/);
  assert.match(html, /aria-label="Introduction video"/);
});

test('intro partial escapes admin text', async () => {
  const html = await renderIntro({ ...basePublic, heading: '<script>alert(1)</script>', highlightText: '', description: '<img src=x onerror=alert(1)>' });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x onerror'));
});

test('intro player script: user-gesture play, muted-only autoplay, reduced-motion / data-saver / small-screen guards, embed origin allowlist', () => {
  const js = read('public/js/home-intro-video.js');
  assert.match(js, /prefers-reduced-motion/);
  assert.match(js, /saveData/);
  assert.match(js, /max-width: 767px/);
  assert.match(js, /EMBED_ORIGINS/);
  assert.match(js, /start\(card, \{ muted: false \}\)/, 'click plays with sound');
  assert.match(js, /start\(card, \{ muted: true \}\)/, 'automatic start is always muted');
  assert.match(js, /aria-pressed/);
  assert.match(js, /Mute video/);
});

// ---------------------------------------------------------------------------
// Homepage sections
// ---------------------------------------------------------------------------
test('default section order is today\'s layout with the intro video after the featured courses', () => {
  const { order, hidden } = sections.resolveConfig(undefined, undefined);
  assert.deepEqual(order, ['BANNER', 'HERO', 'CATEGORIES', 'COURSES', 'INTRO_VIDEO', 'ABOUT', 'PROCESS', 'MENTOR', 'HOME_REVIEWS', 'TESTIMONIALS', 'FAQ', 'NEWSLETTER']);
  assert.deepEqual(hidden, []);
});

test('saved order is respected; sections added later keep their default position; junk is ignored', () => {
  const saved = JSON.stringify(['HERO', 'FAQ', 'BOGUS', 'COURSES', 'HERO', 'BANNER']);
  const { order } = sections.resolveConfig(saved, '["FAQ","NOPE"]');
  assert.equal(order[0], 'HERO');
  assert.ok(order.indexOf('HERO') < order.indexOf('FAQ') && order.indexOf('FAQ') < order.indexOf('COURSES') && order.indexOf('COURSES') < order.indexOf('BANNER'), 'saved relative order is kept');
  assert.equal(order.length, sections.SECTION_KEYS.length);
  assert.equal(new Set(order).size, order.length);
  assert.ok(order.indexOf('INTRO_VIDEO') > order.indexOf('COURSES'), 'missing key slots in after its default predecessor');
  assert.deepEqual(sections.resolveConfig(saved, '["FAQ","NOPE"]').hidden, ['FAQ']);
  assert.deepEqual(sections.resolveConfig('not json', 'also not').order, sections.SECTION_KEYS);
});

test('move / toggle write only their own setting (partial save) and getRenderOrder omits hidden sections', async () => {
  await withSettings(async (db) => {
    await sections.moveSection('INTRO_VIDEO', 'up');
    assert.deepEqual(db.writes, [sections.ORDER_KEY]);
    let cfg = await sections.getSectionConfig();
    assert.equal(cfg.order.indexOf('INTRO_VIDEO'), cfg.order.indexOf('COURSES') - 1);

    db.writes.length = 0;
    await sections.toggleSection('FAQ');
    assert.deepEqual(db.writes, [sections.HIDDEN_KEY]);
    const render = await sections.getRenderOrder();
    assert.ok(!render.includes('FAQ'));
    assert.ok(render.includes('NEWSLETTER'));

    await sections.toggleSection('FAQ');
    assert.ok((await sections.getRenderOrder()).includes('FAQ'));
    await assert.rejects(() => sections.moveSection('NOPE', 'up'), sections.HomeSectionsError);
    await assert.rejects(() => sections.moveSection('HERO', 'sideways'), sections.HomeSectionsError);
    await assert.rejects(() => sections.toggleSection('__proto__'), sections.HomeSectionsError);
    // Moving the first section up / last down is a no-op, not an error.
    await sections.moveSection(cfg.order[0], 'up');
    cfg = await sections.getSectionConfig();
    assert.ok(cfg.order.length === sections.SECTION_KEYS.length);
  });
});

test('home-content renders sections in the saved order and skips the ones that are not listed', async () => {
  const file = path.join(root, 'views/public/home-content.ejs');
  const ctx = { introVideo: basePublic, homeReviews: [], homeReviewSettings: null, cms: {}, banners: [] };
  const a = await ejs.renderFile(file, { ...ctx, homeSectionOrder: ['INTRO_VIDEO', 'HOME_REVIEWS'] });
  assert.match(a, /id="intro-video"/);
  const none = await ejs.renderFile(file, { ...ctx, homeSectionOrder: ['HOME_REVIEWS'] });
  assert.doesNotMatch(none, /id="intro-video"/, 'a hidden section is not rendered');
  const reviews = [{ id: 1, rating: 5, quote: 'q', reviewerName: 'A B', initials: 'AB', hasVideo: false }];
  const ordered = await ejs.renderFile(file, { ...ctx, homeReviews: reviews, homeSectionOrder: ['HOME_REVIEWS', 'INTRO_VIDEO'] });
  assert.ok(ordered.indexOf('id="reviews"') < ordered.indexOf('id="intro-video"'), 'order follows the admin setting');
  const flipped = await ejs.renderFile(file, { ...ctx, homeReviews: reviews, homeSectionOrder: ['INTRO_VIDEO', 'HOME_REVIEWS'] });
  assert.ok(flipped.indexOf('id="intro-video"') < flipped.indexOf('id="reviews"'));
});

test('home controller loads the intro video and the saved section order', () => {
  const src = read('src/controllers/home.controller.js');
  assert.match(src, /homeIntroVideoService\.getPublicIntroVideo\(\)/);
  assert.match(src, /homeSectionsService\.getRenderOrder\(\)/);
  assert.match(src, /introVideo,\n\s+homeSectionOrder,/);
});

// ---------------------------------------------------------------------------
// Admin wiring
// ---------------------------------------------------------------------------
function mkRes() {
  const r = { redirected: null, rendered: null };
  r.redirect = (u) => { r.redirected = u; };
  r.render = (v, d) => { r.rendered = { view: v, data: d }; };
  return r;
}
function mkReq(body, extra = {}) {
  const flash = [];
  return Object.assign({ body, params: {}, flash, flashError: (m) => flash.push(['e', m]), flashSuccess: (m) => flash.push(['s', m]) }, extra);
}

test('admin intro video controller persists the form, adopts uploaded media and flashes validation errors', async () => {
  const controller = require('../src/controllers/admin/homeIntroVideo.controller');
  await withIntro(async (db) => {
    const key = PROMO_KEY();
    const req = mkReq(
      { isEnabled: ['false', 'true'], heading: 'Via admin', ctaLabel: 'Go', ctaUrl: '/courses', videoUrl: '' },
      { files: { video: [{ r2Key: key }], poster: [{ filename: 'poster.jpg' }] }, introMediaAdopted: { video: false, poster: false } }
    );
    const res = mkRes();
    await controller.save(req, res, (e) => { throw e; });
    assert.equal(res.redirected, '/admin/homepage/intro-video');
    assert.equal(req.flash[0][0], 's');
    assert.equal(db.state.row.heading, 'Via admin');
    assert.equal(db.state.row.videoObjectKey, key);
    assert.equal(db.state.row.posterUrl, '/uploads/thumbnails/poster.jpg');
    assert.deepEqual(req.introMediaAdopted, { video: true, poster: true });

    const bad = mkReq({ ctaUrl: 'javascript:alert(1)' }, { introMediaAdopted: { video: false, poster: false } });
    const res2 = mkRes();
    await controller.save(bad, res2, (e) => { throw e; });
    assert.equal(bad.flash[0][0], 'e');
    assert.equal(db.state.row.ctaUrl, '/courses', 'a rejected save changes nothing');
    assert.deepEqual(bad.introMediaAdopted, { video: false, poster: false }, 'unadopted uploads are discarded by the middleware');
  });
});

test('admin intro video + sections pages render', async () => {
  const base = { csrfToken: 't', currentUser: { name: 'A' }, site: {}, flash: {}, metaDescription: '' };
  const html = await ejs.renderFile(path.join(root, 'views/admin/homepage/intro-video.ejs'), {
    ...base, pageTitle: 'x', video: { ...intro.DEFAULTS, isEnabled: true, heading: 'H', videoType: 'YOUTUBE', videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk', posterUrl: '/uploads/thumbnails/p.jpg' },
    preview: null, r2Configured: false,
    options: { LAYOUTS: intro.LAYOUTS, SHAPES: intro.SHAPES, BACKGROUNDS: intro.BACKGROUNDS, LABELS: intro.LABELS },
  });
  assert.match(html, /enctype="multipart\/form-data"/);
  for (const n of ['isEnabled', 'eyebrow', 'heading', 'highlightText', 'description', 'videoUrl', 'video', 'poster', 'removeVideo', 'removePoster', 'ctaEnabled', 'ctaLabel', 'ctaUrl', 'secondaryCtaLabel', 'secondaryCtaUrl', 'layout', 'videoShape', 'backgroundStyle', 'autoplayMuted', 'loopVideo']) {
    assert.match(html, new RegExp(`name="${n}"`), n);
  }
  assert.match(html, /<input type="hidden" name="isEnabled" value="false">/, 'checkbox pairs post a hidden false');
  assert.match(html, /Remove the current video/);
  assert.doesNotMatch(html, /<textarea[^>]*name="(css|style|html)"/i);
  const sec = await ejs.renderFile(path.join(root, 'views/admin/homepage/sections.ejs'), {
    ...base, pageTitle: 'x', sections: sections.resolveConfig(undefined, '["FAQ"]'), labels: Object.fromEntries(sections.SECTIONS.map((s) => [s.key, s.label])),
  });
  assert.match(sec, /Intro \/ promo video/);
  assert.match(sec, /homepage\/sections\/INTRO_VIDEO\/move/);
  assert.match(sec, /homepage\/sections\/FAQ\/toggle/);
  assert.match(sec, /Hidden/);
});

test('admin routes: every POST is CSRF protected; the multipart upload runs before CSRF; sidebar links exist', () => {
  const src = read('src/routes/adminHomeMedia.routes.js');
  const posts = [...src.matchAll(/router\.post\(([^\n]+)\);/g)].map((m) => m[1]);
  assert.ok(posts.length >= 4);
  for (const p of posts) assert.match(p, /doubleCsrfProtection/, p);
  assert.match(src, /uploadIntroVideoMedia\(\), doubleCsrfProtection, introVideoController\.save/);
  const header = read('views/partials/admin-header.ejs');
  assert.match(header, /\/admin\/homepage\/intro-video/);
  assert.match(header, /\/admin\/homepage\/sections/);
  const admin = read('src/routes/admin.routes.js');
  assert.match(admin, /require\('\.\/adminHomeMedia\.routes'\)/);
});

test('intro video upload middleware only accepts mp4/webm into the promo prefix and images for the poster', () => {
  const src = read('src/middleware/introVideoUpload.middleware.js');
  assert.match(src, /buildPromoObjectKey\(ext\)/);
  assert.match(src, /isAllowedVideoFile/);
  assert.match(src, /imageStorage\.isAllowedFile/);
  assert.match(src, /rejectIfSpoofed/);
  assert.match(src, /Unexpected file field/);
});

test('source-of-truth: every public intro value has a service field, a column and an admin input', () => {
  const partial = read('views/partials/home-intro-video.ejs');
  const used = new Set([...partial.matchAll(/\biv\.(\w+)/g)].map((m) => m[1]));
  const publicKeys = Object.keys(intro.toPublicIntroVideo({ isEnabled: true, videoType: 'YOUTUBE', videoUrl: 'https://youtu.be/abcdefghijk' }));
  assert.deepEqual([...used].filter((u) => !publicKeys.includes(u)), [], 'partial reads a field the service does not provide');
  const schema = read('prisma/schema.prisma');
  const model = schema.match(/model HomeIntroVideo \{([\s\S]*?)\n\}/)[1];
  const adminView = read('views/admin/homepage/intro-video-content.ejs');
  for (const f of Object.keys(intro.DEFAULTS)) {
    assert.match(model, new RegExp(`\\b${f}\\b`), `column ${f}`);
    if (f === 'videoObjectKey' || f === 'videoType') continue; // set via upload / link detection
    if (f === 'posterUrl') { assert.match(adminView, /name="poster"/); continue; }
    if (f === 'videoUrl') { assert.match(adminView, /name="videoUrl"/); continue; }
    assert.match(adminView, new RegExp(`name="${f}"`), `admin input ${f}`);
  }
});
