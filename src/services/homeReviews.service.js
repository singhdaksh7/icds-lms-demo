const { prisma } = require('../config/db');
const tv = require('../lib/testimonialVideo');

// Homepage reviews section: which reviews appear is decided ONLY by Admin
// (featuredOnHome + homeSortOrder on each genuine review); how the section looks
// and behaves is the settings below (SiteSetting rows). Saves are patch-style:
// only the fields that were submitted are written, so this section can never wipe
// other homepage settings and a missing field is never silently reset.
const KEYS = {
  enabled: 'homeReviews.enabled',
  eyebrow: 'homeReviews.eyebrow',
  heading: 'homeReviews.heading',
  subheading: 'homeReviews.subheading',
  carouselEnabled: 'homeReviews.carouselEnabled',
  carouselRotate: 'homeReviews.autoplay',
  autoplayInterval: 'homeReviews.autoplayInterval',
  direction: 'homeReviews.direction',
  cardsDesktop: 'homeReviews.cardsDesktop',
  cardsTablet: 'homeReviews.cardsTablet',
  showArrows: 'homeReviews.showArrows',
  showDots: 'homeReviews.showDots',
  backgroundStyle: 'homeReviews.backgroundStyle',
};
const DIRECTIONS = ['LEFT_TO_RIGHT', 'RIGHT_TO_LEFT'];
const BACKGROUNDS = ['CREAM', 'LIGHT', 'DARK'];
const BOOLEAN_KEYS = ['enabled', 'carouselEnabled', 'carouselRotate', 'showArrows', 'showDots'];
const DEFAULTS = {
  enabled: true,
  eyebrow: 'Learner stories',
  heading: 'What our learners say',
  subheading: '',
  carouselEnabled: true,
  carouselRotate: true,
  autoplayInterval: 6000,
  direction: 'LEFT_TO_RIGHT',
  cardsDesktop: 3,
  cardsTablet: 2,
  showArrows: true,
  showDots: true,
  backgroundStyle: 'CREAM',
};
const MIN_INTERVAL = 2000;
const MAX_INTERVAL = 15000;
const MAX_EYEBROW = 80;
const MAX_HEADING = 120;
const MAX_SUBHEADING = 300;
const HOME_REVIEW_LIMIT = 12;

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const v = String(value).trim().toLowerCase();
  if (['true', '1', 'on', 'yes'].includes(v)) return true;
  if (['false', '0', 'off', 'no'].includes(v)) return false;
  return fallback;
}

const last = (v) => (Array.isArray(v) ? v[v.length - 1] : v);
const clampInt = (v, min, max, fallback) => {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

// Turns raw stored strings / form values into a complete, safe settings object.
function normalizeSettings(raw = {}) {
  const heading = typeof raw.heading === 'string' ? raw.heading.trim() : '';
  const subheading = typeof raw.subheading === 'string' ? raw.subheading.trim() : '';
  const out = {
    enabled: parseBool(raw.enabled, DEFAULTS.enabled),
    // An explicitly saved blank eyebrow stays blank (hidden); only a never-saved one uses the default.
    eyebrow: typeof raw.eyebrow === 'string' ? raw.eyebrow.trim() : DEFAULTS.eyebrow,
    heading: heading || DEFAULTS.heading,
    subheading,
    carouselEnabled: parseBool(raw.carouselEnabled, DEFAULTS.carouselEnabled),
    carouselRotate: parseBool(raw.carouselRotate, DEFAULTS.carouselRotate),
    autoplayInterval: clampInt(raw.autoplayInterval, MIN_INTERVAL, MAX_INTERVAL, DEFAULTS.autoplayInterval),
    direction: DIRECTIONS.includes(raw.direction) ? raw.direction : DEFAULTS.direction,
    cardsDesktop: clampInt(raw.cardsDesktop, 2, 3, DEFAULTS.cardsDesktop),
    cardsTablet: clampInt(raw.cardsTablet, 1, 2, DEFAULTS.cardsTablet),
    showArrows: parseBool(raw.showArrows, DEFAULTS.showArrows),
    showDots: parseBool(raw.showDots, DEFAULTS.showDots),
    backgroundStyle: BACKGROUNDS.includes(raw.backgroundStyle) ? raw.backgroundStyle : DEFAULTS.backgroundStyle,
  };
  return out;
}

// Owner-controlled client-demo switch (SiteSetting demo.showReviewsPublicly = "true").
// When on, demo testimonials are shown publicly WITH their DEMO REVIEW badge; they
// are still excluded from counts, averages and JSON-LD. Off by default.
async function isDemoShowcaseEnabled() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'demo.showReviewsPublicly' } });
    return Boolean(row && String(row.value).trim().toLowerCase() === 'true');
  } catch (_err) {
    return false;
  }
}

async function getHomeReviewSettings() {
  let rows = [];
  try {
    rows = await prisma.siteSetting.findMany({ where: { key: { in: Object.values(KEYS) } } });
  } catch (_err) {
    return { ...DEFAULTS };
  }
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const raw = {};
  for (const [field, key] of Object.entries(KEYS)) raw[field] = map[key];
  return normalizeSettings(raw);
}

