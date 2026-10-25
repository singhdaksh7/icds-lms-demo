const { prisma } = require('../config/db');
const { validateLinkUrl, normalizePath } = require('../lib/linkUrl');
const { parseFormBool } = require('../lib/formBool');

const LOCATIONS = ['HEADER', 'FOOTER', 'BOTH'];
const LOCATION_LABELS = { HEADER: 'Header only', FOOTER: 'Footer only', BOTH: 'Header and footer' };
const MAX_LABEL = 60;

// Real standalone pages that can be switched off from Admin > Pages. A nav item
// pointing at a disabled page is hidden automatically.
const MANAGED_PAGE_PATHS = { '/about': 'about', '/faq': 'faq', '/reviews': 'reviews', '/contact': 'contact' };

// Used ONLY to seed an empty table (scripts/init-site-pages-nav.js) and as a
// render fallback while the table is still empty, so the site never has an
// empty menu. Once any row exists the database is the single source of truth.
const DEFAULT_NAV = Object.freeze([
  { label: 'Home', url: '/', location: 'BOTH', sortOrder: 10 },
  { label: 'Courses', url: '/courses', location: 'BOTH', sortOrder: 20 },
  { label: 'About', url: '/about', location: 'BOTH', sortOrder: 30 },
  { label: 'Founder', url: '/founder', location: 'BOTH', sortOrder: 40 },
  { label: 'Reviews', url: '/reviews', location: 'BOTH', sortOrder: 50 },
  { label: 'FAQ', url: '/faq', location: 'BOTH', sortOrder: 60 },
  { label: 'Contact', url: '/contact', location: 'BOTH', sortOrder: 70 },
]);

class NavigationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'NavigationError';
    this.statusCode = statusCode;
  }
}

// ---- cache (nav is read on every public request) ---------------------------
const CACHE_TTL_MS = 30 * 1000;
let cache = { value: null, expiresAt: 0 };
function invalidateNavCache() {
  cache = { value: null, expiresAt: 0 };
}

function toPublicItem(row) {
  const external = /^https:\/\//i.test(row.url);
  return {
    id: row.id || null,
    label: row.label,
    url: row.url,
    openInNewTab: Boolean(row.openInNewTab) || false,
    external,
    isCourses: normalizePath(row.url) === '/courses',
  };
}

// Pure: rows -> { header, footer } honouring published flag, location, order and
// disabled managed pages. `disabledPaths` is a Set of normalized paths.
function buildNav(rows, disabledPaths = new Set()) {
  const visible = rows
    .filter((r) => r.isPublished !== false)
    .filter((r) => !disabledPaths.has(normalizePath(r.url)))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || (a.id || 0) - (b.id || 0));
  return {
    header: visible.filter((r) => r.location === 'HEADER' || r.location === 'BOTH').map(toPublicItem),
    footer: visible.filter((r) => r.location === 'FOOTER' || r.location === 'BOTH').map(toPublicItem),
  };
}

async function getDisabledPagePaths() {
  const rows = await prisma.sitePage.findMany({ where: { isEnabled: false }, select: { slug: true } });
  const slugs = new Set(rows.map((r) => r.slug));
  return new Set(Object.entries(MANAGED_PAGE_PATHS).filter(([, slug]) => slugs.has(slug)).map(([p]) => p));
}

// Public navigation. Never throws (a DB hiccup shows the default menu).
async function getPublicNav() {
  const now = Date.now();
  if (cache.value && now < cache.expiresAt) return cache.value;
  let nav;
  try {
    const [rows, disabled] = await Promise.all([
      prisma.navigationItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      getDisabledPagePaths().catch(() => new Set()),
    ]);
    nav = buildNav(rows.length ? rows : DEFAULT_NAV.map((d, i) => ({ ...d, id: null, isPublished: true, openInNewTab: false })), disabled);
  } catch (_err) {
    nav = buildNav(DEFAULT_NAV.map((d) => ({ ...d, isPublished: true })));
    return nav; // do not cache a degraded result
  }
  cache = { value: nav, expiresAt: now + CACHE_TTL_MS };
  return nav;
}

// ---- admin -----------------------------------------------------------------
async function listNavAdmin() {
  return prisma.navigationItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
}

