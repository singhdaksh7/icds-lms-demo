process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

// Admin-managed navigation: URL validation, ordering, visibility, disabled-page
// hiding, partial updates, defaults and the header/footer rendering contract.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const { prisma } = require('../src/config/db');
const nav = require('../src/services/navigation.service');
const { validateLinkUrl, normalizePath } = require('../src/lib/linkUrl');
const site = require('../src/config/site');
const settingsService = require('../src/services/settings.service');

const root = path.join(__dirname, '..');

function installFakeNav(initial = [], disabledSlugs = []) {
  let rows = initial.map((r, i) => ({ id: i + 1, location: 'BOTH', sortOrder: (i + 1) * 10, isPublished: true, openInNewTab: false, ...r }));
  let nextId = rows.length + 1;
  const orig = {
    nav: { ...prisma.navigationItem },
    page: { ...prisma.sitePage },
    tx: prisma.$transaction,
  };
  const sorted = () => [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  prisma.navigationItem.findMany = async () => sorted();
  prisma.navigationItem.findUnique = async ({ where }) => rows.find((r) => r.id === where.id) || null;
  prisma.navigationItem.count = async () => rows.length;
  prisma.navigationItem.aggregate = async () => ({ _max: { sortOrder: rows.reduce((m, r) => Math.max(m, r.sortOrder), 0) || null } });
  prisma.navigationItem.create = async ({ data }) => { const row = { id: nextId++, ...data }; rows.push(row); return row; };
  prisma.navigationItem.createMany = async ({ data }) => { data.forEach((d) => rows.push({ id: nextId++, ...d })); return { count: data.length }; };
  prisma.navigationItem.update = async ({ where, data }) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; };
  prisma.navigationItem.delete = async ({ where }) => { rows = rows.filter((r) => r.id !== where.id); };
  prisma.sitePage.findMany = async () => disabledSlugs.map((slug) => ({ slug }));
  prisma.$transaction = async (ops) => Promise.all(ops);
  nav.invalidateNavCache();
  return {
    get rows() { return rows; },
    disable(slug) { disabledSlugs.push(slug); nav.invalidateNavCache(); },
    restore() {
      Object.assign(prisma.navigationItem, orig.nav);
      Object.assign(prisma.sitePage, orig.page);
      prisma.$transaction = orig.tx;
      nav.invalidateNavCache();
    },
  };
}

async function withNav(initial, fn, disabled) {
  const db = installFakeNav(initial, disabled);
  try { await fn(db); } finally { db.restore(); }
}

// ---------------------------------------------------------------------------
// URL validation (security)
// ---------------------------------------------------------------------------
test('link URLs: internal paths and https are accepted', () => {
  for (const ok of ['/', '/about', '/courses?category=hair', '/#faq', '/founder#story', 'https://example.com', 'https://example.com/a/b?x=1#y']) {
    assert.equal(validateLinkUrl(ok).ok, true, ok);
  }
  assert.equal(validateLinkUrl('https://example.com').external, true);
  assert.equal(validateLinkUrl('/about').external, false);
});

test('link URLs: dangerous or malformed destinations are rejected', () => {
  const bad = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', '//evil.example', '///evil.example',
    'http://insecure.example', 'ftp://x.example', 'about', 'mailto:a@b.co', '/a b', '/a"onmouseover="x', "/a'b", '/a<b', 'https://user:pw@example.com', 'https://', '',
    '/' + 'a'.repeat(400), '/\\evil', '/a\nb',
  ];
  for (const v of bad) assert.equal(validateLinkUrl(v).ok, false, JSON.stringify(v).slice(0, 40));
  assert.equal(validateLinkUrl('', { allowEmpty: true }).ok, true);
  assert.equal(normalizePath('/FAQ/?x=1#y'), '/faq');
});

