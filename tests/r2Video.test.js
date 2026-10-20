process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const express = require('express');
const cookieParser = require('cookie-parser');

const { prisma } = require('../src/config/db');
const secretBox = require('../src/lib/secretBox');
const r2 = require('../src/lib/r2');
const { hasVideoSignature, isSelfHostedVideo } = require('../src/lib/videoStorage');
const { SignatureCheck, VideoSignatureError } = require('../src/lib/r2MulterStorage');
const settingsSvc = require('../src/services/videoStorageSettings.service');
const r2Cleanup = require('../src/services/r2Cleanup.service');
const lessonService = require('../src/services/lesson.service');
const mediaController = require('../src/controllers/media.controller');
const lessonController = require('../src/controllers/admin/lesson.controller');

const FAKE = {
  accountId: '4fd436c71901fb085c2c0e3d88cfc820',
  accessKeyId: 'AKIAEXAMPLEEXAMPLE1234',
  secretAccessKey: 'super-secret-value-that-must-never-leak-0001',
  bucket: 'unit-test-bucket',
  endpoint: '',
};
const GOOD_KEY = 'courses/3/lessons/9/123e4567-e89b-12d3-a456-426614174000.mp4';

function serve(app) {
  const server = http.createServer(app);
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  );
}

// --- secret encryption ----------------------------------------------------------

test('secretBox round-trips, uses random IVs and rejects tampering', () => {
  const a = secretBox.encrypt('s3cret-value-1234567890');
  const b = secretBox.encrypt('s3cret-value-1234567890');
  assert.notEqual(a, b);
  assert.ok(!a.includes('s3cret'));
  assert.equal(secretBox.decrypt(a), 's3cret-value-1234567890');
  const parts = a.split(':');
  parts[3] = Buffer.from('tampered').toString('base64');
  assert.equal(secretBox.decrypt(parts.join(':')), null); // tampering => unusable, never garbage
  assert.equal(secretBox.decrypt('not-encrypted'), null);
});

test('an undecryptable stored secret is reported as not configured instead of crashing', async () => {
  const orig = prisma.siteSetting.findMany;
  prisma.siteSetting.findMany = async () => [
    { key: settingsSvc.KEYS.provider, value: 'CLOUDFLARE_R2' },
    { key: settingsSvc.KEYS.accountId, value: FAKE.accountId },
    { key: settingsSvc.KEYS.accessKeyId, value: FAKE.accessKeyId },
    { key: settingsSvc.KEYS.bucket, value: FAKE.bucket },
    { key: settingsSvc.KEYS.secret, value: 'v1:garbage:garbage:garbage' },
  ];
  try {
    settingsSvc.invalidateCache();
    const view = await settingsSvc.getAdminView();
    assert.equal(view.secretConfigured, false);
    assert.equal(view.activeProvider, 'LOCAL'); // falls back, uploads keep working
    assert.equal(await settingsSvc.getR2ConfigOrNull(), null);
  } finally {
    prisma.siteSetting.findMany = orig;
    settingsSvc.invalidateCache();
  }
});

// --- settings: validation, encryption at rest, masking ---------------------------

test('settings validation: SSRF-safe endpoint, required fields, blank secret keeps existing', () => {
  const base = { provider: 'CLOUDFLARE_R2', accountId: FAKE.accountId, accessKeyId: FAKE.accessKeyId, bucket: 'my-bucket' };
  assert.ok(settingsSvc.validate({ ...base, secretAccessKey: '' }, { secretConfigured: false }).errors.length > 0);
  assert.equal(settingsSvc.validate({ ...base, secretAccessKey: '' }, { secretConfigured: true }).errors.length, 0);
  for (const endpoint of ['http://a.r2.cloudflarestorage.com', 'https://evil.example.com', 'https://169.254.169.254', 'https://a.r2.cloudflarestorage.com/x']) {
    assert.ok(
      settingsSvc.validate({ ...base, secretAccessKey: FAKE.secretAccessKey, endpoint }, null).errors.some((e) => /Endpoint/.test(e)),
      endpoint
    );
  }
  assert.equal(
    settingsSvc.validate({ ...base, secretAccessKey: FAKE.secretAccessKey, endpoint: `https://${FAKE.accountId}.r2.cloudflarestorage.com` }, null).errors.length,
    0
  );
  assert.ok(settingsSvc.validate({ ...base, bucket: '../x', secretAccessKey: FAKE.secretAccessKey }, null).errors.length > 0);
});

