const { prisma } = require('../config/db');
const theme = require('../lib/courseAppearance');

class CourseAppearanceError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'CourseAppearanceError';
    this.statusCode = statusCode;
  }
}

// Every persisted column the theme module knows about.
const STORED_FIELDS = ['themePreset', ...theme.ALL_FIELDS];
// Below 2:1 text is genuinely unreadable, so the save is refused.
const UNUSABLE_CONTRAST_ERROR =
  'Some text/background colours are practically unreadable (contrast below 2:1). Pick colours with more contrast.';

function pickStored(values) {
  const out = {};
  STORED_FIELDS.forEach((f) => {
    out[f] = values[f];
  });
  return out;
}

async function requireCourse(courseId) {
  const id = parseInt(courseId, 10);
  if (!Number.isInteger(id) || id <= 0) throw new CourseAppearanceError('Invalid course id.', 400);
  const course = await prisma.course.findUnique({ where: { id }, select: { id: true } });
  if (!course) throw new CourseAppearanceError('Course not found.', 404);
  return id;
}

/** Plain data for a brand-new course (Clinical White). */
function defaultAppearanceData() {
  return pickStored(theme.presetValues(theme.DEFAULT_PRESET));
}

/** The stored row, or null when the course has none. Validates the course. */
async function getCourseAppearance(courseId) {
  const id = await requireCourse(courseId);
  return prisma.courseLandingAppearance.findUnique({ where: { courseId: id } });
}

/**
 * Appearance used for RENDERING. Never throws and never needs a row: a course
 * without one (or with a corrupt value) renders the FMR Navy fallback, i.e.
 * exactly what every course looked like before per-course themes existed.
 */
async function resolveCourseAppearance(courseId) {
  let row = null;
  try {
    row = await prisma.courseLandingAppearance.findUnique({ where: { courseId: parseInt(courseId, 10) } });
  } catch (err) {
    row = null;
  }
  const fallback = theme.presetValues(theme.FALLBACK_PRESET);
  if (!row) return { appearance: fallback, isFallback: true };
  const { values } = theme.validateAppearance(row, fallback);
  return { appearance: values, isFallback: false };
}

/** Everything the public/preview view needs: values, css style attr, font link. */
async function getRenderTheme(courseId) {
  const { appearance, isFallback } = await resolveCourseAppearance(courseId);
  return {
    appearance,
    isFallback,
    styleAttr: theme.toStyleAttr(theme.buildCssVars(appearance)),
    fontsUrl: theme.googleFontsUrl(appearance),
  };
}

async function writeAppearance(id, values) {
  const data = pickStored(values);
  return prisma.courseLandingAppearance.upsert({
    where: { courseId: id },
    create: { courseId: id, ...data },
    update: data,
  });
}

/** Create the row if the course has none (idempotent, never overwrites). */
async function ensureDefaultAppearance(courseId, presetName = theme.DEFAULT_PRESET) {
  const id = await requireCourse(courseId);
  const existing = await prisma.courseLandingAppearance.findUnique({ where: { courseId: id } });
  if (existing) return { appearance: existing, created: false };
  if (!theme.isPresetKey(presetName)) throw new CourseAppearanceError('Unknown theme preset.', 400);
  try {
    const appearance = await prisma.courseLandingAppearance.create({
      data: { courseId: id, ...pickStored(theme.presetValues(presetName)) },
    });
    return { appearance, created: true };
  } catch (err) {
    // Lost a race with a concurrent create: the unique row now exists.
    if (err && err.code === 'P2002') {
      return { appearance: await prisma.courseLandingAppearance.findUnique({ where: { courseId: id } }), created: false };
    }
    throw err;
  }
}

/** Save form input. Any edit that deviates from the claimed preset => "custom". */
async function updateCourseAppearance(courseId, input) {
  const id = await requireCourse(courseId);
  const current = await prisma.courseLandingAppearance.findUnique({ where: { courseId: id } });
  const base = current
    ? theme.validateAppearance(current, theme.presetValues(theme.FALLBACK_PRESET)).values
    : theme.presetValues(theme.DEFAULT_PRESET);
  const { values, errors } = theme.validateAppearance(input, base);
  if (errors.length) throw new CourseAppearanceError(errors.join(' '), 400);

  if (theme.checkContrast(values).some((c) => c.level === 'unusable')) {
    throw new CourseAppearanceError(UNUSABLE_CONTRAST_ERROR, 400);
  }

  if (values.themePreset !== theme.CUSTOM_PRESET) {
    const p = theme.presetValues(values.themePreset);
    if (!p || theme.ALL_FIELDS.some((f) => p[f] !== values[f])) values.themePreset = theme.CUSTOM_PRESET;
  }
  return writeAppearance(id, values);
}

async function applyPreset(courseId, presetName) {
  const id = await requireCourse(courseId);
  if (typeof presetName !== 'string' || !theme.isPresetKey(presetName)) {
    throw new CourseAppearanceError('Unknown theme preset.', 400);
  }
  return writeAppearance(id, theme.presetValues(presetName));
}

/** Re-apply the preset the course is currently based on (undo manual tweaks). */
async function resetToPreset(courseId) {
  const id = await requireCourse(courseId);
  const current = await prisma.courseLandingAppearance.findUnique({ where: { courseId: id } });
  const name = current && current.themePreset;
  if (!theme.isPresetKey(name)) {
    throw new CourseAppearanceError('This course uses a custom theme with no preset to reset to. Pick a preset instead.', 400);
  }
  return writeAppearance(id, theme.presetValues(name));
}

/** Reset to the platform default theme (Clinical White). */
async function resetAppearance(courseId) {
  const id = await requireCourse(courseId);
  return writeAppearance(id, theme.presetValues(theme.DEFAULT_PRESET));
}

/** Copy ONLY the appearance values from another course. */
async function copyAppearance(sourceCourseId, targetCourseId) {
  const sourceId = await requireCourse(sourceCourseId);
  const targetId = await requireCourse(targetCourseId);
  if (sourceId === targetId) throw new CourseAppearanceError('Pick a different course to copy from.', 400);
  const source = await prisma.courseLandingAppearance.findUnique({ where: { courseId: sourceId } });
  const fallback = theme.presetValues(theme.FALLBACK_PRESET);
  // A source without a row renders as the fallback theme, so copy exactly that.
  const values = source ? theme.validateAppearance(source, fallback).values : fallback;
  return writeAppearance(targetId, values);
}

/** Courses (id/title only) an admin may copy a theme from. */
async function listCopySources(excludeCourseId) {
  return prisma.course.findMany({
    where: { id: { not: parseInt(excludeCourseId, 10) } },
    select: { id: true, title: true },
    orderBy: { title: 'asc' },
  });
}

/** Data for the admin Appearance tab. */
async function getAdminView(courseId) {
  const id = await requireCourse(courseId);
  const [row, copySources] = await Promise.all([
    prisma.courseLandingAppearance.findUnique({ where: { courseId: id } }),
    listCopySources(id),
  ]);
  const fallback = theme.presetValues(theme.FALLBACK_PRESET);
  const appearance = row ? theme.validateAppearance(row, fallback).values : fallback;
  // A course with no row renders FMR Navy, so show it as such (not "custom").
  return { appearance, hasRow: Boolean(row), copySources, theme };
}

module.exports = {
  CourseAppearanceError,
  getAdminView,
  defaultAppearanceData,
  getCourseAppearance,
  resolveCourseAppearance,
  getRenderTheme,
  ensureDefaultAppearance,
  updateCourseAppearance,
  applyPreset,
  resetToPreset,
  resetAppearance,
  copyAppearance,
  listCopySources,
};
