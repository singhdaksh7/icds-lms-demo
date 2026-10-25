const { prisma } = require('../config/db');

// Per-course student player presentation. A course with no saved row uses these
// defaults, so every existing and future course gets a sensible player with no
// setup. Only presentation lives here - progress, anti-seek and playback
// authorization are untouched (see lesson-progress.js / progress service).
const BOOLEAN_FIELDS = [
  'showSidebar',
  'sidebarDefaultOpen',
  'showCourseProgress',
  'showModuleProgress',
  'showLessonDurations',
  'showCompletedMarks',
  'showPrevNext',
  'theaterModeEnabled',
  'showResources',
  'showLessonDescription',
];
const TEXT_FIELDS = { sidebarTitle: 100, theaterButtonLabel: 60 };

const DEFAULTS = Object.freeze({
  showSidebar: true,
  sidebarDefaultOpen: true,
  sidebarTitle: '',
  showCourseProgress: true,
  showModuleProgress: true,
  showLessonDurations: true,
  showCompletedMarks: true,
  showPrevNext: true,
  theaterModeEnabled: true,
  theaterButtonLabel: '',
  showResources: true,
  showLessonDescription: true,
});

class CoursePlayerSettingsError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'CoursePlayerSettingsError';
    this.statusCode = statusCode;
  }
}

// Checked => true, unchecked => false. Admin forms post a hidden "false" before
// the checkbox, so the LAST value wins; a field that was not posted at all is
// left alone (undefined) - editing one setting never flips another.
function parseBool(value) {
  if (value === undefined) return undefined;
  const v = Array.isArray(value) ? value[value.length - 1] : value;
  return v === true || v === 'true' || v === 'on' || v === '1';
}

function cleanText(value, max) {
  if (value === undefined) return undefined;
  const v = String(Array.isArray(value) ? value[value.length - 1] : value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (v.length > max) throw new CoursePlayerSettingsError(`Text must be ${max} characters or fewer.`);
  return v;
}

function mergeWithDefaults(row) {
  const out = { ...DEFAULTS };
  if (!row) return out;
  for (const f of BOOLEAN_FIELDS) if (typeof row[f] === 'boolean') out[f] = row[f];
  for (const f of Object.keys(TEXT_FIELDS)) out[f] = row[f] ? String(row[f]) : '';
  return out;
}

async function requireCourse(courseId) {
  const id = parseInt(courseId, 10);
  if (!Number.isInteger(id) || id <= 0) throw new CoursePlayerSettingsError('Invalid course id.');
  const course = await prisma.course.findUnique({ where: { id }, select: { id: true } });
  if (!course) throw new CoursePlayerSettingsError('Course not found.', 404);
  return id;
}

// Never throws: the player must always render.
async function getPlayerSettings(courseId) {
  try {
    const row = await prisma.coursePlayerSettings.findUnique({ where: { courseId: parseInt(courseId, 10) } });
    return mergeWithDefaults(row);
  } catch (_err) {
    return { ...DEFAULTS };
  }
}

// Patch-style: only fields present in `input` are changed.
async function updatePlayerSettings(courseId, input = {}) {
  const id = await requireCourse(courseId);
  const data = {};
  for (const f of BOOLEAN_FIELDS) {
    const v = parseBool(input[f]);
    if (v !== undefined) data[f] = v;
  }
  for (const [f, max] of Object.entries(TEXT_FIELDS)) {
    const v = cleanText(input[f], max);
    if (v !== undefined) data[f] = v || null;
  }
  const row = await prisma.coursePlayerSettings.upsert({
    where: { courseId: id },
    create: { courseId: id, ...data },
    update: data,
  });
  return mergeWithDefaults(row);
}

async function resetPlayerSettings(courseId) {
  const id = await requireCourse(courseId);
  await prisma.coursePlayerSettings.deleteMany({ where: { courseId: id } });
  return { ...DEFAULTS };
}

module.exports = {
  DEFAULTS,
  BOOLEAN_FIELDS,
  CoursePlayerSettingsError,
  getPlayerSettings,
  updatePlayerSettings,
  resetPlayerSettings,
  mergeWithDefaults,
};