test('settings save stores the secret encrypted and the admin view only exposes masked data', async () => {
  const store = new Map();
  const orig = { ...prisma.siteSetting };
  const origTx = prisma.$transaction;
  prisma.siteSetting.upsert = async ({ where, create }) => (store.set(where.key, create.value), {});
  prisma.siteSetting.deleteMany = async ({ where }) => (store.delete(where.key), {});
  prisma.siteSetting.findMany = async () => [...store].map(([key, value]) => ({ key, value }));
  prisma.$transaction = async (ops) => Promise.all(ops);
  try {
    settingsSvc.invalidateCache();
    const { errors, values } = settingsSvc.validate(
      { provider: 'CLOUDFLARE_R2', accountId: FAKE.accountId, accessKeyId: FAKE.accessKeyId, bucket: FAKE.bucket, secretAccessKey: FAKE.secretAccessKey },
      null
    );
    assert.deepEqual(errors, []);
    await settingsSvc.save(values);

    const stored = store.get(settingsSvc.KEYS.secret);
    assert.ok(stored.startsWith('v1:') && !stored.includes(FAKE.secretAccessKey));

    const view = await settingsSvc.getAdminView();
    const json = JSON.stringify(view);
    assert.ok(!json.includes(FAKE.secretAccessKey));
    assert.ok(!json.includes(FAKE.accessKeyId));
    assert.equal(view.secretConfigured, true);
    assert.match(view.accessKeyMasked, /••••/);
    assert.equal(view.activeProvider, 'CLOUDFLARE_R2');
    assert.equal((await settingsSvc.getR2ConfigOrNull()).secretAccessKey, FAKE.secretAccessKey);

    // blank secret on a later save preserves the stored one
    const again = settingsSvc.validate({ provider: 'CLOUDFLARE_R2', accountId: FAKE.accountId, accessKeyId: FAKE.accessKeyId, bucket: FAKE.bucket, secretAccessKey: '' }, view);
    await settingsSvc.save(again.values);
    assert.equal(store.get(settingsSvc.KEYS.secret), stored);
  } finally {
    Object.assign(prisma.siteSetting, orig);
    prisma.$transaction = origTx;
    settingsSvc.invalidateCache();
  }
});

// --- object keys, traversal, signatures ------------------------------------------

test('object keys are server-generated and traversal / foreign keys are rejected', () => {
  assert.ok(r2.isOwnedObjectKey(GOOD_KEY));
  assert.ok(r2.isOwnedObjectKey(r2.buildObjectKey(3, 'new', '.webm')));
  for (const bad of [
    '../etc/passwd', 'courses/3/lessons/9/../../x.mp4', '/courses/3/lessons/9/123e4567-e89b-12d3-a456-426614174000.mp4',
    'courses/3/lessons/9/evil.mp4', 'courses/x/lessons/9/123e4567-e89b-12d3-a456-426614174000.mp4',
    'other/3/lessons/9/123e4567-e89b-12d3-a456-426614174000.mp4', `${GOOD_KEY}/..`, `${GOOD_KEY}.exe`, '', null, undefined, 42,
  ]) {
    assert.equal(r2.isOwnedObjectKey(bad), false, String(bad));
  }
  assert.throws(() => r2.buildObjectKey(3, 9, '.exe'));
  assert.throws(() => r2.buildObjectKey(-1, 9, '.mp4'));
  const k = r2.buildObjectKey(3, 9, '.mp4');
  assert.ok(!k.includes('..') && k.startsWith('courses/3/lessons/9/'));
});

test('file signature check accepts MP4/WebM and rejects other content', async () => {
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(32)]);
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(32)]);
  assert.equal(hasVideoSignature(mp4, '.mp4'), true);
  assert.equal(hasVideoSignature(webm, '.webm'), true);
  assert.equal(hasVideoSignature(webm, '.mp4'), false);
  assert.equal(hasVideoSignature(Buffer.from('MZ' + 'x'.repeat(40)), '.mp4'), false);

  const collect = async (buf, ext) => {
    const chunks = [];
    const sink = new (require('node:stream').Writable)({ write(c, _e, cb) { chunks.push(c); cb(); } });
    await pipeline(Readable.from([buf.subarray(0, 5), buf.subarray(5)]), new SignatureCheck(ext), sink);
    return Buffer.concat(chunks);
  };
  assert.deepEqual(await collect(mp4, '.mp4'), mp4); // bytes pass through unchanged
  await assert.rejects(collect(Buffer.from('<html>' + 'a'.repeat(40)), '.mp4'), VideoSignatureError);
});

