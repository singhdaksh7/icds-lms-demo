const { prisma } = require('../config/db');
const r2 = require('../lib/r2');
const tv = require('../lib/testimonialVideo');
const { parseVideoEmbed } = require('../lib/video');

// Per-course photo / video for the Mentor section of a course landing page (Admin: Courses -> Edit -> Landing
// Page -> Mentor Display). One optional row per course; no row (or mediaMode DEFAULT) = today's rendering.
//   DEFAULT: the instructor's own photo, exactly as before.
//   PHOTO:   an uploaded photo override.
//   VIDEO:   a card with poster + play button (muted autoplay by default, never with sound): an uploaded R2 video
//            or a YouTube / Vimeo link. Saves are PATCH-style and mirror doctorMedia.service.js.
const MODES = ['DEFAULT', 'PHOTO', 'VIDEO'];
const VIDEO_TYPES = ['UPLOAD', 'YOUTUBE', 'VIMEO'];
const CAPTION_MAX = 200;

const DEFAULTS = Object.freeze({
  mediaMode: 'DEFAULT',
  photoUrl: '',
  videoType: null,
  videoUrl: '',
  videoObjectKey: null,
  posterUrl: '',
  caption: '',
  autoplayMuted: true,
  loopVideo: false,
});

class CourseMentorMediaError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'CourseMentorMediaError';
    this.status = status;
  }
}

const last = (v) => (Array.isArray(v) ? v[v.length - 1] : v);

function parseBool(value) {
  if (value === undefined) return undefined;
  const v = last(value);
  return v === true || v === 'true' || v === 'on' || v === '1';
}

