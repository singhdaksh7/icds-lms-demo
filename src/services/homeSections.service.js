const { prisma } = require('../config/db');

// Homepage section order + visibility, stored as two SiteSetting JSON arrays
// (same approach as the founder page). Nothing saved => the default order below,
// which is today's homepage layout with the intro video after the featured
// courses. New/unknown keys are appended so a code update that adds a section
// never loses it from an already-saved order.
const SECTIONS = [
  { key: 'BANNER', label: 'Banner carousel' },
  { key: 'HERO', label: 'Hero' },
  { key: 'CATEGORIES', label: 'Categories' },
  { key: 'COURSES', label: 'Featured courses' },
  { key: 'INTRO_VIDEO', label: 'Intro / promo video' },
  { key: 'ABOUT', label: 'Why choose us (About)' },
  { key: 'PROCESS', label: 'Learning process' },
  { key: 'MENTOR', label: 'Meet your mentor' },
  { key: 'HOME_REVIEWS', label: 'Reviews carousel' },
  { key: 'TESTIMONIALS', label: 'Student reviews' },
  { key: 'FAQ', label: 'FAQ' },
  { key: 'NEWSLETTER', label: 'Newsletter' },
];
const SECTION_KEYS = SECTIONS.map((s) => s.key);
const ORDER_KEY = 'home.sections.order';
const HIDDEN_KEY = 'home.sections.hidden';

class HomeSectionsError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'HomeSectionsError';
    this.status = status;
  }
}

function parseKeyList(raw) {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((k, i) => SECTION_KEYS.includes(k) && arr.indexOf(k) === i);
  } catch (_err) {
    return [];
  }
}

// Pure: build { order, hidden } from raw stored strings.
function resolveConfig(orderRaw, hiddenRaw) {
  const custom = parseKeyList(orderRaw);
  let order;
  if (custom.length === 0) {
    order = [...SECTION_KEYS];
  } else {
    // Keys missing from a saved order keep their DEFAULT relative position
    // (inserted after the nearest preceding default key already present).
    order = [...custom];
    SECTION_KEYS.forEach((k, idx) => {
      if (order.includes(k)) return;
      let at = -1;
      for (let j = idx - 1; j >= 0; j -= 1) {
        const p = order.indexOf(SECTION_KEYS[j]);
        if (p !== -1) { at = p; break; }
      }
      order.splice(at + 1, 0, k);
    });
  }
  return { order, hidden: parseKeyList(hiddenRaw) };
}

async function getSectionConfig() {
  let rows = [];
  try {
    rows = await prisma.siteSetting.findMany({ where: { key: { in: [ORDER_KEY, HIDDEN_KEY] } } });
  } catch (_err) {
    rows = [];
  }
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return resolveConfig(map[ORDER_KEY], map[HIDDEN_KEY]);
}

// Keys to render, in order, hidden ones removed.
async function getRenderOrder() {
  const { order, hidden } = await getSectionConfig();
  return order.filter((k) => !hidden.includes(k));
}

async function writeSetting(key, value) {
  await prisma.siteSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

// Patch-style: moving only rewrites the order key, toggling only the hidden key.
async function moveSection(key, direction) {
  if (!SECTION_KEYS.includes(key)) throw new HomeSectionsError('Unknown section');
  if (direction !== 'up' && direction !== 'down') throw new HomeSectionsError('Invalid direction');
  const { order } = await getSectionConfig();
  const i = order.indexOf(key);
  const t = direction === 'up' ? i - 1 : i + 1;
  if (t >= 0 && t < order.length) [order[i], order[t]] = [order[t], order[i]];
  await writeSetting(ORDER_KEY, JSON.stringify(order));
  return order;
}

async function toggleSection(key) {
  if (!SECTION_KEYS.includes(key)) throw new HomeSectionsError('Unknown section');
  const { hidden } = await getSectionConfig();
  const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
  await writeSetting(HIDDEN_KEY, JSON.stringify(next));
  return next;
}

module.exports = {
  SECTIONS,
  SECTION_KEYS,
  ORDER_KEY,
  HIDDEN_KEY,
  HomeSectionsError,
  resolveConfig,
  getSectionConfig,
  getRenderOrder,
  moveSection,
  toggleSection,
};
