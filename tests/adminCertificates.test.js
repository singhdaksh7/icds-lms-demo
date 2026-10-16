process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

// Must be set before certificateStorage is first required (it reads env at load).
const STORAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'icds-certs-'));
process.env.CERTIFICATE_STORAGE_ROOT = STORAGE;

// --- in-memory Prisma stand-in -------------------------------------------------
const db = { certificates: [], enrollments: [], progress: [], nextId: 1 };
const USERS = [
  { id: 1, name: 'Admin One', email: 'admin@x.test', role: 'ADMIN', status: 'ACTIVE' },
  { id: 2, name: 'Asha Student', email: 'asha@x.test', role: 'STUDENT', status: 'ACTIVE' },
  { id: 3, name: 'Ravi Student', email: 'ravi@x.test', role: 'STUDENT', status: 'ACTIVE' },
];
const COURSES = [{ id: 1, title: 'Hair 101', slug: 'hair-101', instructor: null }, { id: 2, title: 'Skin 201', slug: 'skin-201', instructor: null }];
const LESSONS = [{ id: 10, courseId: 1, status: 'PUBLISHED' }, { id: 11, courseId: 1, status: 'PUBLISHED' }];

const hydrate = (c) => c && ({
  ...c,
  user: USERS.find((u) => u.id === c.userId),
  course: COURSES.find((x) => x.id === c.courseId),
  issuedBy: USERS.find((u) => u.id === c.issuedByUserId) || null,
});
const matches = (c, where) => Object.entries(where).every(([k, v]) => c[k] === v);

const fakePrisma = {
  user: {
    async findUnique({ where }) { return USERS.find((u) => u.id === where.id) || null; },
    async findFirst({ where }) { return USERS.find((u) => matches(u, where)) || null; },
    async findMany({ where = {} }) { return USERS.filter((u) => matches(u, where)); },
  },
  course: {
    async findUnique({ where }) { return COURSES.find((c) => c.id === where.id) || null; },
    async findMany() { return COURSES; },
  },
  enrollment: { async findUnique({ where }) { return db.enrollments.find((e) => e.userId === where.userId_courseId.userId && e.courseId === where.userId_courseId.courseId) || null; } },
  lesson: { async findMany({ where }) { return LESSONS.filter((l) => l.courseId === where.courseId && l.status === where.status); } },
  lessonProgress: { async count({ where }) { return db.progress.filter((p) => p.userId === where.userId && where.lessonId.in.includes(p.lessonId) && p.completed).length; } },
  certificate: {
    async findUnique({ where }) {
      if (where.userId_courseId) return db.certificates.find((c) => c.userId === where.userId_courseId.userId && c.courseId === where.userId_courseId.courseId) || null;
      return hydrate(db.certificates.find((c) => c.id === where.id) || db.certificates.find((c) => c.certificateNumber === where.certificateNumber) || null);
    },
    async findFirst({ where }) { return hydrate(db.certificates.find((c) => matches(c, where))); },
    async findMany({ where = {} }) { return db.certificates.filter((c) => matches(c, where)).map(hydrate).sort((a, b) => b.issuedAt - a.issuedAt); },
    async count({ where }) { return db.certificates.filter((c) => matches(c, where)).length; },
    async create({ data }) {
      if (db.certificates.some((c) => c.userId === data.userId && c.courseId === data.courseId)) { const e = new Error('dup'); e.code = 'P2002'; throw e; }
      const row = { id: db.nextId++, issuedAt: new Date(), fileUrl: null, source: 'COMPLETION', status: 'ACTIVE', issuedByUserId: null, adminNote: null, revokedAt: null, ...data };
      db.certificates.push(row);
      return row;
    },
    async update({ where, data }) { Object.assign(db.certificates.find((c) => c.id === where.id), data); return db.certificates.find((c) => c.id === where.id); },
    async updateMany({ where, data }) { const rows = db.certificates.filter((c) => c.id === where.id); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length }; },
  },
  async $transaction(fn) { return fn(fakePrisma); },
};
require.cache[require.resolve('../src/config/db')] = {
  id: require.resolve('../src/config/db'), filename: require.resolve('../src/config/db'), loaded: true, exports: { prisma: fakePrisma },
};

