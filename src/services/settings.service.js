const { prisma } = require('../config/db');
const site = require('../config/site');
const imageStorage = require('../lib/imageStorage');
const {
  DEFAULTS,
  SAFE_CTA_TARGETS,
  FIELD_BY_KEY,
  BOOLEAN_KEYS,
} = require('../config/siteContent');

// Admin-editable site content lives in one small key/value table
// (`site_settings`). Every key is declared in src/config/siteContent.js with
// its current production copy as the default, so a missing/partial DB row is
// always safe: the public site never renders "undefined" or an empty section
// by accident, and no startup seeding is needed (nothing is duplicated).
//
// Resolution is one cached query for the whole site (not per view / per key).
// Admin saves call invalidateCache(), so changes show on the next request.

let cache = { data: null, expiresAt: 0 };
const CACHE_TTL_MS = 30 * 1000;

function toBool(value) {
  return value === 'true' || value === true;
}

// "hero.imagePath" -> "hero.imageUrl": image settings also get a ready-to-use
// public URL (null when unset / not a valid "site/<uuid>.<ext>" reference).
function urlKeyFor(key) {
  return key.endsWith('Path') ? `${key.slice(0, -4)}Url` : `${key}Url`;
}

// Builds the nested object that views read as `cms`:
//   'hero.heading' -> cms.hero.heading
//   'legal.privacy.heading' -> cms.legal.privacy.heading
// Booleans are real booleans; image fields get a sibling "...Url".
function buildContent(flat) {
  const root = {};
  const put = (key, value) => {
    const parts = key.split('.');
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
  };

  for (const [key, field] of FIELD_BY_KEY) {
    const raw = Object.prototype.hasOwnProperty.call(flat, key) ? flat[key] : field.def;
    if (field.type === 'bool') {
      put(key, toBool(raw));
    } else if (field.type === 'image') {
      put(key, raw);
      put(urlKeyFor(key), imageStorage.siteImagePublicUrl(raw));
    } else {
      put(key, raw);
    }
  }
  return root;
}

function resolveFlat(rows) {
  const merged = { ...DEFAULTS };
  for (const row of rows) {
    // A blank saved value always means "use the default".
    if (row.value === '') continue;
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, row.key)) {
      merged[row.key] = row.value;
    }
  }
  return merged;
}

// Defaults-only content, used before the first DB read / when the DB is down
// and as the `app.locals.cms` fallback so a view can never crash on a missing
// local.
function defaultContent() {
  return buildContent({ ...DEFAULTS });
}

function applySiteOverrides(flat) {
  site.applyOverrides({
    name: flat['site.name'],
    shortName: flat['brand.shortName'],
    copyrightName: flat['brand.copyrightName'],
    email: flat['contact.email'],
    supportEmail: flat['contact.supportEmail'],
    phone: flat['contact.phone'],
    address: flat['contact.address'],
    seoTitle: flat['seo.defaultTitle'],
    seoDescription: flat['seo.defaultDescription'],
  });
}

// Returns the effective settings (defaults overlaid with saved rows) as a
// flat key->string map, plus `.cms`, the nested/typed view-facing object.
async function getSettings() {
  if (cache.data && Date.now() < cache.expiresAt) return cache.data;

  let rows = [];
  try {
    rows = await prisma.siteSetting.findMany();
  } catch (err) {
    // DB unavailable or table not yet migrated: fall back to defaults
    // rather than breaking every page render.
    rows = [];
  }

  const flat = resolveFlat(rows);
  Object.defineProperty(flat, 'cms', { value: buildContent(flat), enumerable: false });

  // Admin-managed institute/contact details override the env defaults on
  // the shared `site` config (blank = env fallback).
  applySiteOverrides(flat);

  cache = { data: flat, expiresAt: Date.now() + CACHE_TTL_MS };
  return flat;
}

function invalidateCache() {
  cache = { data: null, expiresAt: 0 };
}

// Admin: effective value for every known key (never an arbitrary key).
async function listSettingsAdmin() {
  const rows = await prisma.siteSetting.findMany();
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const result = {};
  for (const key of Object.keys(DEFAULTS)) {
    result[key] = byKey.has(key) && byKey.get(key) !== '' ? byKey.get(key) : DEFAULTS[key];
  }
  return result;
}

// Bulk save of a validated {key: value} map. Unknown keys are silently
// dropped - this can never store an arbitrary key. A blank value deletes the
// row (back to the default), so clearing a field in Admin really resets it.
async function updateSettings(values) {
  const entries = Object.entries(values).filter(([key]) => Object.prototype.hasOwnProperty.call(DEFAULTS, key));
  if (entries.length === 0) return;
  await prisma.$transaction(
    entries.map(([key, value]) =>
      value === ''
        ? prisma.siteSetting.deleteMany({ where: { key } })
        : prisma.siteSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
    )
  );
  invalidateCache();
}

// Replaces "{course}"-style tokens in an admin-supplied label. The result is
// still printed with <%= %> (escaped), so a token value can never inject HTML.
function fill(template, tokens = {}) {
  return String(template == null ? '' : template).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(tokens, name) ? String(tokens[name]) : match
  );
}

module.exports = {
  DEFAULTS,
  SAFE_CTA_TARGETS,
  BOOLEAN_KEYS,
  getSettings,
  listSettingsAdmin,
  updateSettings,
  invalidateCache,
  buildContent,
  defaultContent,
  fill,
};
