process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

// Per-course landing page appearance: validation/allowlists, per-course
// isolation, presets, reset/copy, FMR preservation, CSS-variable rendering,
// admin preview + public page wiring and CSS hygiene.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const { prisma } = require('../src/config/db');
const theme = require('../src/lib/courseAppearance');
const svc = require('../src/services/courseAppearance.service');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').split('\r\n').join('\n');
const cssSrc = read('public/css/course-landing.css');
const publicViewPath = path.join(root, 'views/public/course-detail-content.ejs');
const publicView = fs.readFileSync(publicViewPath, 'utf8');
const schemaSrc = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');

// ---------------------------------------------------------------------------
// In-memory fake of the two models the service touches
// ---------------------------------------------------------------------------
function installFakeDb(courseIds) {
  const rows = new Map(); // courseId -> row
  let nextId = 1;
  const touched = [];
  const orig = {
    cFind: prisma.course.findUnique,
    cMany: prisma.course.findMany,
    aFind: prisma.courseLandingAppearance.findUnique,
    aCreate: prisma.courseLandingAppearance.create,
    aUpsert: prisma.courseLandingAppearance.upsert,
  };
  prisma.course.findUnique = async ({ where }) => (courseIds.includes(where.id) ? { id: where.id } : null);
  prisma.course.findMany = async ({ where }) =>
    courseIds.filter((id) => id !== where.id.not).map((id) => ({ id, title: `Course ${id}` }));
  prisma.courseLandingAppearance.findUnique = async ({ where }) => rows.get(where.courseId) || null;
  prisma.courseLandingAppearance.create = async ({ data }) => {
    const row = { id: nextId++, ...data };
    rows.set(data.courseId, row);
    return row;
  };
  prisma.courseLandingAppearance.upsert = async ({ where, create, update }) => {
    const existing = rows.get(where.courseId);
    const row = existing ? { ...existing, ...update } : { id: nextId++, ...create };
    rows.set(where.courseId, row);
    return row;
  };
  return {
    rows, touched,
    restore() {
      prisma.course.findUnique = orig.cFind;
      prisma.course.findMany = orig.cMany;
      prisma.courseLandingAppearance.findUnique = orig.aFind;
      prisma.courseLandingAppearance.create = orig.aCreate;
      prisma.courseLandingAppearance.upsert = orig.aUpsert;
    },
  };
}

async function withDb(courseIds, fn) {
  const db = installFakeDb(courseIds);
  try {
    await fn(db);
  } finally {
    db.restore();
  }
}

// ---------------------------------------------------------------------------
// Schema / migration
// ---------------------------------------------------------------------------
test('schema has one CourseLandingAppearance row per course (unique courseId) and cascades with the course', () => {
  const model = schemaSrc.match(/model CourseLandingAppearance \{([\s\S]*?)\n\}/)[1];
  assert.match(model, /courseId\s+Int\s+@unique/);
  assert.match(model, /onDelete: Cascade/);
  for (const f of [...theme.ALL_FIELDS, 'themePreset', 'createdAt', 'updatedAt']) {
    assert.match(model, new RegExp(`\\b${f}\\b`), `missing column ${f}`);
  }
});