// --- signed URLs --------------------------------------------------------------------

test('signed URLs are short-lived, clamp TTL and never contain the secret', async () => {
  const { url, expiresInSeconds } = await r2.signedGetUrl(FAKE, GOOD_KEY);
  assert.equal(expiresInSeconds, r2.SIGNED_URL_TTL_SECONDS);
  assert.ok(expiresInSeconds <= 900);
  const u = new URL(url);
  assert.equal(u.protocol, 'https:');
  assert.match(u.hostname, /\.r2\.cloudflarestorage\.com$/);
  assert.equal(u.searchParams.get('X-Amz-Expires'), String(expiresInSeconds));
  assert.ok(u.searchParams.get('X-Amz-Signature'));
  assert.ok(!url.includes(FAKE.secretAccessKey));
  assert.equal((await r2.signedGetUrl(FAKE, GOOD_KEY, 999999)).expiresInSeconds, 3600);
  assert.equal((await r2.signedGetUrl(FAKE, GOOD_KEY, 1)).expiresInSeconds, 30);
  await assert.rejects(r2.signedGetUrl(FAKE, '../../secret'), /Invalid object key/);
});

// --- /api/lessons/:id/video-source authorization ---------------------------------

function sourceApp(user) {
  const app = express();
  app.use((req, _res, next) => { req.currentUser = user; next(); });
  app.use('/api/lessons', require('../src/routes/api/lessons.routes'));
  return serve(app);
}

function stubLessonDb(lesson, enrolled) {
  const o = { lesson: prisma.lesson.findUnique, enr: prisma.enrollment.findUnique, settings: settingsSvc.getR2ConfigOrNull };
  prisma.lesson.findUnique = async ({ where }) => (lesson && where.id === lesson.id ? lesson : null);
  prisma.enrollment.findUnique = async () => (enrolled ? { status: 'ACTIVE' } : null);
  settingsSvc.getR2ConfigOrNull = async () => FAKE;
  return () => { prisma.lesson.findUnique = o.lesson; prisma.enrollment.findUnique = o.enr; settingsSvc.getR2ConfigOrNull = o.settings; };
}

const R2_LESSON = { id: 9, courseId: 3, status: 'PUBLISHED', preview: false, videoType: 'R2', videoObjectKey: GOOD_KEY, videoMimeType: 'video/mp4', course: { id: 3, slug: 'c' } };

test('video-source: anonymous 401, unenrolled 403, enrolled gets only a signed URL', async () => {
  const restore = stubLessonDb(R2_LESSON, false);
  try {
    let { server, port } = await sourceApp(null);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/lessons/9/video-source`);
      assert.equal(r.status, 401);
      assert.ok(!(await r.text()).includes('http'));
    } finally { server.close(); }

    ({ server, port } = await sourceApp({ id: 5, role: 'STUDENT' }));
    try {
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/lessons/9/video-source`)).status, 403);
    } finally { server.close(); }

    prisma.enrollment.findUnique = async () => ({ status: 'ACTIVE' });
    ({ server, port } = await sourceApp({ id: 5, role: 'STUDENT' }));
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/lessons/9/video-source`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('cache-control'), /no-store/);
      const text = await r.text();
      const body = JSON.parse(text);
      assert.deepEqual(Object.keys(body).sort(), ['expiresInSeconds', 'mimeType', 'url']);
      assert.ok(body.url.includes('X-Amz-Signature'));
      for (const secret of [FAKE.secretAccessKey, FAKE.accessKeyId.toLowerCase() === '' ? 'x' : 'secretAccessKey']) {
        assert.ok(!text.includes(secret));
      }
      assert.ok(!text.includes(FAKE.secretAccessKey));
    } finally { server.close(); }
  } finally { restore(); }
});

test('video-source: malformed ids, unknown/unpublished/LOCAL lessons and expired enrollment are denied', async () => {
  const restore = stubLessonDb(R2_LESSON, true);
  try {
    const { server, port } = await sourceApp({ id: 5, role: 'STUDENT' });
    try {
      for (const id of ['abc', '0', '-1', '1e3', '1.5', '99999999999999', '2147483648', '%20', 'null']) {
        assert.equal((await fetch(`http://127.0.0.1:${port}/api/lessons/${id}/video-source`)).status, 404, id);
      }
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/lessons/77/video-source`)).status, 404);

      prisma.lesson.findUnique = async () => ({ ...R2_LESSON, status: 'DRAFT' });
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/lessons/9/video-source`)).status, 404);
      prisma.lesson.findUnique = async () => ({ ...R2_LESSON, videoType: 'LOCAL', videoObjectKey: null, videoPath: 'c/x.mp4' });
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/lessons/9/video-source`)).status, 404);

      prisma.lesson.findUnique = async () => R2_LESSON;
      prisma.enrollment.findUnique = async () => ({ status: 'EXPIRED' });
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/lessons/9/video-source`)).status, 403);
    } finally { server.close(); }
  } finally { restore(); }
});

