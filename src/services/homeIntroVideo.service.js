const { prisma } = require('../config/db');
const r2 = require('../lib/r2');
const tv = require('../lib/testimonialVideo');
const { parseVideoEmbed } = require('../lib/video');

// Homepage intro / promo video block. One row (id = 1); every value the public
// block shows is stored here and edited in Admin > Homepage > Intro Video.
// Saves are PATCH-style: only fields present in the input are changed, so saving
// this block can never wipe other homepage settings (they live elsewhere) and a
// field missing from a request is never silently reset.
const ROW_ID = 1;
const LAYOUTS = ['VIDEO_RIGHT', 'VIDEO_LEFT', 'CENTERED'];
const SHAPES = ['VERTICAL', 'LANDSCAPE', 'SQUARE'];
const BACKGROUNDS = ['CREAM', 'LIGHT', 'DARK'];
const VIDEO_TYPES = ['UPLOAD', 'YOUTUBE', 'VIMEO'];
const LABELS = {
  layout: { VIDEO_RIGHT: 'Video on the right', VIDEO_LEFT: 'Video on the left', CENTERED: 'Centered' },
  shape: { VERTICAL: 'Vertical reel (9:16)', LANDSCAPE: 'Landscape (16:9)', SQUARE: 'Square (1:1)' },
  background: { CREAM: 'Warm cream', LIGHT: 'White', DARK: 'Dark' },
};

const TEXT_LIMITS = {
  eyebrow: 120,
  heading: 200,
  highlightText: 120,
  description: 2000,
  ctaLabel: 100,
  secondaryCtaLabel: 100,
};
const BOOLEAN_FIELDS = ['isEnabled', 'ctaEnabled', 'autoplayMuted', 'loopVideo'];

const DEFAULTS = Object.freeze({
  isEnabled: false,
  eyebrow: '',
  heading: '',
  highlightText: '',
  description: '',
  videoType: null,
  videoUrl: '',
  videoObjectKey: null,
  posterUrl: '',
  ctaEnabled: true,
  ctaLabel: '',
  ctaUrl: '',
  secondaryCtaLabel: '',
  secondaryCtaUrl: '',
  layout: 'VIDEO_RIGHT',
  videoShape: 'VERTICAL',
  backgroundStyle: 'CREAM',
  autoplayMuted: false,
  loopVideo: false,
});

class HomeIntroVideoError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'HomeIntroVideoError';
    this.status = status;
  }
}

const last = (v) => (Array.isArray(v) ? v[v.length - 1] : v);

// Checked => true, unchecked => false (admin forms post a hidden "false" first).
// A field that was not posted at all stays undefined (= leave unchanged).
function parseBool(value) {
  if (value === undefined) return undefined;
  const v = last(value);
  return v === true || v === 'true' || v === 'on' || v === '1';
}