test('the appearance migration is additive only (CREATE TABLE + FK, nothing destructive)', () => {
  const dir = fs.readdirSync(path.join(root, 'prisma/migrations')).filter((d) => d.includes('course_landing_appearance'));
  assert.equal(dir.length, 1, 'exactly one appearance migration');
  const sql = fs.readFileSync(path.join(root, 'prisma/migrations', dir[0], 'migration.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE `course_landing_appearances`/);
  assert.doesNotMatch(sql, /\bDROP\b|TRUNCATE|^\s*(DELETE|UPDATE|INSERT)\b/im);
  for (const line of sql.split('\n').filter((l) => /^ALTER TABLE/i.test(l))) assert.match(line, /^ALTER TABLE `course_landing_appearances`/);
});

// ---------------------------------------------------------------------------
// Row creation + default theme
// ---------------------------------------------------------------------------
test('ensureDefaultAppearance creates a Clinical White row once and never overwrites', async () => {
  await withDb([1], async (db) => {
    const first = await svc.ensureDefaultAppearance(1);
    assert.equal(first.created, true);
    assert.equal(first.appearance.themePreset, 'clinical-white');
    assert.equal(first.appearance.primaryColor, theme.PRESETS['clinical-white'].primaryColor);

    db.rows.get(1).accentColor = '#123456';
    const second = await svc.ensureDefaultAppearance(1, 'emerald');
    assert.equal(second.created, false);
    assert.equal(db.rows.get(1).accentColor, '#123456', 'existing row untouched');
    assert.equal(db.rows.get(1).themePreset, 'clinical-white');
  });
});

test('new courses are created with a default appearance (nested create, Clinical White)', async () => {
  const courseService = require('../src/services/course.service');
  let data = null;
  const origCreate = prisma.course.create;
  const origFind = prisma.course.findUnique;
  prisma.course.findUnique = async () => null; // slug free
  prisma.course.create = async (args) => { data = args.data; return { id: 99, ...args.data }; };
  try {
    await courseService.createCourse({
      title: 'Brand New', slugInput: 'brand-new', price: 0, salePrice: null, gstRate: null, currency: 'INR',
      level: 'BEGINNER', status: 'DRAFT', featured: false,
    });
    assert.ok(data.landingAppearance && data.landingAppearance.create, 'appearance created with the course');
    assert.equal(data.landingAppearance.create.themePreset, 'clinical-white');
    assert.equal(data.landingAppearance.create.primaryColor, theme.PRESETS['clinical-white'].primaryColor);
  } finally {
    prisma.course.create = origCreate;
    prisma.course.findUnique = origFind;
  }
});

test('a course with no appearance row renders the FMR Navy fallback and never throws', async () => {
  await withDb([1], async () => {
    const r = await svc.resolveCourseAppearance(1);
    assert.equal(r.isFallback, true);
    assert.deepEqual(r.appearance, theme.presetValues('fmr-navy'));
    const t = await svc.getRenderTheme(1);
    assert.match(t.styleAttr, /--course-primary:#2b6cf0/);
  });
  const orig = prisma.courseLandingAppearance.findUnique;
  prisma.courseLandingAppearance.findUnique = async () => { throw new Error('db down'); };
  try {
    const r = await svc.resolveCourseAppearance(1);
    assert.equal(r.isFallback, true);
  } finally {
    prisma.courseLandingAppearance.findUnique = orig;
  }
});

test('a corrupt stored value falls back safely instead of reaching the page', async () => {
  await withDb([1], async (db) => {
    await svc.ensureDefaultAppearance(1);
    db.rows.get(1).primaryColor = 'red;background:url(//evil)';
    db.rows.get(1).headingFont = 'Comic Sans; @import url(x)';
    const t = await svc.getRenderTheme(1);
    assert.doesNotMatch(t.styleAttr, /evil|@import|url\(/);
    assert.ok(theme.normalizeHex(t.appearance.primaryColor));
    assert.ok(theme.HEADING_FONTS[t.appearance.headingFont]);
  });
});

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
test('all presets exist, are fully valid and pass the allowlists', () => {
  assert.deepEqual(theme.PRESET_ORDER, ['fmr-navy', 'warm-gold', 'clinical-white', 'emerald', 'rose', 'midnight']);
  for (const key of theme.PRESET_ORDER) {
    const p = theme.presetValues(key);
    const { errors, values } = theme.validateAppearance(p, p);
    assert.deepEqual(errors, [], key);
    for (const f of theme.COLOR_FIELDS) assert.equal(values[f], p[f], `${key}.${f}`);
    // Every preset is readable: nothing may be flagged unusable.
    assert.ok(theme.checkContrast(p).every((c) => c.level !== 'unusable'), `${key} unusable contrast`);
  }
});

test('applyPreset stores the preset values; custom/unknown presets are rejected', async () => {
  await withDb([1], async (db) => {
    await svc.applyPreset(1, 'warm-gold');
    assert.equal(db.rows.get(1).themePreset, 'warm-gold');
    assert.equal(db.rows.get(1).primaryColor, theme.PRESETS['warm-gold'].primaryColor);
    await assert.rejects(() => svc.applyPreset(1, 'custom'), /Unknown theme preset/);
    await assert.rejects(() => svc.applyPreset(1, 'neon; x'), /Unknown theme preset/);
    await assert.rejects(() => svc.applyPreset(1, '__proto__'), /Unknown theme preset/);
  });
});

// ---------------------------------------------------------------------------
// Validation + custom saving
// ---------------------------------------------------------------------------
test('custom colours are saved normalised and flip the preset to custom', async () => {
  await withDb([1], async (db) => {
    await svc.applyPreset(1, 'emerald');
    await svc.updateCourseAppearance(1, { ...theme.presetValues('emerald'), accentColor: 'ABC', primaryColor: '#FF8800' });
    const row = db.rows.get(1);
    assert.equal(row.accentColor, '#aabbcc');
    assert.equal(row.primaryColor, '#ff8800');
    assert.equal(row.themePreset, 'custom');
  });
});

test('saving unchanged preset values keeps the preset name', async () => {
  await withDb([1], async (db) => {
    await svc.updateCourseAppearance(1, theme.presetValues('rose'));
    assert.equal(db.rows.get(1).themePreset, 'rose');
  });
});

test('invalid colours are rejected (injection attempts, named colours, functions)', async () => {
  const bad = ['red', 'rgb(1,2,3)', '#12', '#12345', '#gggggg', 'url(http://x)', '#fff;}body{display:none', 'var(--x)', 'expression(1)', '#ffffffff'];
  await withDb([1], async (db) => {
    for (const value of bad) {
      await assert.rejects(() => svc.updateCourseAppearance(1, { primaryColor: value }), /HEX colour/, value);
    }
    assert.equal(db.rows.size, 0, 'nothing persisted on rejection');
  });
  assert.equal(theme.normalizeHex('#ABCDEF'), '#abcdef');
  assert.equal(theme.normalizeHex('fff'), '#ffffff');
});

test('only allowlisted fonts are accepted', async () => {
  await withDb([1], async (db) => {
    for (const f of Object.keys(theme.HEADING_FONTS)) await svc.updateCourseAppearance(1, { headingFont: f });
    for (const f of Object.keys(theme.BODY_FONTS)) await svc.updateCourseAppearance(1, { bodyFont: f });
    for (const bad of ['Comic Sans', "Inter'; } body { display:none", 'https://evil.example/font.css', '@import url(x)', 'Poppins ']) {
      await assert.rejects(() => svc.updateCourseAppearance(1, { headingFont: bad }), /Heading font/, bad);
      await assert.rejects(() => svc.updateCourseAppearance(1, { bodyFont: bad }), /Body font/, bad);
    }
    // heading list must NOT accept body-only fonts and vice versa
    await assert.rejects(() => svc.updateCourseAppearance(1, { headingFont: 'Poppins' }), /Heading font/);
    await assert.rejects(() => svc.updateCourseAppearance(1, { bodyFont: 'Fraunces' }), /Body font/);
    assert.ok(db.rows.get(1));
  });
});

test('card radius, button radius and shadow only accept allowlisted names', async () => {
  await withDb([1], async () => {
    for (const v of Object.keys(theme.CARD_RADII)) await svc.updateCourseAppearance(1, { cardRadius: v });
    for (const v of Object.keys(theme.BUTTON_RADII)) await svc.updateCourseAppearance(1, { buttonRadius: v });
    for (const v of Object.keys(theme.SHADOWS)) await svc.updateCourseAppearance(1, { shadowStrength: v });
    await assert.rejects(() => svc.updateCourseAppearance(1, { cardRadius: '9999px' }), /Card style/);
    await assert.rejects(() => svc.updateCourseAppearance(1, { cardRadius: '0; background:red' }), /Card style/);
    await assert.rejects(() => svc.updateCourseAppearance(1, { buttonRadius: 'circle' }), /Button style/);
    await assert.rejects(() => svc.updateCourseAppearance(1, { shadowStrength: '0 0 99px red' }), /Shadow/);
    await assert.rejects(() => svc.updateCourseAppearance(1, { shadowStrength: 'toString' }), /Shadow/);
  });
  assert.deepEqual(Object.values(theme.CARD_RADII).sort(), ['10px', '16px', '24px', '4px']);
  assert.deepEqual(Object.values(theme.BUTTON_RADII).sort(), ['12px', '4px', '999px']);
});

test('unknown preset names are rejected on save', async () => {
  await withDb([1], async () => {
    await assert.rejects(() => svc.updateCourseAppearance(1, { themePreset: 'hacker' }), /preset/i);
  });
});

test('unreadable text/background (< 2:1) blocks the save; merely low contrast only warns', async () => {
  await withDb([1], async (db) => {
    await assert.rejects(
      () => svc.updateCourseAppearance(1, { bodyTextColor: '#fafafa', pageBackground: '#ffffff', surfaceColor: '#ffffff' }),
      /unreadable/
    );
    assert.equal(db.rows.size, 0);
    // 3:1 body text => warning level, still saves
    await svc.updateCourseAppearance(1, { bodyTextColor: '#8a8a8a' });
    assert.ok(db.rows.get(1));
  });
});

// ---------------------------------------------------------------------------
// Contrast checks
// ---------------------------------------------------------------------------
test('contrast checks cover heading/body/button pairs with ok/warn/unusable levels', () => {
  assert.ok(Math.abs(theme.contrastRatio('#000000', '#ffffff') - 21) < 0.01);
  const rows = theme.checkContrast({ ...theme.presetValues('fmr-navy'), headingColor: '#f0f0f0', buttonTextColor: '#cccccc', buttonBackground: '#dddddd' });
  const by = (label) => rows.find((r) => r.label === label);
  assert.equal(by('Heading vs page background').level, 'unusable');
  assert.ok(['warn', 'unusable'].includes(by('Button text vs button background').level));
  assert.equal(by('Body text vs page background').level, 'ok');
  for (const label of ['Heading vs page background', 'Body text vs page background', 'Button text vs button background']) assert.ok(by(label));
});

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------
test('Course A (Navy), B (Gold) and C (Emerald) stay independent when B is edited', async () => {
  await withDb([10, 20, 30], async (db) => {
    await svc.applyPreset(10, 'fmr-navy');
    await svc.applyPreset(20, 'warm-gold');
    await svc.applyPreset(30, 'emerald');
    const snapA = JSON.stringify(db.rows.get(10));
    const snapC = JSON.stringify(db.rows.get(30));

    await svc.updateCourseAppearance(20, { accentColor: '#ff0000', headingFont: 'Libre Baskerville', cardRadius: 'sharp', shadowStrength: 'strong' });
    await svc.resetAppearance(20);
    await svc.updateCourseAppearance(20, { primaryColor: '#ff6600' });

    assert.equal(JSON.stringify(db.rows.get(10)), snapA, 'A unchanged');
    assert.equal(JSON.stringify(db.rows.get(30)), snapC, 'C unchanged');
    const a = await svc.getRenderTheme(10);
    const b = await svc.getRenderTheme(20);
    const c = await svc.getRenderTheme(30);
    assert.match(a.styleAttr, /--course-primary:#2b6cf0/);
    assert.match(b.styleAttr, /--course-primary:#ff6600/);
    assert.match(c.styleAttr, /--course-primary:#059669/);
    assert.equal(a.appearance.themePreset, 'fmr-navy');
    assert.equal(c.appearance.themePreset, 'emerald');
    assert.notEqual(a.styleAttr, b.styleAttr);
    assert.notEqual(b.styleAttr, c.styleAttr);
  });
});

test('operations enforce course existence', async () => {
  await withDb([1], async () => {
    await assert.rejects(() => svc.getCourseAppearance(999), /Course not found/);
    await assert.rejects(() => svc.updateCourseAppearance(999, {}), /Course not found/);
    await assert.rejects(() => svc.applyPreset(999, 'rose'), /Course not found/);
    await assert.rejects(() => svc.resetAppearance(999), /Course not found/);
    await assert.rejects(() => svc.copyAppearance(1, 999), /Course not found/);
    await assert.rejects(() => svc.copyAppearance(999, 1), /Course not found/);
    await assert.rejects(() => svc.getCourseAppearance('abc'), /Invalid course id/);
  });
});

// ---------------------------------------------------------------------------
// Reset + copy
// ---------------------------------------------------------------------------
test('reset to preset restores the preset; custom themes have nothing to reset to', async () => {
  await withDb([1], async (db) => {
    await svc.applyPreset(1, 'rose');
    await svc.updateCourseAppearance(1, { accentColor: '#000000' });
    assert.equal(db.rows.get(1).themePreset, 'custom');
    await assert.rejects(() => svc.resetToPreset(1), /custom theme/);

    await svc.applyPreset(1, 'rose');
    db.rows.get(1).accentColor = '#000000'; // manual drift while still labelled "rose"
    await svc.resetToPreset(1);
    assert.equal(db.rows.get(1).accentColor, theme.PRESETS.rose.accentColor);
  });
});

test('reset to default restores Clinical White', async () => {
  await withDb([1], async (db) => {
    await svc.applyPreset(1, 'midnight');
    await svc.resetAppearance(1);
    assert.equal(db.rows.get(1).themePreset, 'clinical-white');
    assert.equal(db.rows.get(1).primaryColor, theme.PRESETS['clinical-white'].primaryColor);
  });
});

test('copyAppearance copies only appearance values onto the target and leaves the source intact', async () => {
  await withDb([1, 2], async (db) => {
    await svc.applyPreset(1, 'emerald');
    await svc.applyPreset(2, 'rose');
    const before = JSON.stringify(db.rows.get(1));
    await svc.copyAppearance(1, 2);
    const t = db.rows.get(2);
    assert.equal(t.courseId, 2, 'target keeps its own courseId');
    assert.equal(t.themePreset, 'emerald');
    for (const f of theme.ALL_FIELDS) assert.equal(t[f], db.rows.get(1)[f], f);
    assert.equal(JSON.stringify(db.rows.get(1)), before, 'source unchanged');
    await assert.rejects(() => svc.copyAppearance(1, 1), /different course/);
  });
  // Static guarantee: the service can only ever touch the appearance table.
  const src = fs.readFileSync(path.join(root, 'src/services/courseAppearance.service.js'), 'utf8');
  const models = [...src.matchAll(/prisma\.(\w+)\./g)].map((m) => m[1]);
  assert.deepEqual([...new Set(models)].sort(), ['course', 'courseLandingAppearance']);
  assert.doesNotMatch(src, /prisma\.course\.(update|create|delete)/);
});

test('copying from a course that has no row copies what it renders (FMR Navy)', async () => {
  await withDb([1, 2], async (db) => {
    await svc.applyPreset(2, 'rose');
    await svc.copyAppearance(1, 2);
    assert.equal(db.rows.get(2).themePreset, 'fmr-navy');
  });
});

// ---------------------------------------------------------------------------
// FMR preservation + CSS variables
// ---------------------------------------------------------------------------
function rootBlock() {
  const start = cssSrc.indexOf('.course-landing-page {');
  return cssSrc.slice(start, cssSrc.indexOf('\n}\n', start));
}

test('FMR Navy preset equals the stylesheet fallback values (current production look)', () => {
  const vars = theme.buildCssVars(theme.presetValues('fmr-navy'));
  const block = rootBlock();
  const documented = [
    'primary', 'secondary', 'accent', 'page-bg', 'surface', 'surface-alt', 'heading', 'text', 'muted', 'border',
    'button-bg', 'button-text', 'button-hover-bg', 'button-hover-text', 'hero-bg', 'hero-text', 'hero-accent',
    'stats-bg', 'stats-accent', 'success', 'danger', 'glow', 'gradient-start', 'gradient-end',
    'card-radius', 'button-radius', 'shadow', 'heading-font', 'body-font',
  ];
  assert.equal(documented.length, 29);
  for (const name of documented) {
    const m = block.match(new RegExp(`--course-${name}:\\s*([^;]+);`));
    assert.ok(m, `--course-${name} declared at the stylesheet root`);
    assert.ok(vars[`--course-${name}`] !== undefined, `--course-${name} produced by the theme module`);
  }
  // Exact production colours for the core palette.
  const expected = {
    primary: '#2b6cf0', secondary: '#0a1330', accent: '#f2b33d', 'page-bg': '#f7faff', surface: '#ffffff', heading: '#0f1b33',
    text: '#1b2745', muted: '#5b6a86', border: '#dfe8f7', 'hero-bg': '#0a1330', glow: '#172d69', success: '#14a066', danger: '#e11d48',
    'gradient-end': '#9b5cf0',
  };
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(vars[`--course-${name}`], value, name);
    assert.match(block, new RegExp(`--course-${name}:\\s*${value};`), `css fallback ${name}`);
  }
  assert.equal(vars['--course-card-radius'], '16px');
  assert.equal(vars['--course-button-radius'], '12px');
});

test('course-landing.css keeps theme colours only at the root: no hardcoded brand colours elsewhere', () => {
  const body = cssSrc.slice(cssSrc.indexOf('\n}\n', cssSrc.indexOf('.course-landing-page {')) + 3);
  const hex = [...body.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
  // Only the admin-only preview bar (not part of the course theme) may keep literal colours.
  const allowed = new Set(['#1e293b', '#f8fafc', '#f59e0b', '#0f172a']);
  assert.deepEqual(hex.filter((h) => !allowed.has(h)), []);
  for (const brand of ['2b6cf0', '0a1330', 'f2b33d', '14a066', 'e11d48', '172d69', '15275e', 'dfe8f7', '9b5cf0']) {
    assert.ok(!body.toLowerCase().includes(brand), `hardcoded ${brand}`);
  }
  assert.doesNotMatch(body, /rgba\(\s*(10|43)\s*,/);
  assert.doesNotMatch(body, /'Fraunces'|'Inter'/);
  assert.match(body, /var\(--course-heading-font\)/);
});

test('every var(--course-*) the stylesheet uses is defined at the root', () => {
  const block = rootBlock();
  const defined = new Set([...block.matchAll(/(--course-[\w-]+):/g)].map((m) => m[1]));
  const used = new Set([...cssSrc.matchAll(/var\((--course-[\w-]+)\)/g)].map((m) => m[1]));
  assert.deepEqual([...used].filter((u) => !defined.has(u)), []);
  // ...and the theme module generates each of them, so inline overrides cover all.
  const generated = theme.buildCssVars(theme.presetValues('fmr-navy'));
  assert.deepEqual([...defined].filter((d) => generated[d] === undefined), []);
});

test('public view carries no hardcoded theme colours in inline styles', () => {
  const hex = [...publicView.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
  assert.deepEqual(hex.filter((h) => !['#fef3c7', '#92400e', '#fde68a'].includes(h)), []); // admin-only DEMO badges
});

test('buildCssVars output is safe: only validated values reach the style attribute', () => {
  const evil = { ...theme.presetValues('emerald'), primaryColor: '#000;}</style><script>alert(1)</script>', headingFont: '</style>' };
  const attr = theme.toStyleAttr(theme.buildCssVars(evil));
  assert.doesNotMatch(attr, /[<>]|script|url\(|@import|expression/i);
  const attrOk = theme.toStyleAttr(theme.buildCssVars(theme.presetValues('midnight')));
  assert.match(attrOk, /^--course-primary:#8b5cf6;/);
});

test('shadow, radius and font mapping produce predefined CSS values', () => {
  const none = theme.buildCssVars({ ...theme.presetValues('fmr-navy'), shadowStrength: 'none' });
  assert.equal(none['--course-shadow'], 'none');
  const strong = theme.buildCssVars({ ...theme.presetValues('fmr-navy'), shadowStrength: 'strong', cardRadius: 'extra', buttonRadius: 'pill', headingFont: 'DM Serif Display', bodyFont: 'system sans-serif' });
  assert.match(strong['--course-shadow'], /^0 10px 28px rgba\(10, 19, 48, 0\.16\)$/);
  assert.equal(strong['--course-card-radius'], '24px');
  assert.equal(strong['--course-button-radius'], '999px');
  assert.match(strong['--course-heading-font'], /DM Serif Display/);
  assert.doesNotMatch(strong['--course-body-font'], /Inter|Poppins/);
  assert.equal(theme.googleFontsUrl({ headingFont: 'system serif', bodyFont: 'system sans-serif' }), null);
  assert.match(theme.googleFontsUrl({ headingFont: 'Playfair Display', bodyFont: 'Manrope' }), /^https:\/\/fonts\.googleapis\.com\/css2\?family=Playfair\+Display.*&family=Manrope.*&display=swap$/);
});

// ---------------------------------------------------------------------------
// Rendering: public page + admin preview + admin tab
// ---------------------------------------------------------------------------
function renderPublic(courseTheme) {
  return ejs.render(publicView, {
    cms: { course: {}, brand: {} },
    course: {
      id: 1, title: 'Some Course', slug: 'some-course', price: 0, salePrice: null, currency: 'INR',
      shortDescription: '', description: '', category: null, thumbnailUrl: null, lessons: [],
      instructor: { name: 'Dr T', photoUrl: null, credentials: [] },
    },
    isFree: true, priceLabel: 'Free', isEnrolled: false, hasPendingRequest: false, paymentsEnabled: false,
    stats: { publishedModuleCount: 1, publishedLessonCount: 3, totalDurationFormatted: '1h', resourceCount: 1, videoCount: 3 },
    curriculum: [], resources: [], faqs: [],
    landing: null, csrfToken: 't', cspNonce: 'n', courseTheme,
  }, { filename: publicViewPath });
}

test('public page renders the saved course theme as CSS variables (and selected fonts)', async () => {
  await withDb([1, 2], async () => {
    await svc.applyPreset(1, 'warm-gold');
    await svc.applyPreset(2, 'emerald');
    const gold = renderPublic(await svc.getRenderTheme(1));
    const green = renderPublic(await svc.getRenderTheme(2));
    assert.match(gold, /class="course-landing-page fmr-reference-theme" style="--course-primary:#b7791f/);
    assert.match(green, /class="course-landing-page fmr-reference-theme" style="--course-primary:#059669/);
    assert.doesNotMatch(gold, /--course-primary:#059669/);
    assert.match(gold, /fonts\.googleapis\.com\/css2\?family=Playfair\+Display/);
    assert.match(green, /family=DM\+Serif\+Display/);
  });
});

test('public page without a theme object still renders (older callers)', () => {
  const html = renderPublic(null);
  assert.match(html, /<div class="course-landing-page fmr-reference-theme">/);
});

test('public controller loads the course appearance', () => {
  const src = read('src/controllers/course.controller.js');
  assert.match(src, /courseAppearanceService\.getRenderTheme\(course\.id\)/);
  assert.match(src, /\n\s+courseTheme,\n/);
});

test('admin preview renders with the course saved appearance', async () => {
  const controller = require('../src/controllers/admin/courseLanding.controller');
  const curriculumService = require('../src/services/curriculum.service');
  const landingService = require('../src/services/courseLanding.service');
  await withDb([7], async () => {
    await svc.applyPreset(7, 'rose');
    const swaps = [];
    const swap = (o, k, v) => { const prev = o[k]; o[k] = v; swaps.push(() => { o[k] = prev; }); };
    swap(prisma.course, 'findUnique', async ({ where }) => (where.id === 7 ? { id: 7, title: 'C', slug: 'c', price: 0, instructor: null } : null));
    swap(curriculumService, 'getCourseCurriculum', async () => []);
    swap(curriculumService, 'getPublicCourseStats', async () => ({ lessonCount: 0 }));
    swap(curriculumService, 'listResourcesForCourse', async () => []);
    swap(landingService, 'getPublicLandingData', async () => null);
    let rendered = null;
    try {
      await controller.previewLanding({ params: { courseId: '7' }, flashError() {} }, { render: (view, data) => { rendered = { view, data }; }, redirect() {} }, (e) => { throw e; });
    } finally {
      swaps.reverse().forEach((r) => r());
    }
    assert.equal(rendered.view, 'public/course-detail');
    assert.equal(rendered.data.isPreview, true);
    assert.equal(rendered.data.courseTheme.appearance.themePreset, 'rose');
    assert.match(rendered.data.courseTheme.styleAttr, /--course-primary:#e11d63/);
  });
});

test('admin Appearance tab: presets, allowlisted selects, colour inputs, preview, reset and copy - no raw CSS input', async () => {
  const view = await (async () => {
    let v;
    await withDb([5, 6], async () => { v = await svc.getAdminView(5); });
    return v;
  })();
  const html = await ejs.renderFile(path.join(root, 'views/admin/courses/appearance-tab.ejs'), {
    csrfToken: 'tok', course: { id: 5, title: 'FMR' }, appearanceView: view,
  });
  for (const p of ['FMR Navy', 'Warm Gold', 'Clinical White', 'Emerald', 'Rose', 'Midnight', 'Custom']) assert.ok(html.includes(p), p);
  for (const f of theme.COLOR_FIELDS) {
    assert.match(html, new RegExp(`name="${f}"`), f);
    assert.match(html, new RegExp(`data-color-picker="${f}"`), f);
    assert.match(html, new RegExp(`data-color-swatch="${f}"`), f);
  }
  for (const font of ['Fraunces', 'Playfair Display', 'Libre Baskerville', 'DM Serif Display', 'Manrope', 'Poppins', 'System sans-serif']) assert.ok(html.includes(font), font);
  for (const label of ['Sharp', 'Soft', 'Rounded', 'Extra Rounded', 'Square', 'Pill', 'None', 'Subtle', 'Medium', 'Strong']) assert.ok(html.includes(`>${label}<`), label);
  assert.match(html, /id="appearancePreview"/);
  assert.match(html, /--course-primary:#2b6cf0/, 'preview starts from the saved/fallback theme');
  assert.match(html, /appearance\/reset-preset/);
  assert.match(html, /appearance\/reset-default/);
  assert.match(html, /appearance\/copy/);
  assert.match(html, /landing-page\/preview/);
  assert.match(html, /data-confirm="/);
  assert.doesNotMatch(html, /<textarea/i, 'no free-form CSS/style input');
  assert.doesNotMatch(html, /name="(css|style|customCss|fontUrl)"/i);
  assert.match(html, /<option value="5"|Select a course/); // copy source list renders
  assert.doesNotMatch(html, /<option value="5"[^>]*>Course 5/, 'cannot copy from itself');
});

test('landing editor shows the Appearance tab and still renders without appearance data', async () => {
  const base = {
    csrfToken: 't', activeTab: 'appearance',
    course: { id: 5, title: 'C', slug: 'c', status: 'PUBLISHED', instructor: null }, landingContent: {},
    heroChips: [], takeaways: [], questions: [], audienceItems: [], faqs: [], whyRegisterItems: [], highlights: [], testimonials: [],
    accessPlans: [], courseStats: [], landingSections: [], resources: [], accessSteps: [], comparisonColumns: [],
  };
  const without = await ejs.renderFile(path.join(root, 'views/admin/courses/landing-page-content.ejs'), base);
  assert.match(without, /id="tab-appearance"/);
  let view;
  await withDb([5, 6], async () => { view = await svc.getAdminView(5); });
  const withView = await ejs.renderFile(path.join(root, 'views/admin/courses/landing-page-content.ejs'), { ...base, appearanceView: view });
  assert.match(withView, /id="appearanceForm"/);
  assert.match(withView, /21 Appearance/);
});

test('admin appearance routes are CSRF protected and wired to the controller', () => {
  const routes = fs.readFileSync(path.join(root, 'src/routes/admin.routes.js'), 'utf8');
  for (const r of ['appearance', 'appearance/reset-preset', 'appearance/reset-default', 'appearance/copy']) {
    assert.match(routes, new RegExp(`router\\.post\\('/courses/:courseId/landing-page/${r}', doubleCsrfProtection, courseAppearanceController\\.`), r);
  }
});

test('admin controller flashes service errors and redirects back to the Appearance tab', async () => {
  const controller = require('../src/controllers/admin/courseAppearance.controller');
  await withDb([3], async (db) => {
    const flash = [];
    const mk = (body) => ({ params: { courseId: '3' }, body, flashError: (m) => flash.push(['e', m]), flashSuccess: (m) => flash.push(['s', m]) });
    let redirected = null;
    const res = { redirect: (u) => { redirected = u; } };
    await controller.saveAppearance(mk({ primaryColor: 'not-a-colour' }), res, (e) => { throw e; });
    assert.equal(redirected, '/admin/courses/3/landing-page?tab=appearance');
    assert.equal(flash[0][0], 'e');
    assert.equal(db.rows.size, 0);

    flash.length = 0;
    await controller.saveAppearance(mk({ ...theme.presetValues('emerald') }), res, (e) => { throw e; });
    assert.equal(flash[0][0], 's');
    assert.equal(db.rows.get(3).themePreset, 'emerald');
  });
});