// --- cleanup, replacement, deletion --------------------------------------------------

test('cleanup only ever deletes ICDS-owned keys that no other lesson uses', async () => {
  const calls = [];
  const o = { del: r2.deleteObject, find: prisma.lesson.findFirst, cfg: settingsSvc.getR2ConfigOrNull };
  r2.deleteObject = async (_c, key) => (calls.push(key), true);
  settingsSvc.getR2ConfigOrNull = async () => FAKE;
  try {
    prisma.lesson.findFirst = async () => null;
    assert.equal(await r2Cleanup.deleteObjectIfUnreferenced('../../etc/passwd'), false);
    assert.equal(await r2Cleanup.deleteObjectIfUnreferenced('some/other/object.mp4'), false);
    assert.deepEqual(calls, []);
    assert.equal(await r2Cleanup.deleteObjectIfUnreferenced(GOOD_KEY, [9]), true);
    assert.deepEqual(calls, [GOOD_KEY]);
    prisma.lesson.findFirst = async () => ({ id: 12 }); // still referenced elsewhere
    assert.equal(await r2Cleanup.deleteObjectIfUnreferenced(GOOD_KEY, [9]), false);
    assert.equal(calls.length, 1);
  } finally {
    r2.deleteObject = o.del; prisma.lesson.findFirst = o.find; settingsSvc.getR2ConfigOrNull = o.cfg;
  }
});

function fakeRes() {
  const res = { redirected: null };
  res.redirect = (to) => { res.redirected = to; };
  return res;
}
const OLD_KEY = 'courses/3/lessons/9/aaaaaaaa-e89b-12d3-a456-426614174000.mp4';
const NEW_KEY = 'courses/3/lessons/9/bbbbbbbb-e89b-12d3-a456-426614174000.mp4';

test('replacement: DB updated first, then old object deleted; DB failure deletes the NEW orphan only', async () => {
  const deleted = [];
  const o = { del: r2.deleteObject, upd: prisma.lesson.update, find: prisma.lesson.findFirst, cfg: settingsSvc.getR2ConfigOrNull };
  const order = [];
  r2.deleteObject = async (_c, key) => { order.push(`delete:${key}`); deleted.push(key); return true; };
  prisma.lesson.findFirst = async () => null;
  settingsSvc.getR2ConfigOrNull = async () => FAKE;
  const mkReq = () => ({
    lessonForVideo: { id: 9, courseId: 3, videoType: 'R2', videoObjectKey: OLD_KEY, course: { slug: 'c' } },
    file: { provider: 'R2', r2Key: NEW_KEY, size: 1234, mimetype: 'video/mp4' },
    r2UploadConfig: FAKE,
    params: { id: '9' },
    flashSuccess() {}, flashError() {},
  });
  try {
    prisma.lesson.update = async () => { order.push('db'); return {}; };
    await lessonController.uploadLessonVideo(mkReq(), fakeRes(), (e) => { throw e; });
    assert.deepEqual(order, ['db', `delete:${OLD_KEY}`]);

    order.length = 0; deleted.length = 0;
    prisma.lesson.update = async () => { throw new Error('db down'); };
    let nextErr = null;
    await lessonController.uploadLessonVideo(mkReq(), fakeRes(), (e) => { nextErr = e; });
    await new Promise((r) => setImmediate(r));
    assert.ok(nextErr);
    assert.deepEqual(deleted, [NEW_KEY]); // old working video untouched
  } finally {
    r2.deleteObject = o.del; prisma.lesson.update = o.upd; prisma.lesson.findFirst = o.find; settingsSvc.getR2ConfigOrNull = o.cfg;
  }
});

