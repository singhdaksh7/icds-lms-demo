const { prisma } = require('../config/db');
const tv = require('../lib/testimonialVideo');

const KEYS = {
  enabled: 'homeReviews.enabled',
  heading: 'homeReviews.heading',
  subheading: 'homeReviews.subheading',
  sourceMode: 'homeReviews.sourceMode',
};
const SOURCE_MODES = ['FEATURED', 'ALL_APPROVED'];
const DEFAULTS = {
  enabled: true,
  heading: 'What our learners say',
  subheading: '',
  sourceMode: 'ALL_APPROVED',
};
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

function normalizeSettings(raw = {}) {
  const heading = typeof raw.heading === 'string' ? raw.heading.trim() : '';
  const subheading = typeof raw.subheading === 'string' ? raw.subheading.trim() : '';
  return {
    enabled: parseBool(raw.enabled, DEFAULTS.enabled),
    heading: heading || DEFAULTS.heading,
    subheading,
    sourceMode: SOURCE_MODES.includes(raw.sourceMode) ? raw.sourceMode : DEFAULTS.sourceMode,
  };
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
  return normalizeSettings({
    enabled: map[KEYS.enabled],
    heading: map[KEYS.heading],
    subheading: map[KEYS.subheading],
    sourceMode: map[KEYS.sourceMode],
  });
}

// Validates admin input. Returns { ok, errors, values }.
function validateHomeReviewSettings(input = {}) {
  const errors = [];
  const heading = String(input.heading ?? '').trim();
  const subheading = String(input.subheading ?? '').trim();
  const sourceMode = String(input.sourceMode ?? DEFAULTS.sourceMode).trim();
  if (heading.length > MAX_HEADING) errors.push(`Heading must be ${MAX_HEADING} characters or fewer.`);
  if (subheading.length > MAX_SUBHEADING) errors.push(`Subheading must be ${MAX_SUBHEADING} characters or fewer.`);
  if (!SOURCE_MODES.includes(sourceMode)) errors.push('Source mode must be FEATURED or ALL_APPROVED.');
  const enabled = Array.isArray(input.enabled)
    ? input.enabled.some((v) => parseBool(v, false))
    : parseBool(input.enabled, false);
  return {
    ok: errors.length === 0,
    errors,
    values: { enabled, heading: heading || DEFAULTS.heading, subheading, sourceMode },
  };
}

async function saveHomeReviewSettings(input) {
  const { ok, errors, values } = validateHomeReviewSettings(input);
  if (!ok) {
    const err = new Error(errors.join(' '));
    err.validation = errors;
    throw err;
  }
  const entries = [
    [KEYS.enabled, values.enabled ? 'true' : 'false'],
    [KEYS.heading, values.heading],
    [KEYS.subheading, values.subheading],
    [KEYS.sourceMode, values.sourceMode],
  ];
  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.siteSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
    )
  );
  return values;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Pure: filter + order + shape testimonial rows for the homepage.
function selectHomeReviews(rows, settings, { includeDemo = false, limit = HOME_REVIEW_LIMIT } = {}) {
  const mode = settings && SOURCE_MODES.includes(settings.sourceMode) ? settings.sourceMode : DEFAULTS.sourceMode;
  // A review needs something to show: a quote (TEXT), or a playable video (VIDEO / TEXT_VIDEO).
  // A TEXT_VIDEO whose video is unplayable still shows as a plain quote.
  let list = (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!r || !r.isPublished) return false;
    const pub = tv.toPublicTestimonial(r);
    return pub.hasVideo || (pub.reviewType !== 'VIDEO' && pub.hasQuote);
  });
  if (!includeDemo) list = list.filter((r) => !r.isDemo);
  if (mode === 'FEATURED') {
    list = list.filter((r) => r.featuredOnHome);
    list.sort((a, b) => num(a.homeSortOrder) - num(b.homeSortOrder) || num(a.sortOrder) - num(b.sortOrder) || num(a.id) - num(b.id));
  } else {
    list.sort((a, b) => num(a.sortOrder) - num(b.sortOrder) || num(b.id) - num(a.id));
  }
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
  const where = { isPublished: true };
  if (!includeDemo) where.isDemo = false;
  if (cfg.sourceMode === 'FEATURED') where.featuredOnHome = true;
  const rows = await prisma.courseTestimonial.findMany({
    where,
    include: { course: { select: { title: true, slug: true, status: true } } },
    orderBy: [{ homeSortOrder: 'asc' }, { sortOrder: 'asc' }, { id: 'desc' }],
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
  getHomeReviews,
  selectHomeReviews,
  DEFAULTS,
};
