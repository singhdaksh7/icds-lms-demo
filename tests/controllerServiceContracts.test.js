// Every service function a controller calls must actually exist. A missing function only blows up
// when someone clicks the page (e.g. the Admin "Preview Landing Page" button returned a 500 because it
// called curriculumService.getCurriculumTree / getCourseStats, which do not exist).
process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function controllerFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return controllerFiles(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
}

test('every <service>.<fn>() called from a controller exists on that service', () => {
  const problems = [];
  for (const file of controllerFiles(path.join(root, 'src/controllers'))) {
    const src = fs.readFileSync(file, 'utf8');
    const bindings = [...src.matchAll(/const\s+(\w+)\s*=\s*require\(\s*['"](\.{1,2}\/(?:\.\.\/)*services\/[\w.]+)['"]\s*\)/g)];
    for (const [, name, rel] of bindings) {
      let mod;
      try { mod = require(path.resolve(path.dirname(file), rel)); } catch (_e) { continue; }
      const used = new Set([...src.matchAll(new RegExp(String.raw`\b${name}\.(\w+)\s*\(`, 'g'))].map((m) => m[1]));
      for (const fn of used) {
        if (typeof mod[fn] !== 'function') problems.push(`${path.relative(root, file)}: ${name}.${fn}() is not exported by ${rel}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('admin landing preview uses real curriculum functions', () => {
  const src = fs.readFileSync(path.join(root, 'src/controllers/admin/courseLanding.controller.js'), 'utf8');
  const preview = src.slice(src.indexOf('async function previewLanding'), src.indexOf('async function previewLanding') + 1800);
  assert.ok(!/getCurriculumTree|getCourseStats/.test(preview));
  assert.match(preview, /getCourseCurriculum/);
  assert.match(preview, /getPublicLandingData\(course\.id, stats, \{ includeDemo: true \}\)/);
});

test('section order: toggle and move work by section key (and persist rows on first use)', async () => {
  const { prisma } = require('../src/config/db');
  const controller = require('../src/controllers/admin/courseLanding.controller');
  const rows = [];
  let nextId = 1;
  const orig = prisma.courseLandingSection;
  prisma.courseLandingSection = {
    async findMany({ where }) { return rows.filter((r) => r.courseId === where.courseId).map((r) => ({ ...r })).sort((a, b) => a.sortOrder - b.sortOrder); },
    async findFirst({ where }) { const r = rows.find((x) => x.courseId === where.courseId && x.sectionKey === where.sectionKey); return r ? { ...r } : null; },
    async create({ data }) { const r = { id: nextId++, ...data }; rows.push(r); return { ...r }; },
    async update({ where, data }) { Object.assign(rows.find((x) => x.id === where.id), data); return {}; },
  };
  const mkRes = () => { const r = { redirected: null, redirect(u) { r.redirected = u; } }; return r; };
  const mkReq = (params, body = {}) => ({ params: { courseId: '5', ...params }, body, flash: [], flashSuccess() {}, flashError(m) { this.flash.push(m); } });
  try {
    let req = mkReq({ sectionKey: 'FAQ' });
    await controller.toggleSection(req, mkRes());
    assert.deepEqual(req.flash, []);
    assert.equal(rows.find((r) => r.sectionKey === 'FAQ').isEnabled, false, 'first toggle disables an enabled section');
    await controller.toggleSection(mkReq({ sectionKey: 'FAQ' }), mkRes());
    assert.equal(rows.find((r) => r.sectionKey === 'FAQ').isEnabled, true);

    const before = rows.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((r) => r.sectionKey);
    req = mkReq({ sectionKey: 'STATS' }, { direction: 'up' });
    await controller.moveSection(req, mkRes());
    assert.deepEqual(req.flash, []);
    const after = rows.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((r) => r.sectionKey);
    assert.deepEqual(after.slice(0, 2), [before[1], before[0]], 'STATS moved above HERO');

    req = mkReq({ sectionKey: 'NOT_A_SECTION' });
    await controller.toggleSection(req, mkRes());
    assert.equal(req.flash.length, 1, 'unknown section is rejected');
  } finally {
    prisma.courseLandingSection = orig;
  }
});

test('section order routes carry the section KEY and are not subject to the numeric-id param guard', () => {
  const routes = fs.readFileSync(path.join(root, 'src/routes/admin.routes.js'), 'utf8');
  assert.match(routes, /landing-page\/sections\/:sectionKey\/toggle/);
  assert.match(routes, /landing-page\/sections\/:sectionKey\/move/);
  assert.ok(!/landing-page\/sections\/:sectionId/.test(routes), ':sectionId is forced numeric by router.param and would 404 every key');
});