test('deleting an R2 lesson removes its object after the DB row; LOCAL lessons never touch R2', async () => {
  const deleted = [];
  const o = { del: r2.deleteObject, fu: prisma.lesson.findUnique, d: prisma.lesson.delete, ff: prisma.lesson.findFirst, cfg: settingsSvc.getR2ConfigOrNull };
  r2.deleteObject = async (_c, key) => (deleted.push(key), true);
  settingsSvc.getR2ConfigOrNull = async () => FAKE;
  prisma.lesson.findFirst = async () => null;
  prisma.lesson.delete = async () => ({});
  try {
    prisma.lesson.findUnique = async () => ({ id: 9, courseId: 3, videoType: 'R2', videoObjectKey: GOOD_KEY });
    assert.equal(await lessonService.deleteLesson(9), 3);
    assert.deepEqual(deleted, [GOOD_KEY]);
    deleted.length = 0;
    prisma.lesson.findUnique = async () => ({ id: 10, courseId: 3, videoType: 'LOCAL', videoPath: 'course/missing.mp4', videoObjectKey: null });
    await lessonService.deleteLesson(10);
    assert.deepEqual(deleted, []);
  } finally {
    r2.deleteObject = o.del; prisma.lesson.findUnique = o.fu; prisma.lesson.delete = o.d; prisma.lesson.findFirst = o.ff; settingsSvc.getR2ConfigOrNull = o.cfg;
  }
});

// --- backward compatibility & progress ---------------------------------------------

test('LOCAL videos stay supported and R2 is treated as self-hosted', () => {
  assert.equal(isSelfHostedVideo({ videoType: 'LOCAL', videoPath: 'c/a.mp4' }), true);
  assert.equal(isSelfHostedVideo({ videoType: 'R2', videoObjectKey: GOOD_KEY }), true);
  assert.equal(isSelfHostedVideo({ videoType: 'R2', videoObjectKey: null }), false);
  assert.equal(isSelfHostedVideo({ videoType: 'EXTERNAL', videoUrl: 'https://youtu.be/x' }), false);
  assert.equal(typeof mediaController.getLessonVideo, 'function'); // /media route unchanged
});

test('manual "Mark Complete" is refused for R2 videos (progress rules unchanged)', async () => {
  const progress = require('../src/services/progress.service');
  const o = { l: prisma.lesson.findUnique, e: prisma.enrollment.findUnique };
  prisma.lesson.findUnique = async () => ({ id: 9, courseId: 3, status: 'PUBLISHED', videoType: 'R2' });
  prisma.enrollment.findUnique = async () => ({ status: 'ACTIVE' });
  try {
    await assert.rejects(progress.markLessonComplete(5, 9), /completed by watching/);
  } finally { prisma.lesson.findUnique = o.l; prisma.enrollment.findUnique = o.e; }
});

// --- admin-only + CSRF -------------------------------------------------------------

function adminApp(user) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    req.currentUser = user;
    res.render = (view, data) => res.type('json').send({ view, hasSecret: JSON.stringify(data || {}).includes(FAKE.secretAccessKey) });
    next();
  });
  app.use('/admin', require('../src/routes/admin.routes'));
  return serve(app);
}

test('Video Storage admin routes: admin-only and CSRF-protected', async () => {
  let { server, port } = await adminApp(null);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/admin/video-storage`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), /^\/login/);
  } finally { server.close(); }

  ({ server, port } = await adminApp({ id: 5, role: 'STUDENT' }));
  try {
    for (const [m, p] of [['GET', '/admin/video-storage'], ['POST', '/admin/video-storage'], ['POST', '/admin/video-storage/test'], ['POST', '/admin/lessons/9/video/migrate-r2']]) {
      assert.equal((await fetch(`http://127.0.0.1:${port}${p}`, { method: m })).status, 403, `${m} ${p}`);
    }
  } finally { server.close(); }

  ({ server, port } = await adminApp({ id: 1, role: 'ADMIN' }));
  try {
    for (const p of ['/admin/video-storage', '/admin/video-storage/test', '/admin/lessons/9/video/migrate-r2']) {
      const res = await fetch(`http://127.0.0.1:${port}${p}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'provider=CLOUDFLARE_R2&secretAccessKey=whatever-secret-value-123',
      });
      assert.equal(res.status, 403, `POST ${p} without CSRF token must be rejected`);
    }
    // malformed lesson id on the migrate route: clean 404 before any controller runs
    assert.equal((await fetch(`http://127.0.0.1:${port}/admin/lessons/abc/video/migrate-r2`, { method: 'POST' })).status, 404);
  } finally { server.close(); }
});