const express = require('express');
const cookieParser = require('cookie-parser');
const site = require('../src/config/site');
const settingsService = require('../src/services/settings.service');
const certificateService = require('../src/services/certificate.service');
const certificateStorage = require('../src/lib/certificateStorage');
const { validateAdminCertificate } = require('../src/validators/certificate.validator');
const { exposeCsrfToken } = require('../src/config/csrf');

const VIEWS = path.join(__dirname, '..', 'views');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

function reset() {
  db.certificates = []; db.enrollments = []; db.progress = []; db.nextId = 1;
  for (const f of fs.readdirSync(STORAGE)) fs.rmSync(path.join(STORAGE, f), { force: true });
}
const enrollAndComplete = (userId, complete) => {
  db.enrollments.push({ userId, courseId: 1, status: 'ACTIVE' });
  if (complete) LESSONS.forEach((l) => db.progress.push({ userId, lessonId: l.id, completed: true }));
};

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
    const user = USERS.find((u) => u.id === Number(req.get('x-test-user')));
    if (user) { req.currentUser = user; }
    res.locals.currentUser = user || null;
    res.locals.flash = {};
    req.flashSuccess = (m) => flashes.success.push(m);
    req.flashError = (m) => flashes.error.push(m);
    next();
  });
  app.get('/token', (req, res) => res.json({ token: res.locals.csrfToken }));
  app.use('/admin', require('../src/routes/admin.routes'));
  app.use('/student', require('../src/routes/student.routes'));
  app.use('/', require('../src/routes/index.routes'));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(err.code === 'EBADCSRFTOKEN' ? 403 : 500).send(`ERR:${err.code || err.message}`);
  });
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, flashes, base: `http://127.0.0.1:${server.address().port}` })));
}

async function session(base, userId) {
  const res = await fetch(`${base}/token`, { headers: { 'x-test-user': String(userId) } });
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { token } = await res.json();
  return { cookie, token, userId };
}

function post(base, url, s, fields = {}, { file, noToken } = {}) {
  const headers = { cookie: s.cookie, 'x-test-user': String(s.userId) };
  const form = new FormData();
  if (!noToken) form.append('_csrf', s.token);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (file) form.append('certificatePdf', new Blob([file.buf], { type: file.type || 'application/pdf' }), file.name || 'cert.pdf');
  return fetch(`${base}${url}`, { method: 'POST', headers, body: form, redirect: 'manual' });
}