// Validates admin input. Returns { ok, errors, values, provided }.
// `provided` lists the fields the caller actually submitted (the only ones saved).
function validateHomeReviewSettings(input = {}) {
  const errors = [];
  const has = (k) => input[k] !== undefined;
  const provided = Object.keys(KEYS).filter(has);
  const heading = String(last(input.heading) ?? '').trim();
  const subheading = String(last(input.subheading) ?? '').trim();
  const eyebrow = String(last(input.eyebrow) ?? '').trim();
  if (heading.length > MAX_HEADING) errors.push(`Heading must be ${MAX_HEADING} characters or fewer.`);
  if (subheading.length > MAX_SUBHEADING) errors.push(`Subheading must be ${MAX_SUBHEADING} characters or fewer.`);
  if (eyebrow.length > MAX_EYEBROW) errors.push(`Eyebrow must be ${MAX_EYEBROW} characters or fewer.`);
  if (has('direction') && !DIRECTIONS.includes(last(input.direction))) errors.push('Direction must be LEFT_TO_RIGHT or RIGHT_TO_LEFT.');
  if (has('backgroundStyle') && !BACKGROUNDS.includes(last(input.backgroundStyle))) errors.push('Background style is not an allowed option.');
  if (has('autoplayInterval')) {
    const n = parseInt(last(input.autoplayInterval), 10);
    if (!Number.isFinite(n) || n < MIN_INTERVAL || n > MAX_INTERVAL) errors.push(`Autoplay interval must be between ${MIN_INTERVAL} and ${MAX_INTERVAL} milliseconds.`);
  }
  if (has('cardsDesktop')) {
    const n = parseInt(last(input.cardsDesktop), 10);
    if (![2, 3].includes(n)) errors.push('Cards visible on desktop must be 2 or 3.');
  }
  if (has('cardsTablet')) {
    const n = parseInt(last(input.cardsTablet), 10);
    if (![1, 2].includes(n)) errors.push('Cards visible on tablet must be 1 or 2.');
  }
  const flat = {};
  for (const k of provided) flat[k] = last(input[k]);
  for (const k of BOOLEAN_KEYS) if (has(k)) flat[k] = parseBool(last(input[k]), false);
  const values = normalizeSettings({ ...flat, enabled: has('enabled') ? flat.enabled : false });
  return { ok: errors.length === 0, errors, values, provided };
}

async function saveHomeReviewSettings(input) {
  const { ok, errors, values, provided } = validateHomeReviewSettings(input);
  if (!ok) {
    const err = new Error(errors.join(' '));
    err.validation = errors;
    throw err;
  }
  const toStore = (field) => {
    const v = values[field];
    return typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  };
  const entries = provided.map((field) => [KEYS[field], toStore(field)]);
  if (entries.length) {
    await prisma.$transaction(
      entries.map(([key, value]) =>
        prisma.siteSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
      )
    );
  }
  return values;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Pure: filter + order + shape testimonial rows for the homepage.
// Only reviews the Admin explicitly featured (featuredOnHome) are ever shown, ordered by
// homeSortOrder. The homepage never auto-includes every genuine review.
function selectHomeReviews(rows, _settings, { includeDemo = false, limit = HOME_REVIEW_LIMIT } = {}) {
  // A review needs something to show: a quote (TEXT), or a playable video (VIDEO / TEXT_VIDEO).
  // A TEXT_VIDEO whose video is unplayable still shows as a plain quote.
  let list = (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!r || !r.isPublished || !r.featuredOnHome) return false;
    const pub = tv.toPublicTestimonial(r);
    // Demo video testimonials are Admin-Preview only - never public, not even in demo-showcase mode.
    if (r.isDemo && pub.hasVideo) return false;
    return pub.hasVideo || (pub.reviewType !== 'VIDEO' && pub.hasQuote);
  });
  if (!includeDemo) list = list.filter((r) => !r.isDemo);
  list.sort((a, b) => num(a.homeSortOrder) - num(b.homeSortOrder) || num(a.sortOrder) - num(b.sortOrder) || num(a.id) - num(b.id));
  return list.slice(0, limit).map((r) => {
    const pub = tv.toPublicTestimonial(r);
    return {
      id: r.id,
      reviewType: pub.reviewType,
      hasVideo: pub.hasVideo,
      videoKind: pub.videoKind,
      embedUrl: pub.embedUrl,
      videoThumbnailUrl: pub.videoThumbnailUrl || '',
      quote: r.quote ? String(r.quote).trim() : '',
      rating: Math.min(5, Math.max(0, Math.round(num(r.rating)))),
      reviewerName: r.reviewerName,
      reviewerDesignation: r.reviewerDesignation || '',
      reviewerLocation: r.reviewerLocation || '',
      avatarUrl: r.avatarUrl || '',
      initials: (r.initials && String(r.initials).trim()) || initialsFrom(r.reviewerName),
      isDemo: Boolean(r.isDemo),
      courseTitle: r.course ? r.course.title : '',
      courseSlug: r.course ? r.course.slug : '',
    };
  });
}

function initialsFrom(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

async function getHomeReviews({ includeDemo = false, settings = null } = {}) {
  const cfg = settings || (await getHomeReviewSettings());
  const where = { isPublished: true, featuredOnHome: true };
  if (!includeDemo) where.isDemo = false;
  const rows = await prisma.courseTestimonial.findMany({
    where,
    include: { course: { select: { title: true, slug: true, status: true } } },
    orderBy: [{ homeSortOrder: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    take: 100,
  });
  // Only link to/credit published courses.
  const visible = rows.filter((r) => r.course && r.course.status === 'PUBLISHED');
  return selectHomeReviews(visible, cfg, { includeDemo });
}

module.exports = {
  isDemoShowcaseEnabled,
  getHomeReviewSettings,
  saveHomeReviewSettings,
  validateHomeReviewSettings,
  normalizeSettings,
  getHomeReviews,
  selectHomeReviews,
  DEFAULTS,
  DIRECTIONS,
  BACKGROUNDS,
  KEYS,
};
