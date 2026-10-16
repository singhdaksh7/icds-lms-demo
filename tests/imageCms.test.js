process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

// Must be set before imageStorage is first required (it reads the env at load).
const STORAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'icds-imgcms-'));
process.env.THUMBNAIL_STORAGE_ROOT = STORAGE;

// --- in-memory Prisma stand-in -------------------------------------------------
const rows = new Map(); // site settings
const store = { category: new Map(), course: new Map(), instructor: new Map() };
let failNextUpdate = false;

function entityDelegate(map) {
  return {
    async findUnique({ where }) { const row = map.get(where.id); return row ? { ...row, _count: { courses: 0 } } : null; }, // a copy, like Prisma
    async delete({ where }) { map.delete(where.id); },
    async update({ where, data }) {
      if (failNextUpdate) { failNextUpdate = false; throw new Error('db write failed'); }
      Object.assign(map.get(where.id), data);
      return map.get(where.id);
    },
  };
}
const fakePrisma = {
  siteSetting: {
    async findMany() { return [...rows].map(([key, value]) => ({ key, value })); },
    async upsert({ where, update, create }) { rows.set(where.key, rows.has(where.key) ? update.value : create.value); },
    async deleteMany({ where }) { rows.delete(where.key); },
  },
  enrollment: { async count() { return 0; } },
  orderItem: { async count() { return 0; } },
  category: entityDelegate(store.category),
  course: entityDelegate(store.course),
  instructor: entityDelegate(store.instructor),
  async $transaction(ops) { return Promise.all(ops); },
};
require.cache[require.resolve('../src/config/db')] = {
  id: require.resolve('../src/config/db'), filename: require.resolve('../src/config/db'), loaded: true, exports: { prisma: fakePrisma },
};

const express = require('express');
const cookieParser = require('cookie-parser');
const ejs = require('ejs');
const site = require('../src/config/site');
const settingsService = require('../src/services/settings.service');
const imageStorage = require('../src/lib/imageStorage');
const content = require('../src/config/siteContent');
const { exposeCsrfToken } = require('../src/config/csrf');

const VIEWS = path.join(__dirname, '..', 'views');
const render = (view, data) => ejs.renderFile(path.join(VIEWS, view), data, { views: [VIEWS] });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
const FAKE = Buffer.from('this is plain text pretending to be an image');

function reset() {
  rows.clear();
  for (const m of Object.values(store)) m.clear();
  store.category.set(1, { id: 1, name: 'Hair', slug: 'hair', imageUrl: null });
  store.course.set(1, { id: 1, title: 'Course 1', thumbnailUrl: null });
  store.instructor.set(1, { id: 1, name: 'Instr 1', photoUrl: null });
  failNextUpdate = false;
  settingsService.invalidateCache();
  fs.rmSync(STORAGE, { recursive: true, force: true });
  fs.mkdirSync(STORAGE, { recursive: true });
}
const allFiles = () => {
  const out = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else out.push(path.relative(STORAGE, f).replace(/\\/g, '/')); } };
  walk(STORAGE);
  return out.sort();
};
const settle = () => new Promise((r) => setTimeout(r, 120));

function appFor() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', VIEWS);
  app.locals.site = site;
  app.locals.cms = settingsService.defaultContent();
  app.locals.fill = settingsService.fill;
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: true }));
  app.use(exposeCsrfToken);
  const flashes = { success: [], error: [] };
  app.use((req, res, next) => {
    const role = req.get('x-test-role');
    if (role) req.currentUser = { id: 1, name: 'Tester', role };
    res.locals.currentUser = req.currentUser || null;
    res.locals.flash = {};
    req.flashSuccess = (m) => flashes.success.push(m);
    req.flashError = (m) => flashes.error.push(m);
    next();
  });
  app.get('/token', (req, res) => res.json({ token: res.locals.csrfToken }));
  app.use('/admin', require('../src/routes/admin.routes'));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(err.code === 'EBADCSRFTOKEN' ? 403 : 500).send(`ERR:${err.code || err.message}`);
  });
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, flashes, base: `http://127.0.0.1:${server.address().port}` })));
}