// Non-multipart routes (revoke/restore, student certificate) take urlencoded bodies.
function postUrl(base, url, s, fields = {}, { noToken } = {}) {
  const body = new URLSearchParams({ ...(noToken ? {} : { _csrf: s.token }), ...fields });
  return fetch(`${base}${url}`, {
    method: 'POST',
    headers: { cookie: s.cookie, 'x-test-user': String(s.userId), 'content-type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'manual',
  });
}

const goodForm = (over = {}) => ({ studentEmail: 'asha@x.test', courseId: '1', issueDate: '2026-10-01', adminNote: 'Offline practical assessment completed', ...over });
const get = (base, url, userId) => fetch(`${base}${url}`, { headers: userId ? { 'x-test-user': String(userId) } : {}, redirect: 'manual' });

// =============================================================================
// Validation
// =============================================================================

test('validator: a reason is required for an admin override, with length limits', () => {
  const today = new Date('2026-10-16T10:00:00Z');
  assert.deepEqual(validateAdminCertificate(goodForm(), today).errors, []);
  assert.match(validateAdminCertificate(goodForm({ adminNote: '' }), today).errors.join(), /reason/i);
  assert.match(validateAdminCertificate(goodForm({ adminNote: 'abc' }), today).errors.join(), /reason/i);
  assert.match(validateAdminCertificate(goodForm({ adminNote: 'x'.repeat(501) }), today).errors.join(), /at most/i);
});

test('validator: student, course and date are validated; future dates refused', () => {
  const today = new Date('2026-10-16T10:00:00Z');
  assert.ok(validateAdminCertificate(goodForm({ studentEmail: 'nope' }), today).errors.length);
  for (const bad of ['', 'abc', '0', '-1', '1e3', '99999999999']) assert.ok(validateAdminCertificate(goodForm({ courseId: bad }), today).errors.length, bad);
  assert.ok(validateAdminCertificate(goodForm({ issueDate: '2026-02-30' }), today).errors.length);
  assert.match(validateAdminCertificate(goodForm({ issueDate: '2026-10-17' }), today).errors.join(), /future/);
  assert.deepEqual(validateAdminCertificate(goodForm({ issueDate: '2026-10-16' }), today).errors, []);
});

// =============================================================================
// Normal completion flow (unchanged)
// =============================================================================

test('completion flow: an incomplete student cannot get a certificate; a completed one can (source COMPLETION)', async () => {
  reset();
  enrollAndComplete(2, false);
  await assert.rejects(() => certificateService.issueCertificate(2, 1), (e) => e.code === 'INELIGIBLE');
  assert.equal(db.certificates.length, 0);

  db.progress.push({ userId: 2, lessonId: 10, completed: true }); // only 1 of 2 lessons
  await assert.rejects(() => certificateService.issueCertificate(2, 1), (e) => e.code === 'INELIGIBLE');

  db.progress.push({ userId: 2, lessonId: 11, completed: true });
  const cert = await certificateService.issueCertificate(2, 1);
  assert.equal(cert.source, 'COMPLETION');
  assert.equal(cert.status, 'ACTIVE');
  assert.match(cert.certificateNumber, /^ICDS-CERT-\d{4}-\d{6}$/);
  // idempotent
  assert.equal((await certificateService.issueCertificate(2, 1)).id, cert.id);
  assert.equal(db.certificates.length, 1);
});

test('completion flow: a revoked certificate is never handed back to the student', async () => {
  reset();
  enrollAndComplete(2, true);
  const cert = await certificateService.issueCertificate(2, 1);
  await certificateService.setCertificateStatus(cert.id, 'REVOKED');
  await assert.rejects(() => certificateService.issueCertificate(2, 1), (e) => e.code === 'INELIGIBLE' && /no longer valid/.test(e.message));
});

// =============================================================================
// Admin issuance
// =============================================================================

test('admin override: issues before completion, records admin + note + date, uses the shared number generator', async () => {
  reset();
  enrollAndComplete(2, false);
  const { server, base, flashes } = await appFor();
  try {
    const s = await session(base, 1);
    const res = await post(base, '/admin/certificates', s, goodForm());
    assert.equal(res.status, 302);
    assert.equal(db.certificates.length, 1);
    const c = db.certificates[0];
    assert.equal(c.source, 'ADMIN_ISSUED');
    assert.equal(c.issuedByUserId, 1);
    assert.equal(c.adminNote, 'Offline practical assessment completed');
    assert.equal(c.issuedAt.toISOString().slice(0, 10), '2026-10-01');
    assert.match(c.certificateNumber, /^ICDS-CERT-\d{4}-\d{6}$/);
    assert.equal(c.fileUrl, null);
    assert.match(flashes.success.at(-1), /ICDS-CERT/);

    // a second one gets a different, globally unique number
    await post(base, '/admin/certificates', s, goodForm({ studentEmail: 'ravi@x.test' }));
    assert.equal(new Set(db.certificates.map((x) => x.certificateNumber)).size, 2);
  } finally { server.close(); }
});

test('admin override: the reason is required and nothing is saved without it', async () => {
  reset();
  const { server, base } = await appFor();
  try {
    const s = await session(base, 1);
    const res = await post(base, '/admin/certificates', s, goodForm({ adminNote: '' }));
    assert.equal(res.status, 400);
    assert.match(await res.text(), /reason for the override is required/i);
    assert.equal(db.certificates.length, 0);
    assert.equal((await post(base, '/admin/certificates', s, goodForm({ studentEmail: 'ghost@x.test' }))).status, 400);
    assert.equal((await post(base, '/admin/certificates', s, goodForm({ courseId: '999' }))).status, 400);
    assert.equal((await post(base, '/admin/certificates', s, goodForm({ studentEmail: 'admin@x.test' }))).status, 400, 'an admin account is not a valid student');
    assert.equal(db.certificates.length, 0);
  } finally { server.close(); }
});

test('admin certificates: admin-only and CSRF-protected; students cannot create admin-issued certificates', async () => {
  reset();
  const { server, base } = await appFor();
  try {
    const student = await session(base, 2);
    const forbidden = await post(base, '/admin/certificates', student, goodForm());
    assert.equal(forbidden.status, 403);
    assert.equal((await get(base, '/admin/certificates', 2)).status, 403);
    assert.equal((await get(base, '/admin/certificates')).status, 302, 'anonymous goes to login');
    assert.equal(db.certificates.length, 0);

    const admin = await session(base, 1);
    assert.equal((await post(base, '/admin/certificates', admin, goodForm(), { noToken: true })).status, 403);
    assert.equal((await post(base, '/admin/certificates', admin, goodForm(), { noToken: true, file: { buf: PDF, name: 'a.pdf' } })).status, 403);
    assert.equal(db.certificates.length, 0);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(fs.readdirSync(STORAGE), [], 'an upload sent with a bad token must not stay on disk');

    // normal student endpoint cannot be abused to create an admin certificate
    assert.equal((await postUrl(base, '/student/courses/1/certificate', student, { source: 'ADMIN_ISSUED', adminNote: 'x' })).status, 302);
    assert.equal(db.certificates.length, 0);
  } finally { server.close(); }
});

test('duplicate prevention: one certificate per student and course, with a clear admin error', async () => {
  reset();
  const { server, base } = await appFor();
  try {
    const s = await session(base, 1);
    assert.equal((await post(base, '/admin/certificates', s, goodForm())).status, 302);
    const dup = await post(base, '/admin/certificates', s, goodForm(), { file: { buf: PDF, name: 'again.pdf' } });
    assert.equal(dup.status, 409);
    assert.match(await dup.text(), /already has a certificate for this course/);
    assert.equal(db.certificates.length, 1);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(fs.readdirSync(STORAGE), [], 'the duplicate attempt\'s PDF is discarded');

    // an existing completion certificate also blocks an admin duplicate
    reset();
    enrollAndComplete(3, true);
    await certificateService.issueCertificate(3, 1);
    assert.equal((await post(base, '/admin/certificates', s, goodForm({ studentEmail: 'ravi@x.test' }))).status, 409);
  } finally { server.close(); }
});

// =============================================================================
// PDF upload
// =============================================================================

test('PDF upload: a valid PDF is stored under a safe generated name, never exposing a path', async () => {
  reset();
  const { server, base } = await appFor();
  try {
    const s = await session(base, 1);
    const res = await post(base, '/admin/certificates', s, goodForm(), { file: { buf: PDF, name: 'my cert.pdf' } });
    assert.equal(res.status, 302);
    const c = db.certificates[0];
    assert.match(c.fileUrl, /^[0-9a-f-]{36}\.pdf$/, 'only a generated filename is stored');
    assert.ok(!c.fileUrl.includes('/') && !c.fileUrl.includes('\\') && !/my cert/.test(c.fileUrl));
    assert.deepEqual(fs.readdirSync(STORAGE), [c.fileUrl]);
    const html = await (await get(base, '/admin/certificates', 1)).text();
    assert.ok(!html.includes(STORAGE) && !html.includes(c.fileUrl), 'no file name or path in the page');
  } finally { server.close(); }
});

test('PDF upload: fake PDFs, wrong types and oversized files are rejected and nothing is saved', async () => {
  reset();
  const { server, base, flashes } = await appFor();
  try {
    const s = await session(base, 1);
    const cases = [
      [{ buf: Buffer.from('this is not a pdf at all'), name: 'fake.pdf' }, /not a valid PDF/],
      [{ buf: PDF, name: 'cert.txt', type: 'text/plain' }, /Only PDF/],
      [{ buf: PDF, name: 'cert.pdf', type: 'text/html' }, /Only PDF/],
      [{ buf: PDF, name: 'cert.exe', type: 'application/pdf' }, /Only PDF/],
      [{ buf: Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024 + 10)]), name: 'big.pdf' }, /too large/],
    ];
    for (const [file, message] of cases) {
      const res = await post(base, '/admin/certificates', s, goodForm(), { file });
      assert.equal(res.status, 302);
      assert.match(flashes.error.at(-1), message);
    }
    assert.equal(db.certificates.length, 0);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(fs.readdirSync(STORAGE), []);
  } finally { server.close(); }
});