// ---------------------------------------------------------------------------
// Pure nav building
// ---------------------------------------------------------------------------
test('buildNav honours location, published flag, order and disabled pages', () => {
  const rows = [
    { id: 1, label: 'Home', url: '/', location: 'BOTH', sortOrder: 10, isPublished: true },
    { id: 2, label: 'FAQ', url: '/faq', location: 'HEADER', sortOrder: 30, isPublished: true },
    { id: 3, label: 'Hidden', url: '/x', location: 'BOTH', sortOrder: 20, isPublished: false },
    { id: 4, label: 'Terms', url: '/terms', location: 'FOOTER', sortOrder: 5, isPublished: true },
    { id: 5, label: 'About', url: '/about', location: 'BOTH', sortOrder: 25, isPublished: true },
    { id: 6, label: 'Docs', url: 'https://docs.example.com', location: 'BOTH', sortOrder: 40, isPublished: true, openInNewTab: true },
  ];
  const out = nav.buildNav(rows, new Set(['/about']));
  assert.deepEqual(out.header.map((i) => i.label), ['Home', 'FAQ', 'Docs']);
  assert.deepEqual(out.footer.map((i) => i.label), ['Terms', 'Home', 'Docs']);
  assert.equal(out.header[2].external, true);
  assert.equal(out.header[2].openInNewTab, true);
  assert.equal(nav.buildNav([{ label: 'C', url: '/courses', location: 'HEADER', isPublished: true }]).header[0].isCourses, true);
});

// ---------------------------------------------------------------------------
// Service behaviour
// ---------------------------------------------------------------------------
test('an empty table renders the default real-page menu (never empty, never anchors)', async () => {
  await withNav([], async () => {
    const out = await nav.getPublicNav();
    assert.deepEqual(out.header.map((i) => i.label), ['Home', 'Courses', 'About', 'Founder', 'Reviews', 'FAQ', 'Contact']);
    assert.deepEqual(out.header.map((i) => i.url), ['/', '/courses', '/about', '/founder', '/reviews', '/faq', '/contact']);
    assert.ok(out.header.every((i) => !i.url.includes('#')), 'no homepage-anchor links');
  });
});

test('once rows exist the database is the single source of truth', async () => {
  await withNav([{ label: 'Start', url: '/' }, { label: 'Only', url: '/only' }], async () => {
    const out = await nav.getPublicNav();
    assert.deepEqual(out.header.map((i) => i.label), ['Start', 'Only']);
  });
});

test('a disabled page disappears from the menu automatically (and returns when re-enabled)', async () => {
  await withNav([{ label: 'FAQ', url: '/faq' }, { label: 'Home', url: '/' }], async (db) => {
    assert.equal((await nav.getPublicNav()).header.length, 2);
    db.disable('faq');
    assert.deepEqual((await nav.getPublicNav()).header.map((i) => i.label), ['Home']);
  });
});

test('create validates label, url and location; rejects unsafe input', async () => {
  await withNav([], async (db) => {
    await assert.rejects(() => nav.createNavItem({ label: '', url: '/x' }), /label is required/i);
    await assert.rejects(() => nav.createNavItem({ label: 'x'.repeat(61), url: '/x' }), /60 characters/);
    await assert.rejects(() => nav.createNavItem({ label: 'Bad', url: 'javascript:alert(1)' }), /internal path|https/i);
    await assert.rejects(() => nav.createNavItem({ label: 'Bad', url: '//evil.example' }), /Protocol-relative/);
    await assert.rejects(() => nav.createNavItem({ label: 'Bad', url: '/ok', location: 'SIDEBAR' }), /Location/);
    assert.equal(db.rows.length, 0);
    const row = await nav.createNavItem({ label: '  Blog ', url: '/blog', location: 'footer' });
    assert.equal(row.label, 'Blog');
    assert.equal(row.location, 'FOOTER');
    assert.equal(row.openInNewTab, false);
    const ext = await nav.createNavItem({ label: 'Docs', url: 'https://docs.example.com' });
    assert.equal(ext.openInNewTab, true, 'external links default to a new tab');
    assert.ok(ext.sortOrder > row.sortOrder, 'appended at the end');
  });
});