function cleanText(value, max, label) {
  if (value === undefined) return undefined;
  const v = String(last(value) ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim();
  if (v.length > max) throw new CourseMentorMediaError(`${label} must be ${max} characters or fewer.`);
  return v;
}

function pickEnum(value, allowed, label) {
  if (value === undefined) return undefined;
  const v = String(last(value) ?? '').trim().toUpperCase();
  if (!allowed.includes(v)) throw new CourseMentorMediaError(`${label} is not an allowed option.`);
  return v;
}

function mergeWithDefaults(row) {
  const out = { ...DEFAULTS };
  if (!row) return out;
  for (const k of Object.keys(DEFAULTS)) {
    if (row[k] === undefined || row[k] === null) continue;
    out[k] = row[k];
  }
  return out;
}

async function requireCourse(courseId) {
  const id = parseInt(courseId, 10);
  if (!Number.isInteger(id) || id <= 0) throw new CourseMentorMediaError('Invalid course id.');
  const course = await prisma.course.findUnique({ where: { id }, select: { id: true } });
  if (!course) throw new CourseMentorMediaError('Course not found.', 404);
  return id;
}

// Never throws: the course page must render without it.
async function getCourseMentorMedia(courseId) {
  try {
    const row = await prisma.courseMentorMedia.findUnique({ where: { courseId: parseInt(courseId, 10) } });
    return mergeWithDefaults(row);
  } catch (_err) {
    return { ...DEFAULTS };
  }
}

/**
 * Patch the mentor media of ONE course (ownership/existence enforced).
 * @param {number|string} courseId
 * @param {object} input  form body (only present fields are applied)
 * @param {object} media  { videoObjectKey?, posterUrl?, photoUrl? } just-uploaded files
 */
async function saveCourseMentorMedia(courseId, input = {}, media = {}) {
  const id = await requireCourse(courseId);
  const current = await prisma.courseMentorMedia.findUnique({ where: { courseId: id } });
  const cur = mergeWithDefaults(current);
  const data = {};

  const mode = pickEnum(input.mediaMode, MODES, 'Display mode');
  if (mode !== undefined) data.mediaMode = mode;
  const caption = cleanText(input.caption, CAPTION_MAX, 'Caption');
  if (caption !== undefined) data.caption = caption || null;
  const autoplayMuted = parseBool(input.autoplayMuted);
  if (autoplayMuted !== undefined) data.autoplayMuted = autoplayMuted;
  const loopVideo = parseBool(input.loopVideo);
  if (loopVideo !== undefined) data.loopVideo = loopVideo;

  // ---- video source ---------------------------------------------------------
  let videoType = cur.videoType;
  let videoUrl = cur.videoUrl || null;
  let videoObjectKey = cur.videoObjectKey || null;
  const wantsRemove = parseBool(input.removeVideo) === true;
  if (wantsRemove) { videoType = null; videoUrl = null; videoObjectKey = null; }
  // "Remove" wins over the link box (the form always re-posts the current link in it).
  if (!wantsRemove && input.videoUrl !== undefined) {
    const r = tv.normalizeExternalVideoUrl(last(input.videoUrl));
    if (!r.ok) throw new CourseMentorMediaError(r.error);
    if (r.value) {
      const embed = parseVideoEmbed(r.value);
      videoType = embed.provider === 'vimeo' ? 'VIMEO' : 'YOUTUBE';
      videoUrl = r.value;
      videoObjectKey = null;
    } else if (videoType === 'YOUTUBE' || videoType === 'VIMEO') {
      videoType = null; videoUrl = null; // clearing the box removes a link-based video, never an uploaded one
    }
  }
  if (input.videoType !== undefined && !media.videoObjectKey) {
    const requested = pickEnum(input.videoType, VIDEO_TYPES, 'Video type');
    if (requested === 'UPLOAD' && !videoObjectKey) {
      throw new CourseMentorMediaError('Upload a video file, or choose YouTube / Vimeo and paste a link.');
    }
  }
  if (media.videoObjectKey) {
    // A hosted video must be a mentor key of THIS course (never a lesson / testimonial / other course's key).
    if (!r2.isMentorObjectKey(media.videoObjectKey, id)) throw new CourseMentorMediaError('Invalid hosted video reference.');
    videoType = 'UPLOAD'; videoObjectKey = media.videoObjectKey; videoUrl = null;
  }
  data.videoType = videoType;
  data.videoUrl = videoUrl;
  data.videoObjectKey = videoObjectKey;

  // ---- poster ---------------------------------------------------------------
  let posterUrl = cur.posterUrl || null;
  if (input.posterUrl !== undefined) {
    const t = tv.normalizeThumbnailUrl(last(input.posterUrl));
    if (!t.ok) throw new CourseMentorMediaError(t.error.replace('Thumbnail', 'Poster'));
    if (t.value || String(last(input.posterUrl)).trim() === '') posterUrl = t.value;
  }
  if (parseBool(input.removePoster) === true) posterUrl = null;
  if (media.posterUrl) posterUrl = media.posterUrl;
  data.posterUrl = posterUrl;

  // ---- photo override (used when mediaMode is PHOTO) ---------------------------
  let photoUrl = cur.photoUrl || null;
  if (input.photoUrl !== undefined) {
    const t = tv.normalizeThumbnailUrl(last(input.photoUrl));
    if (!t.ok) throw new CourseMentorMediaError(t.error.replace('Thumbnail', 'Photo'));
    if (t.value || String(last(input.photoUrl)).trim() === '') photoUrl = t.value;
  }
  if (parseBool(input.removePhoto) === true) photoUrl = null;
  if (media.photoUrl) photoUrl = media.photoUrl;
  data.photoUrl = photoUrl;

  const row = await prisma.courseMentorMedia.upsert({
    where: { courseId: id },
    create: { courseId: id, ...data },
    update: data,
  });
  return {
    row: mergeWithDefaults(row),
    orphanedVideoKey: cur.videoObjectKey && cur.videoObjectKey !== videoObjectKey ? cur.videoObjectKey : null,
    orphanedPosterUrl: cur.posterUrl && cur.posterUrl !== posterUrl ? cur.posterUrl : null,
    orphanedPhotoUrl: cur.photoUrl && cur.photoUrl !== photoUrl ? cur.photoUrl : null,
  };
}

/** Back to the default look: deletes the course's mentor media row. Returns the now-unreferenced files. */
async function resetCourseMentorMedia(courseId) {
  const id = await requireCourse(courseId);
  const current = await prisma.courseMentorMedia.findUnique({ where: { courseId: id } });
  if (current) await prisma.courseMentorMedia.delete({ where: { courseId: id } });
  return {
    orphanedVideoKey: current && current.videoObjectKey ? current.videoObjectKey : null,
    orphanedPosterUrl: current && current.posterUrl ? current.posterUrl : null,
    orphanedPhotoUrl: current && current.photoUrl ? current.photoUrl : null,
  };
}

// Public-safe view-model, or null when the page must keep today's mentor photo markup untouched
// (no row / DEFAULT mode / nothing usable). Never contains the R2 object key or the raw stored URL.
function toPublicCourseMentorMedia(row, courseId, fallbackPhotoUrl = '', fallbackAlt = '') {
  if (!row) return null;
  const v = mergeWithDefaults(row);
  if (v.mediaMode === 'DEFAULT') return null;
  const hosted = Boolean(v.videoObjectKey) && r2.isMentorObjectKey(v.videoObjectKey, courseId);
  const embed = !hosted && v.videoUrl ? parseVideoEmbed(v.videoUrl) : null;
  const playable = hosted || Boolean(embed);
  const mode = v.mediaMode === 'VIDEO' && playable ? 'VIDEO' : 'PHOTO';
  if (mode === 'PHOTO' && !v.photoUrl) return null;
  return {
    mode,
    photoUrl: v.photoUrl || '',
    caption: String(v.caption || '').trim(),
    fallbackPhotoUrl: fallbackPhotoUrl || '',
    fallbackAlt: fallbackAlt || '',
    sourceUrl: `/api/courses/${parseInt(courseId, 10)}/mentor-video/source`,
    video: mode === 'VIDEO'
      ? {
          kind: hosted ? 'hosted' : 'embed',
          embedUrl: embed ? embed.embedUrl : null,
          provider: embed ? embed.provider : null,
          posterUrl: v.posterUrl || '',
          autoplayMuted: v.autoplayMuted !== false,
          loop: v.loopVideo === true,
        }
      : null,
  };
}

async function getPublicCourseMentorMedia(courseId, fallbackPhotoUrl = '', fallbackAlt = '') {
  try {
    const id = parseInt(courseId, 10);
    const row = await prisma.courseMentorMedia.findUnique({ where: { courseId: id } });
    return toPublicCourseMentorMedia(row, id, fallbackPhotoUrl, fallbackAlt);
  } catch (_err) {
    return null;
  }
}

// Best-effort removal of an R2 object that is no longer referenced (only mentor keys, only of that course).
async function deleteHostedVideo(key, courseId) {
  if (!r2.isMentorObjectKey(key, courseId)) return false;
  try {
    const cfg = await require('./videoStorageSettings.service').getR2ConfigOrNull();
    if (!cfg) return false;
    await r2.deleteObject(cfg, key);
    return true;
  } catch (_err) {
    return false;
  }
}

module.exports = {
  MODES,
  VIDEO_TYPES,
  CAPTION_MAX,
  DEFAULTS,
  CourseMentorMediaError,
  getCourseMentorMedia,
  saveCourseMentorMedia,
  resetCourseMentorMedia,
  toPublicCourseMentorMedia,
  getPublicCourseMentorMedia,
  deleteHostedVideo,
};