// =============================================================================
// Download: uploaded vs generated
// =============================================================================

test('download: an uploaded PDF is returned byte-for-byte; without an upload the standard PDF is generated', async () => {
  reset();
  const { server, base } = await appFor();
  try {
    const admin = await session(base, 1);
    await post(base, '/admin/certificates', admin, goodForm(), { file: { buf: PDF, name: 'c.pdf' } });
    await post(base, '/admin/certificates', admin, goodForm({ studentEmail: 'ravi@x.test' }));
    const [uploaded, generated] = db.certificates;

    const up = await get(base, `/student/certificates/${uploaded.id}/download`, 2);
    assert.equal(up.status, 200);
    assert.equal(up.headers.get('content-type'), 'application/pdf');
    assert.ok(Buffer.from(await up.arrayBuffer()).equals(PDF));

    const gen = await get(base, `/student/certificates/${generated.id}/download`, 3);
    assert.equal(gen.status, 200);
    const bytes = Buffer.from(await gen.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.ok(bytes.length > 500 && !bytes.equals(PDF), 'generated by the existing generator');

    // admin can download both too
    assert.ok(Buffer.from(await (await get(base, `/admin/certificates/${uploaded.id}/download`, 1)).arrayBuffer()).equals(PDF));
    assert.equal((await get(base, `/admin/certificates/${generated.id}/download`, 1)).status, 200);

    // a student cannot download someone else's certificate
    assert.equal((await get(base, `/student/certificates/${uploaded.id}/download`, 3)).status, 404);
  } finally { server.close(); }
});

test('download: a stored name that is not exactly one of ours is never read from disk', async () => {
  reset();
  fs.writeFileSync(path.join(STORAGE, '..', 'secret.txt'), 'top secret');
  for (const evil of ['../secret.txt', '..\\secret.txt', '/etc/passwd', 'C:\\Windows\\win.ini', 'abc.pdf', '']) {
    assert.equal(certificateStorage.resolveStoredFile(evil), null, evil);
    assert.equal(await certificateStorage.readStoredFile(evil), null);
  }
  const generated = await certificateService.certificateFile({
    fileUrl: '../secret.txt', issuedAt: new Date(), certificateNumber: 'ICDS-CERT-2026-000001',
    user: { name: 'Asha' }, course: { title: 'Hair', instructor: null },
  });
  assert.equal(generated.subarray(0, 5).toString(), '%PDF-', 'falls back to the generated certificate');
  fs.rmSync(path.join(STORAGE, '..', 'secret.txt'), { force: true });
});

// =============================================================================
// Student view + public verification
// =============================================================================

test('student sees an admin-issued certificate without any admin note', async () => {
  reset();
  const { server, base } = await appFor();
  try {
    const admin = await session(base, 1);
    await post(base, '/admin/certificates', admin, goodForm({ adminNote: 'INTERNAL-SECRET-NOTE offline exam' }));
    const res = await get(base, '/student/certificates', 2);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Hair 101/);
    assert.match(html, /ICDS-CERT-\d{4}-000001/);
    assert.match(html, /\/student\/certificates\/1\/download/);
    assert.match(html, /Issued by Institute/);
    assert.ok(!html.includes('INTERNAL-SECRET-NOTE') && !/override/i.test(html));
    // another student does not see it
    assert.ok(!(await (await get(base, '/student/certificates', 3)).text()).includes('Hair 101'));
  } finally { server.close(); }
});