function cleanLabel(value) {
  const label = String(Array.isArray(value) ? value[value.length - 1] : value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!label) throw new NavigationError('A label is required.');
  if (label.length > MAX_LABEL) throw new NavigationError(`Label must be ${MAX_LABEL} characters or fewer.`);
  return label;
}

function cleanLocation(value) {
  const v = String(Array.isArray(value) ? value[value.length - 1] : value ?? '').toUpperCase();
  if (!LOCATIONS.includes(v)) throw new NavigationError('Location must be Header, Footer or Both.');
  return v;
}

function cleanUrl(value) {
  const r = validateLinkUrl(Array.isArray(value) ? value[value.length - 1] : value);
  if (!r.ok) throw new NavigationError(r.error);
  return r.value;
}

async function createNavItem(input = {}) {
  const label = cleanLabel(input.label);
  const url = cleanUrl(input.url);
  const location = input.location === undefined ? 'BOTH' : cleanLocation(input.location);
  const max = await prisma.navigationItem.aggregate({ _max: { sortOrder: true } });
  const sortOrder = ((max && max._max && max._max.sortOrder) || 0) + 10;
  const isPublished = input.isPublished === undefined ? true : parseFormBool(input.isPublished);
  const openInNewTab = input.openInNewTab === undefined ? /^https:\/\//i.test(url) : parseFormBool(input.openInNewTab);
  const row = await prisma.navigationItem.create({ data: { label, url, location, sortOrder, isPublished, openInNewTab } });
  invalidateNavCache();
  return row;
}

// Patch-style: only the fields present in `input` change.
async function updateNavItem(id, input = {}) {
  const existing = await prisma.navigationItem.findUnique({ where: { id } });
  if (!existing) throw new NavigationError('Navigation item not found.', 404);
  const data = {};
  if (input.label !== undefined) data.label = cleanLabel(input.label);
  if (input.url !== undefined) data.url = cleanUrl(input.url);
  if (input.location !== undefined) data.location = cleanLocation(input.location);
  if (input.isPublished !== undefined) data.isPublished = parseFormBool(input.isPublished);
  if (input.openInNewTab !== undefined) data.openInNewTab = parseFormBool(input.openInNewTab);
  if (input.sortOrder !== undefined && Number.isFinite(Number(input.sortOrder))) data.sortOrder = Math.trunc(Number(input.sortOrder));
  const row = await prisma.navigationItem.update({ where: { id }, data });
  invalidateNavCache();
  return row;
}

async function deleteNavItem(id) {
  const existing = await prisma.navigationItem.findUnique({ where: { id } });
  if (!existing) throw new NavigationError('Navigation item not found.', 404);
  await prisma.navigationItem.delete({ where: { id } });
  invalidateNavCache();
}

// Swap sortOrder with the neighbour in the requested direction (persistent).
async function moveNavItem(id, direction) {
  const rows = await prisma.navigationItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) throw new NavigationError('Navigation item not found.', 404);
  const swapIdx = direction === 'up' ? idx - 1 : direction === 'down' ? idx + 1 : -1;
  if (swapIdx < 0 || swapIdx >= rows.length) return false;
  // Re-number the whole list so equal/legacy sortOrders can never block a move.
  const order = rows.map((r) => r.id);
  [order[idx], order[swapIdx]] = [order[swapIdx], order[idx]];
  await prisma.$transaction(order.map((rowId, i) => prisma.navigationItem.update({ where: { id: rowId }, data: { sortOrder: (i + 1) * 10 } })));
  invalidateNavCache();
  return true;
}

// Seeds the default menu ONLY when the table is empty. Never overwrites.
async function ensureDefaultNav() {
  const count = await prisma.navigationItem.count();
  if (count > 0) return { created: 0 };
  await prisma.navigationItem.createMany({ data: DEFAULT_NAV.map((d) => ({ ...d, isPublished: true, openInNewTab: false })) });
  invalidateNavCache();
  return { created: DEFAULT_NAV.length };
}

module.exports = {
  LOCATIONS,
  LOCATION_LABELS,
  DEFAULT_NAV,
  MANAGED_PAGE_PATHS,
  NavigationError,
  buildNav,
  getPublicNav,
  invalidateNavCache,
  listNavAdmin,
  createNavItem,
  updateNavItem,
  deleteNavItem,
  moveNavItem,
  ensureDefaultNav,
};