test('updates are partial (patch-style) and boolean-safe', async () => {
  await withNav([{ label: 'About', url: '/about', location: 'BOTH', isPublished: true, openInNewTab: false }], async (db) => {
    await nav.updateNavItem(1, { label: 'Who we are' });
    assert.equal(db.rows[0].label, 'Who we are');
    assert.equal(db.rows[0].url, '/about', 'untouched');
    assert.equal(db.rows[0].isPublished, true, 'editing the label never toggles visibility');
    assert.equal(db.rows[0].location, 'BOTH');

    await nav.updateNavItem(1, { isPublished: ['false', 'true'] }); // hidden false + checked checkbox
    assert.equal(db.rows[0].isPublished, true);
    await nav.updateNavItem(1, { isPublished: 'false' }); // unchecked
    assert.equal(db.rows[0].isPublished, false);
    assert.equal(db.rows[0].label, 'Who we are');
    await nav.updateNavItem(1, { openInNewTab: ['false', 'on'] });
    assert.equal(db.rows[0].openInNewTab, true);

    await assert.rejects(() => nav.updateNavItem(1, { url: 'data:text/html,x' }), /internal path|https/i);
    assert.equal(db.rows[0].url, '/about');
    await assert.rejects(() => nav.updateNavItem(99, { label: 'x' }), /not found/i);
  });
});

test('move persists a new order (and the public menu follows)', async () => {
  await withNav([{ label: 'A', url: '/a' }, { label: 'B', url: '/b' }, { label: 'C', url: '/c' }], async () => {
    assert.deepEqual((await nav.getPublicNav()).header.map((i) => i.label), ['A', 'B', 'C']);
    assert.equal(await nav.moveNavItem(3, 'up'), true);
    assert.deepEqual((await nav.getPublicNav()).header.map((i) => i.label), ['A', 'C', 'B']);
    assert.equal(await nav.moveNavItem(3, 'up'), true);
    assert.deepEqual((await nav.getPublicNav()).header.map((i) => i.label), ['C', 'A', 'B']);
    assert.equal(await nav.moveNavItem(3, 'up'), false, 'already first');
    assert.equal(await nav.moveNavItem(1, 'down'), true);
    assert.deepEqual((await nav.getPublicNav()).header.map((i) => i.label), ['C', 'B', 'A']);
  });
});

test('moving works even when legacy rows share the same sortOrder', async () => {
  await withNav([{ label: 'A', url: '/a', sortOrder: 0 }, { label: 'B', url: '/b', sortOrder: 0 }], async () => {
    assert.equal(await nav.moveNavItem(2, 'up'), true);
    assert.deepEqual((await nav.getPublicNav()).header.map((i) => i.label), ['B', 'A']);
  });
});

test('delete removes the item; ensureDefaultNav only seeds an EMPTY table', async () => {
  await withNav([{ label: 'A', url: '/a' }], async (db) => {
    assert.deepEqual(await nav.ensureDefaultNav(), { created: 0 });
    await nav.deleteNavItem(1);
    assert.equal(db.rows.length, 0);
    const seeded = await nav.ensureDefaultNav();
    assert.equal(seeded.created, nav.DEFAULT_NAV.length);
    assert.deepEqual(await nav.ensureDefaultNav(), { created: 0 }, 'idempotent');
  });
});

test('navigation changes are visible immediately (cache invalidated on write)', async () => {
  await withNav([{ label: 'A', url: '/a' }], async () => {
    assert.equal((await nav.getPublicNav()).header[0].label, 'A');
    await nav.updateNavItem(1, { label: 'Renamed' });
    assert.equal((await nav.getPublicNav()).header[0].label, 'Renamed');
  });
});

// ---------------------------------------------------------------------------
// Rendering contract: header / footer / middleware / admin routes
// ---------------------------------------------------------------------------
const VIEWS = path.join(root, 'views');
const render = (view, data) => ejs.renderFile(path.join(VIEWS, view), data, { views: [VIEWS] });
const baseView = (extra = {}) => ({
  cms: settingsService.defaultContent(), site, fill: settingsService.fill, csrfToken: 'tok', flash: {}, currentUser: undefined,
  footerCategories: [], pageTitle: 'T', metaDescription: 'D', seo: undefined, ...extra,
});
const item = (label, url, extra = {}) => ({ label, url, openInNewTab: false, external: /^https:/.test(url), isCourses: url === '/courses', ...extra });