test('public verification: works for completion and admin-issued certificates and never shows the note', async () => {
  reset();
  enrollAndComplete(3, true);
  const completion = await certificateService.issueCertificate(3, 1);
  const { server, base } = await appFor();
  try {
    const admin = await session(base, 1);
    await post(base, '/admin/certificates', admin, goodForm({ adminNote: 'INTERNAL-SECRET-NOTE offline exam' }));
    const adminCert = db.certificates.find((c) => c.source === 'ADMIN_ISSUED');

    for (const [cert, who] of [[completion, 'Ravi Student'], [adminCert, 'Asha Student']]) {
      const res = await get(base, `/certificates/verify/${cert.certificateNumber}`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /Certificate valid/);
      assert.match(html, new RegExp(who));
      assert.match(html, /Hair 101/);
      assert.match(html, new RegExp(cert.certificateNumber));
      assert.match(html, /Issued/);
      assert.ok(!html.includes('INTERNAL-SECRET-NOTE') && !/override|Offline practical/i.test(html));
    }
    assert.equal((await get(base, '/certificates/verify/ICDS-CERT-0000-999999')).status, 404);
  } finally { server.close(); }
});

test('revoke / restore: a revoked certificate says it is no longer valid and leaves the student\'s list; restore brings it back', async () => {
  reset();
  const { server, base } = await appFor();
  try {
    const admin = await session(base, 1);
    await post(base, '/admin/certificates', admin, goodForm());
    const cert = db.certificates[0];

    assert.equal((await postUrl(base, `/admin/certificates/${cert.id}/revoke`, admin, {}, { noToken: true })).status, 403);
    assert.equal(cert.status, 'ACTIVE');

    await postUrl(base, `/admin/certificates/${cert.id}/revoke`, admin, {});
    assert.equal(cert.status, 'REVOKED');
    assert.ok(cert.revokedAt);
    const verify = await (await get(base, `/certificates/verify/${cert.certificateNumber}`)).text();
    assert.match(verify, /no longer valid/);
    assert.ok(!/Certificate valid/.test(verify));
    assert.ok(!(await (await get(base, '/student/certificates', 2)).text()).includes('Hair 101'));
    assert.equal((await get(base, `/student/certificates/${cert.id}/download`, 2)).status, 404);

    await postUrl(base, `/admin/certificates/${cert.id}/restore`, admin, {});
    assert.equal(cert.status, 'ACTIVE');
    assert.match(await (await get(base, `/certificates/verify/${cert.certificateNumber}`)).text(), /Certificate valid/);
    assert.match(await (await get(base, '/student/certificates', 2)).text(), /Hair 101/);
  } finally { server.close(); }
});