function cleanText(value, max, label) {
  if (value === undefined) return undefined;
  const v = String(last(value) ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim();
  if (v.length > max) throw new HomeIntroVideoError(`${label} must be ${max} characters or fewer.`);
  return v;
}

// Safe link targets only: an internal path ("/courses", "/#faq") or an https URL.
// Never javascript:, data:, protocol-relative "//host" or backslash tricks.
function normalizeLinkUrl(raw, label) {
  if (raw === undefined) return undefined;
  const v = String(last(raw) ?? '').trim();
  if (!v) return null;
  if (v.length > 300) throw new HomeIntroVideoError(`${label} is too long.`);
  if (/[\u0000-\u001f\u007f\s"'<>\\]/.test(v)) throw new HomeIntroVideoError(`${label} contains invalid characters.`);
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  if (/^https:\/\/[^/]+/i.test(v)) {
    try {
      const u = new URL(v);
      if (u.protocol === 'https:' && u.hostname) return v;
    } catch (_err) { /* fall through */ }
  }
  throw new HomeIntroVideoError(`${label} must be a site path starting with "/" or an https link.`);
}

function pickEnum(value, allowed, label) {
  if (value === undefined) return undefined;
  const v = String(last(value) ?? '').trim().toUpperCase();
  if (!allowed.includes(v)) throw new HomeIntroVideoError(`${label} is not an allowed option.`);
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

// Never throws: the homepage must render without it.
async function getIntroVideo() {
  try {
    const row = await prisma.homeIntroVideo.findUnique({ where: { id: ROW_ID } });
    return mergeWithDefaults(row);
  } catch (_err) {
    return { ...DEFAULTS };
  }
}

/**
 * Patch the intro video block.
 * @param {object} input  form body (only present fields are applied)
 * @param {object} media  { videoObjectKey?: string (just uploaded to R2), posterUrl?: string (just uploaded image) }
 * @returns {Promise<{ row, orphanedVideoKey, orphanedPosterUrl }>}
 */
async function saveIntroVideo(input = {}, media = {}) {
  const current = await prisma.homeIntroVideo.findUnique({ where: { id: ROW_ID } });
  const cur = mergeWithDefaults(current);
  const data = {};

  for (const f of BOOLEAN_FIELDS) {
    const v = parseBool(input[f]);
    if (v !== undefined) data[f] = v;
  }
  for (const [f, max] of Object.entries(TEXT_LIMITS)) {
    const v = cleanText(input[f], max, f.replace(/([A-Z])/g, ' $1').toLowerCase());
    if (v !== undefined) data[f] = v || null;
  }
  const ctaUrl = normalizeLinkUrl(input.ctaUrl, 'Button link');
  if (ctaUrl !== undefined) data.ctaUrl = ctaUrl;
  const secondaryCtaUrl = normalizeLinkUrl(input.secondaryCtaUrl, 'Secondary button link');
  if (secondaryCtaUrl !== undefined) data.secondaryCtaUrl = secondaryCtaUrl;

  const layout = pickEnum(input.layout, LAYOUTS, 'Layout');
  if (layout !== undefined) data.layout = layout;
  const videoShape = pickEnum(input.videoShape, SHAPES, 'Video shape');
  if (videoShape !== undefined) data.videoShape = videoShape;
  const backgroundStyle = pickEnum(input.backgroundStyle, BACKGROUNDS, 'Background style');
  if (backgroundStyle !== undefined) data.backgroundStyle = backgroundStyle;

  // ---- video source -------------------------------------------------------
  let videoType = cur.videoType;
  let videoUrl = cur.videoUrl || null;
  let videoObjectKey = cur.videoObjectKey || null;
  const wantsRemove = parseBool(input.removeVideo) === true;

  if (wantsRemove) {
    videoType = null; videoUrl = null; videoObjectKey = null;
  }
  // "Remove" wins over the link box (the form always re-posts the current link in it).
  if (!wantsRemove && input.videoUrl !== undefined) {
    const r = tv.normalizeExternalVideoUrl(last(input.videoUrl));
    if (!r.ok) throw new HomeIntroVideoError(r.error);
    if (r.value) {
      const embed = parseVideoEmbed(r.value);
      videoType = embed.provider === 'vimeo' ? 'VIMEO' : 'YOUTUBE';
      videoUrl = r.value;
      videoObjectKey = null;
    } else if (videoType === 'YOUTUBE' || videoType === 'VIMEO') {
      // Clearing the link field clears a link-based video; an uploaded video is never cleared by an empty link box.
      videoType = null; videoUrl = null;
    }
  }
  if (input.videoType !== undefined && !media.videoObjectKey) {
    const requested = pickEnum(input.videoType, VIDEO_TYPES, 'Video type');
    if (requested === 'UPLOAD' && !videoObjectKey) {
      throw new HomeIntroVideoError('Upload a video file, or choose YouTube / Vimeo and paste a link.');
    }
  }
  if (media.videoObjectKey) {
    if (!r2.isPromoObjectKey(media.videoObjectKey)) throw new HomeIntroVideoError('Invalid hosted video reference.');
    videoType = 'UPLOAD'; videoObjectKey = media.videoObjectKey; videoUrl = null;
  }
  data.videoType = videoType;
  data.videoUrl = videoUrl;
  data.videoObjectKey = videoObjectKey;

  // ---- poster -------------------------------------------------------------
  let posterUrl = cur.posterUrl || null;
  if (input.posterUrl !== undefined) {
    const t = tv.normalizeThumbnailUrl(last(input.posterUrl));
    if (!t.ok) throw new HomeIntroVideoError(t.error.replace('Thumbnail', 'Poster'));
    if (t.value || String(last(input.posterUrl)).trim() === '') posterUrl = t.value;
  }
  if (parseBool(input.removePoster) === true) posterUrl = null;
  if (media.posterUrl) posterUrl = media.posterUrl;
  data.posterUrl = posterUrl;

  // Enabling a block with nothing to play is allowed (it just renders nothing) - the admin page warns.
  const row = await prisma.homeIntroVideo.upsert({
    where: { id: ROW_ID },
    create: { id: ROW_ID, ...data },
    update: data,
  });
  return {
    row: mergeWithDefaults(row),
    orphanedVideoKey: cur.videoObjectKey && cur.videoObjectKey !== videoObjectKey ? cur.videoObjectKey : null,
    orphanedPosterUrl: cur.posterUrl && cur.posterUrl !== posterUrl ? cur.posterUrl : null,
  };
}

// Public-safe shape for the homepage block, or null when it must not render.
// Never contains the R2 object key or the raw stored URL.
function toPublicIntroVideo(row) {
  const v = mergeWithDefaults(row);
  if (!v.isEnabled) return null;
  const hosted = Boolean(v.videoObjectKey) && r2.isPromoObjectKey(v.videoObjectKey);
  const embed = !hosted && v.videoUrl ? parseVideoEmbed(v.videoUrl) : null;
  if (!hosted && !embed) return null;
  const cta = v.ctaEnabled && v.ctaLabel && v.ctaUrl ? { label: v.ctaLabel, url: v.ctaUrl } : null;
  const secondaryCta = v.secondaryCtaLabel && v.secondaryCtaUrl ? { label: v.secondaryCtaLabel, url: v.secondaryCtaUrl } : null;
  return {
    eyebrow: v.eyebrow || '',
    heading: v.heading || '',
    highlightText: v.highlightText || '',
    description: v.description || '',
    videoKind: hosted ? 'hosted' : 'embed',
    embedUrl: embed ? embed.embedUrl : null,
    provider: embed ? embed.provider : null,
    posterUrl: v.posterUrl || '',
    cta,
    secondaryCta,
    layout: LAYOUTS.includes(v.layout) ? v.layout : DEFAULTS.layout,
    videoShape: SHAPES.includes(v.videoShape) ? v.videoShape : DEFAULTS.videoShape,
    backgroundStyle: BACKGROUNDS.includes(v.backgroundStyle) ? v.backgroundStyle : DEFAULTS.backgroundStyle,
    autoplayMuted: Boolean(v.autoplayMuted),
    loopVideo: Boolean(v.loopVideo),
  };
}

async function getPublicIntroVideo() {
  try {
    const row = await prisma.homeIntroVideo.findUnique({ where: { id: ROW_ID } });
    return toPublicIntroVideo(row);
  } catch (_err) {
    return null;
  }
}

// Best-effort removal of an R2 object / image that is no longer referenced.
async function deleteHostedVideo(key) {
  if (!r2.isPromoObjectKey(key)) return false;
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
  LAYOUTS,
  SHAPES,
  BACKGROUNDS,
  VIDEO_TYPES,
  LABELS,
  DEFAULTS,
  HomeIntroVideoError,
  normalizeLinkUrl,
  getIntroVideo,
  saveIntroVideo,
  toPublicIntroVideo,
  getPublicIntroVideo,
  deleteHostedVideo,
};