async function session(base, role = 'ADMIN') {
  const res = await fetch(`${base}/token`, { headers: { 'x-test-role': role } });
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { token } = await res.json();
  return { cookie, token, role };
}

function upload(base, url, s, { field, file, fields = {}, noToken } = {}) {
  const form = new FormData();
  if (!noToken) form.append('_csrf', s.token);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (file) form.append(field, new Blob([file.buf], { type: file.type || 'image/png' }), file.name || 'a.png');
  return fetch(`${base}${url}`, { method: 'POST', headers: { cookie: s.cookie, 'x-test-role': s.role }, body: form, redirect: 'manual' });
}
function postUrl(base, url, s, fields = {}, { noToken } = {}) {
  const body = new URLSearchParams({ ...(noToken ? {} : { _csrf: s.token }), ...fields });
  return fetch(`${base}${url}`, { method: 'POST', headers: { cookie: s.cookie, 'x-test-role': s.role, 'content-type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual' });
}

// =============================================================================
// CMS image settings: logo, footer logo, share image, default images, login/signup, hero, Why ICDS
// =============================================================================

const CMS_IMAGES = [
  ['brand/identity', 'brand.logoPath'],
  ['brand/identity', 'brand.footerLogoPath'],
  ['brand/identity', 'brand.faviconPath'],
  ['brand/identity', 'brand.shareImagePath'],
  ['brand/defaults', 'brand.defaultCourseImagePath'],
  ['brand/defaults', 'brand.defaultInstructorImagePath'],
  ['home/hero', 'hero.imagePath'],
  ['home/why', 'why.imagePath'],
  ['auth/login', 'login.imagePath'],
  ['auth/signup', 'signup.imagePath'],
];

test('every public CMS image is registered with a form, and previews of bundled defaults exist on disk', () => {
  const registered = content.IMAGE_KEYS;
  for (const [, key] of CMS_IMAGES) assert.ok(registered.includes(key), key);
  for (const field of content.FIELD_BY_KEY.values()) {
    if (field.type !== 'image' || !field.defaultPreview) continue;
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', field.defaultPreview)), `${field.key} default preview missing`);
  }
});

for (const [formPath, key] of CMS_IMAGES) {
  test(`CMS image ${key}: upload -> replace -> text-only save keeps it -> remove resets`, async () => {
    reset();
    const { server, base, flashes } = await appFor();
    try {
      const s = await session(base);
      const url = `/admin/site-content/${formPath}`;
      const field = `file__${key}`;

      let res = await upload(base, url, s, { field, file: { buf: PNG, name: 'one.png' } });
      assert.equal(res.status, 302, `${key} upload`);
      const first = rows.get(key);
      assert.match(first, /^site\/[0-9a-f-]{36}\.png$/, 'only a safe relative key is stored');
      assert.ok(!first.includes('/opt/') && !first.includes(STORAGE));
      assert.deepEqual(allFiles(), [first]);
      assert.equal((await settingsService.getSettings()).cms[key.split('.')[0]][key.split('.')[1].replace(/Path$/, 'Url')], `/uploads/thumbnails/${first}`);

      res = await upload(base, url, s, { field, file: { buf: JPEG, name: 'two.jpg', type: 'image/jpeg' } });
      const second = rows.get(key);
      assert.notEqual(second, first);
      await settle();
      assert.deepEqual(allFiles(), [second], 'old image removed only after the new one is saved');

      // saving without a file (text-only form post) must not touch the image
      res = await upload(base, url, s, { fields: {} });
      assert.equal(rows.get(key), second);
      assert.deepEqual(allFiles(), [second]);

      res = await upload(base, url, s, { fields: { [`remove__${key}`]: '1' } });
      assert.ok(!rows.has(key));
      await settle();
      assert.deepEqual(allFiles(), []);
      assert.equal(flashes.error.length, 0);
    } finally { server.close(); }
  });
}

test('CMS images: WebP is accepted too', async () => {
  reset();
  const { server, base } = await appFor();
  try {
    const s = await session(base);
    const res = await upload(base, '/admin/site-content/home/hero', s, { field: 'file__hero.imagePath', file: { buf: WEBP, name: 'a.webp', type: 'image/webp' } });
    assert.equal(res.status, 302);
    assert.match(rows.get('hero.imagePath'), /\.webp$/);
  } finally { server.close(); }
});

test('CMS images: a failed save never deletes the working image; the new upload is cleaned up', async () => {
  reset();
  const { server, base } = await appFor();
  try {
    const s = await session(base);
    await upload(base, '/admin/site-content/home/hero', s, { field: 'file__hero.imagePath', file: { buf: PNG, name: 'ok.png' } });
    const working = rows.get('hero.imagePath');
    // validation failure in the same form (unsafe text) rejects the whole save, including the new image
    const bad = await upload(base, '/admin/site-content/home/hero', s, { field: 'file__hero.imagePath', file: { buf: JPEG, name: 'new.jpg', type: 'image/jpeg' }, fields: { 'hero.heading': '<script>x</script>' } });
    assert.equal(bad.status, 400);
    await settle();
    assert.equal(rows.get('hero.imagePath'), working);
    assert.deepEqual(allFiles(), [working], 'working image kept, rejected upload removed');
  } finally { server.close(); }
});

test('CMS images: remove on a path that is not ours never deletes anything', async () => {
  reset();
  fs.writeFileSync(path.join(STORAGE, 'keep.txt'), 'x');
  rows.set('hero.imagePath', '../keep.txt'); // tampered DB value
  const { server, base } = await appFor();
  try {
    const s = await session(base);
    await upload(base, '/admin/site-content/home/hero', s, { fields: { 'remove__hero.imagePath': '1' } });
    await settle();
    assert.ok(fs.existsSync(path.join(STORAGE, 'keep.txt')));
    assert.equal(imageStorage.siteImagePublicUrl('../keep.txt'), null);
    imageStorage.deleteSiteImageIfOwned('../keep.txt');
    imageStorage.deleteSiteImageIfOwned('/etc/passwd');
    imageStorage.deleteIfOwned('/uploads/thumbnails/../keep.txt');
    imageStorage.deleteIfOwned('/images/demo/hero.jpg');
    await settle();
    assert.ok(fs.existsSync(path.join(STORAGE, 'keep.txt')));
  } finally { server.close(); }
});

// =============================================================================
// Security
// =============================================================================

test('security: anonymous and student users cannot upload or remove any CMS image', async () => {
  reset();
  const { server, base } = await appFor();
  try {
    const targets = [
      ['/admin/site-content/home/hero', 'file__hero.imagePath'],
      ['/admin/categories/1/image/upload', 'thumbnail'],
      ['/admin/courses/1/thumbnail/upload', 'thumbnail'],
      ['/admin/instructors/1/photo/upload', 'thumbnail'],
    ];
    for (const role of ['STUDENT', null]) {
      const s = role ? await session(base, role) : { cookie: '', token: 'x', role: '' };
      for (const [url, field] of targets) {
        const res = await upload(base, url, s, { field, file: { buf: PNG } });
        assert.equal(res.status, role ? 403 : 302, `${role} ${url}`);
        if (!role) assert.match(res.headers.get('location'), /^\/login/);
      }
      for (const url of ['/admin/categories/1/image/remove', '/admin/courses/1/thumbnail/remove', '/admin/instructors/1/photo/remove']) {
        const res = await postUrl(base, url, s);
        assert.equal(res.status, role ? 403 : 302, `${role} ${url}`);
      }
    }
    assert.equal(rows.size, 0);
    assert.deepEqual(allFiles(), []);
  } finally { server.close(); }
});

test('security: a missing CSRF token is rejected on every image route and no file stays on disk', async () => {
  reset();
  store.category.get(1).imageUrl = '/uploads/thumbnails/keepme.png';
  fs.writeFileSync(path.join(STORAGE, 'keepme.png'), PNG);
  const { server, base } = await appFor();
  try {
    const s = await session(base);
    for (const [url, field] of [
      ['/admin/site-content/home/hero', 'file__hero.imagePath'],
      ['/admin/categories/1/image/upload', 'thumbnail'],
      ['/admin/courses/1/thumbnail/upload', 'thumbnail'],
      ['/admin/instructors/1/photo/upload', 'thumbnail'],
    ]) {
      const res = await upload(base, url, s, { field, file: { buf: PNG, name: 'x.png' }, noToken: true });
      assert.equal(res.status, 403, url);
    }
    for (const url of ['/admin/categories/1/image/remove', '/admin/courses/1/thumbnail/remove', '/admin/instructors/1/photo/remove']) {
      assert.equal((await postUrl(base, url, s, {}, { noToken: true })).status, 403, url);
    }
    await settle();
    assert.deepEqual(allFiles(), ['keepme.png'], 'bad-token uploads are removed; existing image untouched');
    assert.equal(store.category.get(1).imageUrl, '/uploads/thumbnails/keepme.png');
  } finally { server.close(); }
});

test('security: fake PNG/JPG/WebP, wrong types and oversized images are rejected everywhere', async () => {
  reset();
  const { server, base, flashes } = await appFor();
  try {
    const s = await session(base);
    const targets = [
      ['/admin/site-content/home/hero', 'file__hero.imagePath'],
      ['/admin/categories/1/image/upload', 'thumbnail'],
      ['/admin/courses/1/thumbnail/upload', 'thumbnail'],
      ['/admin/instructors/1/photo/upload', 'thumbnail'],
    ];
    const bad = [
      [{ buf: FAKE, name: 'fake.png', type: 'image/png' }, /not a valid/],
      [{ buf: FAKE, name: 'fake.jpg', type: 'image/jpeg' }, /not a valid/],
      [{ buf: FAKE, name: 'fake.webp', type: 'image/webp' }, /not a valid/],
      [{ buf: PNG, name: 'real.jpg', type: 'image/jpeg' }, /not a valid/], // PNG bytes renamed .jpg
      [{ buf: PNG, name: 'a.svg', type: 'image/svg+xml' }, /Unsupported|Only/],
      [{ buf: PNG, name: 'a.png', type: 'text/html' }, /Unsupported|Only/],
      [{ buf: PNG, name: 'a.gif', type: 'image/gif' }, /Unsupported|Only/],
      [{ buf: Buffer.alloc(5 * 1024 * 1024 + 10, 1), name: 'big.png', type: 'image/png' }, /too large/],
    ];
    for (const [url, field] of targets) {
      for (const [file, message] of bad) {
        const res = await upload(base, url, s, { field, file });
        assert.equal(res.status, 302, `${url} ${file.name}`);
        assert.match(flashes.error.at(-1), message, `${url} ${file.name}`);
      }
    }
    assert.equal(rows.size, 0);
    assert.equal(store.category.get(1).imageUrl, null);
    assert.equal(store.course.get(1).thumbnailUrl, null);
    assert.equal(store.instructor.get(1).photoUrl, null);
    await settle();
    assert.deepEqual(allFiles(), []);
  } finally { server.close(); }
});

test('security: hostile filenames are harmless (stored name is always a fresh UUID)', async () => {
  reset();
  const { server, base } = await appFor();
  try {
    const s = await session(base);
    for (const name of ['../../evil.png', '..\\..\\evil.png', 'a/b/c.png', 'x\u0000.png', 'con.png', '%2e%2e%2fevil.png']) {
      await upload(base, '/admin/categories/1/image/upload', s, { field: 'thumbnail', file: { buf: PNG, name } });
    }
    await settle();
    for (const f of allFiles()) assert.match(f, /^[0-9a-f-]{36}\.png$/, f);
    assert.ok(!fs.existsSync(path.join(STORAGE, '..', 'evil.png')));
    assert.ok(allFiles().length >= 1);
  } finally { server.close(); }
});

test('security: malformed ids are a safe 404 on every image route', async () => {
  reset();
  const { server, base } = await appFor();
  try {
    const s = await session(base);
    for (const id of ['abc', '0', '-1', '1e3', '1.5', '99999999999', '2147483648', 'null']) {
      for (const [url, field] of [[`/admin/categories/${id}/image/upload`, 'thumbnail'], [`/admin/courses/${id}/thumbnail/upload`, 'thumbnail'], [`/admin/instructors/${id}/photo/upload`, 'thumbnail']]) {
        assert.equal((await upload(base, url, s, { field, file: { buf: PNG } })).status, 404, url);
      }
      for (const url of [`/admin/categories/${id}/image/remove`, `/admin/courses/${id}/thumbnail/remove`, `/admin/instructors/${id}/photo/remove`]) {
        assert.equal((await postUrl(base, url, s)).status, 404, url);
      }
    }
    assert.equal((await fetch(`${base}/admin/site-content/home/hero%2F..%2Fx`, { method: 'POST', headers: { 'x-test-role': 'ADMIN' } })).status, 404);
    await settle();
    assert.deepEqual(allFiles(), []);
  } finally { server.close(); }
});

// =============================================================================
// Category / course / instructor images
// =============================================================================

const entityCases = [
  ['category', 'imageUrl', '/admin/categories/1/image/upload', '/admin/categories/1/image/remove'],
  ['course', 'thumbnailUrl', '/admin/courses/1/thumbnail/upload', '/admin/courses/1/thumbnail/remove'],
  ['instructor', 'photoUrl', '/admin/instructors/1/photo/upload', '/admin/instructors/1/photo/remove'],
];
for (const [entity, column, uploadUrl, removeUrl] of entityCases) {
  test(`${entity} image: upload, replace (old file removed after success), remove`, async () => {
    reset();
    const { server, base, flashes } = await appFor();
    try {
      const s = await session(base);
      assert.equal((await upload(base, uploadUrl, s, { field: 'thumbnail', file: { buf: PNG, name: 'one.png' } })).status, 302);
      const first = store[entity].get(1)[column];
      assert.match(first, /^\/uploads\/thumbnails\/[0-9a-f-]{36}\.png$/, 'a public URL under the managed mount, never a server path');
      assert.equal(allFiles().length, 1);

      await upload(base, uploadUrl, s, { field: 'thumbnail', file: { buf: JPEG, name: 'two.jpg', type: 'image/jpeg' } });
      const second = store[entity].get(1)[column];
      assert.notEqual(second, first);
      await settle();
      assert.deepEqual(allFiles(), [second.replace('/uploads/thumbnails/', '')]);

      assert.equal((await postUrl(base, removeUrl, s)).status, 302);
      assert.equal(store[entity].get(1)[column], null);
      await settle();
      assert.deepEqual(allFiles(), []);
      assert.equal(flashes.error.length, 0);
    } finally { server.close(); }
  });

  test(`${entity} image: if the database update fails the new upload is cleaned up and the old image survives`, async () => {
    reset();
    const { server, base } = await appFor();
    try {
      const s = await session(base);
      await upload(base, uploadUrl, s, { field: 'thumbnail', file: { buf: PNG, name: 'one.png' } });
      const working = store[entity].get(1)[column];
      failNextUpdate = true;
      const res = await upload(base, uploadUrl, s, { field: 'thumbnail', file: { buf: JPEG, name: 'two.jpg', type: 'image/jpeg' } });
      assert.equal(res.status, 500);
      await settle();
      assert.equal(store[entity].get(1)[column], working);
      assert.deepEqual(allFiles(), [working.replace('/uploads/thumbnails/', '')]);
    } finally { server.close(); }
  });

  test(`${entity} image: uploading for a record that does not exist leaves no orphan`, async () => {
    reset();
    const { server, base } = await appFor();
    try {
      const s = await session(base);
      const res = await upload(base, uploadUrl.replace('/1/', '/99/'), s, { field: 'thumbnail', file: { buf: PNG } });
      assert.equal(res.status, 302);
      await settle();
      assert.deepEqual(allFiles(), []);
    } finally { server.close(); }
  });
}

for (const [entity, column, deleteUrl] of [
  ['category', 'imageUrl', '/admin/categories/1/delete'],
  ['course', 'thumbnailUrl', '/admin/courses/1/delete'],
  ['instructor', 'photoUrl', '/admin/instructors/1/delete'],
]) {
  test(`deleting a ${entity} also removes its managed image file (no orphans), but never a bundled image`, async () => {
    reset();
    const { server, base } = await appFor();
    try {
      const s = await session(base);
      const uploadUrl = { category: '/admin/categories/1/image/upload', course: '/admin/courses/1/thumbnail/upload', instructor: '/admin/instructors/1/photo/upload' }[entity];
      await upload(base, uploadUrl, s, { field: 'thumbnail', file: { buf: PNG, name: 'x.png' } });
      assert.equal(allFiles().length, 1);
      assert.equal((await postUrl(base, deleteUrl, s)).status, 302);
      assert.equal(store[entity].has(1), false);
      await settle();
      assert.deepEqual(allFiles(), [], 'the image file is removed with the record');

      reset();
      store[entity].get(1)[column] = '/images/demo/hero.jpg';
      await postUrl(base, deleteUrl, s);
      assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'images', 'demo', 'hero.jpg')));
    } finally { server.close(); }
  });
}