test('admin page: lists certificates with type, issuer, status and the internal note (admin only)', async () => {
  reset();
  const { server, base } = await appFor();
  try {
    const admin = await session(base, 1);
    await post(base, '/admin/certificates', admin, goodForm());
    const html = await (await get(base, '/admin/certificates', 1)).text();
    assert.match(html, /Issue Certificate/);
    assert.match(html, /Admin issued/);
    assert.match(html, /by Admin One/);
    assert.match(html, /Offline practical assessment completed/);
    assert.match(html, /Generated PDF/);
    assert.match(html, /name="certificatePdf"/);
    assert.match(html, /enctype="multipart\/form-data"/);
    assert.match(html, /<option value="asha@x\.test">Asha Student<\/option>/);
  } finally { server.close(); }
});

test('malformed certificate ids return a safe 404, never a 500', async () => {
  reset();
  const { server, base } = await appFor();
  try {
    const admin = await session(base, 1);
    for (const id of ['abc', '0', '-1', '1e3', '1.5', '99999999999', '2147483648', 'null']) {
      assert.equal((await get(base, `/admin/certificates/${id}/download`, 1)).status, 404, `admin download ${id}`);
      assert.equal((await postUrl(base, `/admin/certificates/${id}/revoke`, admin, {})).status, 404, `revoke ${id}`);
      assert.equal((await postUrl(base, `/admin/certificates/${id}/restore`, admin, {})).status, 404, `restore ${id}`);
      const stu = await get(base, `/student/certificates/${id}/download`, 2);
      assert.ok([404].includes(stu.status), `student download ${id} -> ${stu.status}`);
    }
    assert.equal((await get(base, '/admin/certificates/12345/download', 1)).status, 404);
    assert.equal((await postUrl(base, '/admin/certificates/12345/revoke', admin, {})).status, 302);
  } finally { server.close(); }
});

test.after(() => { fs.rmSync(STORAGE, { recursive: true, force: true }); });
