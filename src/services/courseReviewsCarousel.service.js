const { prisma } = require('../config/db');
const opts = require('../lib/carouselOptions');

// Per-course presentation of the landing-page reviews carousel (mode / speed / direction).
// Stored as SiteSetting rows keyed by course id so each course can differ and saving
// never touches any other course or setting. Missing rows use sensible defaults, so
// every existing course keeps today's behaviour (SLIDE) until an admin changes it.
const DEFAULTS = Object.freeze({ mode: 'SLIDE', speed: 'SLOW', direction: 'RIGHT_TO_LEFT' });
const key = (courseId, field) => `courseReviews.${courseId}.${field}`;

class CourseReviewsCarouselError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'CourseReviewsCarouselError';
    this.statusCode = statusCode;
  }
}

function shape(raw = {}) {
  const mode = opts.MODES.includes(raw.mode) ? raw.mode : DEFAULTS.mode;
  const speed = opts.SPEEDS.includes(raw.speed) ? raw.speed : DEFAULTS.speed;
  const direction = opts.DIRECTIONS.includes(raw.direction) ? raw.direction : DEFAULTS.direction;
  return { mode, speed, direction, seconds: opts.SPEED_SECONDS[speed], dir: direction === 'RIGHT_TO_LEFT' ? 'rtl' : 'ltr' };
}

// Never throws: the landing page must always render.
async function getCourseReviewsCarousel(courseId) {
  const id = parseInt(courseId, 10);
  if (!Number.isInteger(id) || id <= 0) return shape();
  try {
    const rows = await prisma.siteSetting.findMany({ where: { key: { in: ['mode', 'speed', 'direction'].map((f) => key(id, f)) } } });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return shape({ mode: map[key(id, 'mode')], speed: map[key(id, 'speed')], direction: map[key(id, 'direction')] });
  } catch (_err) {
    return shape();
  }
}

const last = (v) => (Array.isArray(v) ? v[v.length - 1] : v);

// Patch-style: only submitted fields are validated and written.
async function saveCourseReviewsCarousel(courseId, input = {}) {
  const id = parseInt(courseId, 10);
  if (!Number.isInteger(id) || id <= 0) throw new CourseReviewsCarouselError('Invalid course id.');
  const course = await prisma.course.findUnique({ where: { id }, select: { id: true } });
  if (!course) throw new CourseReviewsCarouselError('Course not found.', 404);
  const writes = [];
  const check = (field, allowed, label) => {
    if (input[field] === undefined) return;
    const v = String(last(input[field]));
    if (!allowed.includes(v)) throw new CourseReviewsCarouselError(`${label} is not an allowed option.`);
    writes.push([key(id, field), v]);
  };
  check('mode', opts.MODES, 'Carousel mode');
  check('speed', opts.SPEEDS, 'Speed');
  check('direction', opts.DIRECTIONS, 'Direction');
  if (writes.length) {
    await prisma.$transaction(writes.map(([k, value]) => prisma.siteSetting.upsert({ where: { key: k }, update: { value }, create: { key: k, value } })));
  }
  return getCourseReviewsCarousel(id);
}

module.exports = { DEFAULTS, CourseReviewsCarouselError, getCourseReviewsCarousel, saveCourseReviewsCarousel, shape };