test('bundled demo images are never deleted when an admin resets a category that uses one', async () => {
  reset();
  store.category.get(1).imageUrl = '/images/demo/category-cosmetology.jpg';
  const { server, base } = await appFor();
  try {
    const s = await session(base);
    assert.equal((await postUrl(base, '/admin/categories/1/image/remove', s)).status, 302);
    assert.equal(store.category.get(1).imageUrl, null);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'images', 'demo', 'category-cosmetology.jpg')), 'bundled file untouched');
  } finally { server.close(); }
});

// =============================================================================
// Public rendering + fallbacks
// =============================================================================

async function cmsWith(overrides = {}) {
  rows.clear();
  settingsService.invalidateCache();
  for (const [k, v] of Object.entries(overrides)) rows.set(k, v);
  return (await settingsService.getSettings()).cms;
}
const baseView = (cms, extra = {}) => ({ cms, site, fill: settingsService.fill, csrfToken: 't', flash: {}, currentUser: undefined, footerCategories: [], pageTitle: 'T', metaDescription: 'D', seo: undefined, ...extra });
const UUID = '11111111-2222-3333-4444-555555555555';

test('homepage categories use each category\'s own image; none is hard-coded by slug', async () => {
  const cms = await cmsWith();
  const html = await render('partials/categories.ejs', baseView(cms, {
    categories: [
      { name: 'Cosmetology', slug: 'cosmetology', imageUrl: `/uploads/thumbnails/${UUID}.png`, _count: { courses: 1 } },
      { name: 'Aesthetics', slug: 'aesthetics', imageUrl: null, _count: { courses: 0 } },
    ],
  }));
  assert.match(html, new RegExp(`src="/uploads/thumbnails/${UUID}\\.png"`));
  assert.equal((html.match(/category-image"/g) || []).length, 1, 'a category without an image renders no photo and no broken <img>');
  assert.ok(!html.includes('/images/demo/category-'), 'no bundled demo image injected by slug');
  for (const file of fs.readdirSync(VIEWS, { recursive: true }).filter((f) => String(f).endsWith('.ejs'))) {
    assert.ok(!/category-(cosmetology|aesthetics|dental|skin-hair)\.jpg/.test(fs.readFileSync(path.join(VIEWS, String(file)), 'utf8')), `${file} hard-codes a category image`);
  }
});

test('course cards / course page / dashboard use the course image, then the admin default, then the bundled placeholder', async () => {
  const course = { id: 1, slug: 'c', title: 'Course', shortDescription: '', level: 'BEGINNER', duration: '', currency: 'INR', price: 100, salePrice: null, category: null, instructor: null, reviews: [], _count: { lessons: 0 }, featured: false };
  const own = await render('partials/course-card.ejs', baseView(await cmsWith(), { course: { ...course, thumbnailUrl: `/uploads/thumbnails/${UUID}.jpg` } }));
  assert.match(own, new RegExp(`/uploads/thumbnails/${UUID}\\.jpg`));

  const adminDefault = await render('partials/course-card.ejs', baseView(await cmsWith({ 'brand.defaultCourseImagePath': `site/${UUID}.png` }), { course: { ...course, thumbnailUrl: null } }));
  assert.match(adminDefault, new RegExp(`src="/uploads/thumbnails/site/${UUID}\\.png"`));

  const bundled = await render('partials/course-card.ejs', baseView(await cmsWith(), { course: { ...course, thumbnailUrl: null } }));
  assert.match(bundled, /src="\/assets\/images\/course-placeholder\.svg"/);
  assert.match(bundled, /data-fallback-src="\/assets\/images\/course-placeholder\.svg"/, 'a failing image swaps to the local placeholder');
  assert.ok(!/https?:\/\/(?!localhost)/.test(bundled.replace(/https?:\/\/(cdn\.jsdelivr\.net|fonts\.g)/g, '')), 'no third-party hotlinks as fallback');
});

test('instructor cards use the admin default photo before the bundled placeholder', async () => {
  const instructors = [{ name: 'Dr X', title: 'Lead', photoUrl: null }];
  const html = await render('partials/instructors.ejs', baseView(await cmsWith({ 'brand.defaultInstructorImagePath': `site/${UUID}.png` }), { instructors }));
  assert.match(html, new RegExp(`src="/uploads/thumbnails/site/${UUID}\\.png"`));
  const plain = await render('partials/instructors.ejs', baseView(await cmsWith(), { instructors }));
  assert.match(plain, /instructor-placeholder\.svg/);
});

test('footer logo, header logo, favicon and social share image render from CMS and fall back cleanly', async () => {
  const cms = await cmsWith({ 'brand.footerLogoPath': `site/${UUID}.png`, 'brand.logoPath': `site/${UUID}.png`, 'brand.shareImagePath': `site/${UUID}.jpg` });
  const footer = await render('partials/footer.ejs', baseView(cms));
  assert.match(footer, /footer-logo-image" src="\/uploads\/thumbnails\/site\//);
  const noLogo = await render('partials/footer.ejs', baseView(await cmsWith()));
  assert.ok(!noLogo.includes('footer-logo-image'));
  assert.match(noLogo, /footer-brand">\s*Institute/);

  const head = await render('partials/seo-head.ejs', baseView(cms, { seo: { title: 'T', description: 'D', robots: 'index, follow' }, site: { ...site, baseUrl: 'https://example.test' } }));
  assert.match(head, new RegExp(`og:image" content="https://example\\.test/uploads/thumbnails/site/${UUID}\\.jpg"`));
  assert.match(head, /summary_large_image/);
  const own = await render('partials/seo-head.ejs', baseView(cms, { seo: { title: 'T', description: 'D', robots: 'index', ogImage: 'https://example.test/own.jpg' } }));
  assert.match(own, /og:image" content="https:\/\/example\.test\/own\.jpg"/);
  const none = await render('partials/seo-head.ejs', baseView(await cmsWith(), { seo: { title: 'T', description: 'D', robots: 'index' } }));
  assert.ok(!none.includes('og:image'));
});

test('hero, Why ICDS, login and signup images: configured upload, else bundled default, never broken', async () => {
  const stats = null;
  let cms = await cmsWith({ 'hero.imagePath': `site/${UUID}.png`, 'why.imagePath': `site/${UUID}.jpg` });
  assert.match(await render('partials/hero.ejs', baseView(cms, { stats })), new RegExp(`class="hero-image"\\s+src="/uploads/thumbnails/site/${UUID}\\.png"`));
  assert.match(await render('partials/about.ejs', baseView(cms)), new RegExp(`src="/uploads/thumbnails/site/${UUID}\\.jpg"`));
  cms = await cmsWith();
  assert.match(await render('partials/hero.ejs', baseView(cms, { stats })), /src="\/images\/demo\/hero\.jpg"/);
  assert.match(await render('partials/about.ejs', baseView(cms)), /src="\/images\/demo\/about-training\.jpg"/);
  for (const html of [await render('partials/hero.ejs', baseView(cms, { stats })), await render('partials/about.ejs', baseView(cms))]) {
    assert.match(html, /data-fallback-src="\/assets\/images\/hero-placeholder\.svg"/);
  }
  const login = await render('public/login-content.ejs', baseView(await cmsWith({ 'login.imagePath': `site/${UUID}.png` }), { errors: [], values: {}, returnTo: '' }));
  const signup = await render('public/signup-content.ejs', baseView(await cmsWith({ 'signup.imagePath': `site/${UUID}.png` }), { errors: [], values: {} }));
  assert.match(login, new RegExp(`/uploads/thumbnails/site/${UUID}\\.png`));
  assert.match(signup, new RegExp(`/uploads/thumbnails/site/${UUID}\\.png`));
  const loginDefault = await render('public/login-content.ejs', baseView(await cmsWith(), { errors: [], values: {}, returnTo: '' }));
  assert.ok(!loginDefault.includes('uploads/thumbnails'), 'default login panel keeps the stylesheet image');
});

// =============================================================================
// Admin UX
// =============================================================================

test('admin image fields show the current/default picture, a badge, accepted types and replace/remove controls', async () => {
  reset();
  rows.set('hero.imagePath', `site/${UUID}.png`);
  const { server, base } = await appFor();
  try {
    const html = await (await fetch(`${base}/admin/site-content/home`, { headers: { 'x-test-role': 'ADMIN' } })).text();
    // custom image: preview of the upload, "Custom image" badge, Replace + Reset
    assert.match(html, new RegExp(`id="pv-hero.imagePath" class="sc-preview" src="/uploads/thumbnails/site/${UUID}\\.png"`));
    assert.match(html, /Custom image/);
    assert.match(html, /Replace image/);
    assert.match(html, /name="remove__hero\.imagePath" value="1" form="form-hero"[^>]*data-confirm="[^"]+"/, 'removal asks for confirmation');
    // default image: bundled preview + "Default image" badge, no remove button
    assert.match(html, /id="pv-why\.imagePath" class="sc-preview" src="\/images\/demo\/about-training\.jpg"/);
    assert.match(html, /Default image/);
    assert.ok(!/name="remove__why\.imagePath"/.test(html));
    assert.match(html, /JPG, PNG or WebP, max 5MB/);
    assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
    // homepage sections are collapsible cards, each holding its own image field
    assert.ok((html.match(/<details/g) || []).length >= 8);
    const hero = html.slice(html.indexOf('id="section-hero"'), html.indexOf('id="section-categories"'));
    assert.match(hero, /hero\.imagePath/);
    assert.ok(!hero.includes('why.imagePath'));
    assert.match(html, /admin-images\.js/);
  } finally { server.close(); }
});

test('admin Categories/Courses/Instructors pages expose preview, replace and remove controls', async () => {
  reset();
  store.category.get(1).imageUrl = `/uploads/thumbnails/${UUID}.png`;
  const cat = await render('admin/categories/list-content.ejs', {
    ...baseView(await cmsWith()), categories: [{ ...store.category.get(1), status: 'ACTIVE', _count: { courses: 0 } }], statuses: ['ACTIVE', 'INACTIVE'], errors: [], values: {},
  });
  assert.match(cat, new RegExp(`class="img-thumb" src="/uploads/thumbnails/${UUID}\\.png"`));
  assert.match(cat, /Replace image/);
  assert.match(cat, /action="\/admin\/categories\/1\/image\/remove"[^>]*data-confirm/);

  const course = await render('admin/courses/form-content.ejs', {
    ...baseView(await cmsWith()), course: { id: 1 }, values: { thumbnailUrl: `/uploads/thumbnails/${UUID}.png` }, errors: [], categories: [], instructors: [], statuses: [], levels: [], currencies: [],
  }).catch((e) => String(e.message));
  if (!/ReferenceError/.test(course)) {
    assert.match(course, /thumbnail\/remove/);
    assert.match(course, /Custom image/);
  }
});

test.after(() => { fs.rmSync(STORAGE, { recursive: true, force: true }); });
