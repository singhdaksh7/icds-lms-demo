const { prisma } = require('../config/db');
const r2 = require('../lib/r2');
const tv = require('../lib/testimonialVideo');
const { parseVideoEmbed } = require('../lib/video');

// "About the doctor" photo / video. One row (id = 1) edited in Admin > Doctor Photo / Video and shown in
// the homepage "Meet Your Mentor" block, the /founder hero and the /about founder card.
//   mediaMode PHOTO (default): today's rendering, optionally with an uploaded photo override.
//   mediaMode VIDEO: a click-to-play card (uploaded R2 video or a YouTube / Vimeo link) with a poster.
// Saves are PATCH-style (only fields present in the input change) and mirror homeIntroVideo.service.js.
const ROW_ID = 1;
const MODES = ['PHOTO', 'VIDEO'];
const VIDEO_TYPES = ['UPLOAD', 'YOUTUBE', 'VIMEO'];
const CAPTION_MAX = 200;

const DEFAULTS = Object.freeze({
  mediaMode: 'PHOTO',
  photoUrl: '',
  videoType: null,
  videoUrl: '',
  videoObjectKey: null,
  posterUrl: '',
  caption: '',
  autoplayMuted: true, // starts muted when scrolled into view; the visitor can unmute
  loopVideo: false,
});

class DoctorMediaError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'DoctorMediaError';
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
  if (v.length > max) throw new DoctorMediaError(`${label} must be ${max} characters or fewer.`);
  return v;
}

function pickEnum(value, allowed, label) {
  if (value === undefined) return undefined;
  const v = String(last(value) ?? '').trim().toUpperCase();
  if (!allowed.includes(v)) throw new DoctorMediaError(`${label} is not an allowed option.`);
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

// Never throws: the public pages must render without it.
async function getDoctorMedia() {
  try {
    return mergeWithDefaults(await prisma.doctorMedia.findUnique({ where: { id: ROW_ID } }));
  } catch (_err) {
    return { ...DEFAULTS };
  }
}

/**
 * Patch the doctor media row.
 * @param {object} input  form body (only present fields are applied)
 * @param {object} media  { videoObjectKey?, posterUrl?, photoUrl? } just-uploaded files
 * @returns {Promise<{ row, orphanedVideoKey, orphanedPosterUrl, orphanedPhotoUrl }>}
 */
async function saveDoctorMedia(input = {}, media = {}) {
  const current = await prisma.doctorMedia.findUnique({ where: { id: ROW_ID } });
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
    if (!r.ok) throw new DoctorMediaError(r.error);
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
      throw new DoctorMediaError('Upload a video file, or choose YouTube / Vimeo and paste a link.');
    }
  }
  if (media.videoObjectKey) {
    if (!r2.isDoctorObjectKey(media.videoObjectKey)) throw new DoctorMediaError('Invalid hosted video reference.');
    videoType = 'UPLOAD'; videoObjectKey = media.videoObjectKey; videoUrl = null;
  }
  data.videoType = videoType;
  data.videoUrl = videoUrl;
  data.videoObjectKey = videoObjectKey;

  // ---- poster ---------------------------------------------------------------
  let posterUrl = cur.posterUrl || null;
  if (input.posterUrl !== undefined) {
    const t = tv.normalizeThumbnailUrl(last(input.posterUrl));
    if (!t.ok) throw new DoctorMediaError(t.error.replace('Thumbnail', 'Poster'));
    if (t.value || String(last(input.posterUrl)).trim() === '') posterUrl = t.value;
  }
  if (parseBool(input.removePoster) === true) posterUrl = null;
  if (media.posterUrl) posterUrl = media.posterUrl;
  data.posterUrl = posterUrl;

  // ---- photo override (blank = the doctor's own photo, i.e. today's behaviour) ---
  let photoUrl = cur.photoUrl || null;
  if (input.photoUrl !== undefined) {
    const t = tv.normalizeThumbnailUrl(last(input.photoUrl));
    if (!t.ok) throw new DoctorMediaError(t.error.replace('Thumbnail', 'Photo'));
    if (t.value || String(last(input.photoUrl)).trim() === '') photoUrl = t.value;
  }
  if (parseBool(input.removePhoto) === true) photoUrl = null;
  if (media.photoUrl) photoUrl = media.photoUrl;
  data.photoUrl = photoUrl;

  const row = await prisma.doctorMedia.upsert({
    where: { id: ROW_ID },
    create: { id: ROW_ID, ...data },
    update: data,
  });
  return {
    row: mergeWithDefaults(row),
    orphanedVideoKey: cur.videoObjectKey && cur.videoObjectKey !== videoObjectKey ? cur.videoObjectKey : null,
    orphanedPosterUrl: cur.posterUrl && cur.posterUrl !== posterUrl ? cur.posterUrl : null,
    orphanedPhotoUrl: cur.photoUrl && cur.photoUrl !== photoUrl ? cur.photoUrl : null,
  };
}

// Public-safe view-model, or null when the pages must keep their existing photo markup untouched
// (no row / PHOTO mode without a photo override). Never contains the R2 object key or the raw stored URL.
function toPublicDoctorMedia(row, fallbackPhotoUrl = '', fallbackAlt = '') {
  if (!row) return null;
  const v = mergeWithDefaults(row);
  const hosted = Boolean(v.videoObjectKey) && r2.isDoctorObjectKey(v.videoObjectKey);
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

async function getPublicDoctorMedia(fallbackPhotoUrl = '', fallbackAlt = '') {
  try {
    const row = await prisma.doctorMedia.findUnique({ where: { id: ROW_ID } });
    return toPublicDoctorMedia(row, fallbackPhotoUrl, fallbackAlt);
  } catch (_err) {
    return null;
  }
}

// Best-effort removal of an R2 object that is no longer referenced.
async function deleteHostedVideo(key) {
  if (!r2.isDoctorObjectKey(key)) return false;
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
  ROW_ID,
  MODES,
  VIDEO_TYPES,
  CAPTION_MAX,
  DEFAULTS,
  DoctorMediaError,
  getDoctorMedia,
  saveDoctorMedia,
  toPublicDoctorMedia,
  getPublicDoctorMedia,
  deleteHostedVideo,
};