test('header renders the admin-managed items in order with real URLs', async () => {
  const html = await render('partials/header.ejs', baseView({
    currentPath: '/faq',
    navHeader: [item('Start', '/'), item('Questions', '/faq'), item('Docs', 'https://docs.example.com', { openInNewTab: true })],
  }));
  assert.ok(html.indexOf('>Start<') < html.indexOf('>Questions<') && html.indexOf('>Questions<') < html.indexOf('>Docs<'));
  assert.match(html, /href="\/faq" aria-current="page">Questions</);
  assert.match(html, /href="https:\/\/docs\.example\.com" target="_blank" rel="noopener noreferrer">Docs</);
  assert.doesNotMatch(html, /href="\/#(faq|about|testimonials|instructors)"/, 'no homepage-anchor redirects');
  assert.doesNotMatch(html, />Instructors</, 'legacy hardcoded menu is not rendered when admin navigation is active');
});

test('header keeps the Courses category dropdown for the /courses item', async () => {
  const html = await render('partials/header.ejs', baseView({
    navHeader: [item('Courses', '/courses')],
    footerCategories: [{ name: 'Hair & Skin', slug: 'hair-skin' }],
  }));
  assert.match(html, /dropdown-toggle[^>]*href="\/courses"/);
  assert.match(html, /\/courses\?category=hair-skin/);
});

test('header escapes admin-provided labels and URLs', async () => {
  const html = await render('partials/header.ejs', baseView({ navHeader: [item('<script>alert(1)</script>', '/x"onmouseover="y')] }));
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /onmouseover="y/);
});

test('footer Platform column renders the admin-managed footer links', async () => {
  const html = await render('partials/footer.ejs', baseView({ navFooter: [item('Terms of use', '/terms'), item('Reviews', '/reviews')] }));
  assert.match(html, /<a href="\/terms">Terms of use<\/a>/);
  assert.match(html, /<a href="\/reviews">Reviews<\/a>/);
  assert.doesNotMatch(html, /href="\/#faq"/);
});

test('without admin navigation locals the legacy template still renders (compatibility)', async () => {
  const html = await render('partials/header.ejs', baseView());
  assert.match(html, /navigation-link/);
});

test('site middleware exposes navHeader/navFooter and currentPath', () => {
  const src = fs.readFileSync(path.join(root, 'src/middleware/site.middleware.js'), 'utf8');
  assert.match(src, /getPublicNav/);
  assert.match(src, /res\.locals\.navHeader = nav\.header/);
  assert.match(src, /res\.locals\.navFooter = nav\.footer/);
  assert.match(src, /res\.locals\.currentPath = req\.path/);
});

test('admin navigation routes are CSRF protected', () => {
  const src = fs.readFileSync(path.join(root, 'src/routes/adminPages.routes.js'), 'utf8').replace(/\r\n/g, '\n');
  for (const r of ["'/navigation'", "'/navigation/:id/edit'", "'/navigation/:id/delete'", "'/navigation/:id/move'", "'/navigation/:id/toggle'", "'/navigation/defaults'"]) {
    assert.match(src, new RegExp(`router\\.post\\(${r.replace(/[/:]/g, (m) => '\\' + m)}, doubleCsrfProtection`), r);
  }
  const adminRoutes = fs.readFileSync(path.join(root, 'src/routes/admin.routes.js'), 'utf8');
  assert.match(adminRoutes, /adminPages\.routes/);
});

test('admin navigation screen renders every control, no raw HTML/CSS input', async () => {
  const html = await render('admin/navigation/list-content.ejs', {
    ...baseView(), activeNav: 'navigation', csrfToken: 'tok',
    items: [{ id: 1, label: 'FAQ', url: '/faq', location: 'BOTH', sortOrder: 10, isPublished: true, openInNewTab: false }],
    pages: [{ slug: 'faq', path: '/faq', isEnabled: false }],
    locations: nav.LOCATIONS, locationLabels: nav.LOCATION_LABELS, usingDefaults: false, defaults: nav.DEFAULT_NAV,
  });
  assert.match(html, /navigation\/1\/edit/);
  assert.match(html, /navigation\/1\/move/);
  assert.match(html, /navigation\/1\/delete/);
  assert.match(html, /name="openInNewTab"/);
  assert.match(html, /Hidden: page is disabled/);
  assert.doesNotMatch(html, /<textarea/i);
});
