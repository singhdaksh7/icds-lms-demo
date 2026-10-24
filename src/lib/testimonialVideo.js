// Video testimonials: validation + public-safe shaping.
//
// A testimonial is TEXT (quote), VIDEO (video, quote optional) or TEXT_VIDEO
// (both required). Videos are PUBLIC marketing media, deliberately separate from
// protected course videos:
//   - hosted: a Cloudflare R2 object under courses/<id>/testimonials/..., played
//     through /api/testimonials/:id/video-source (short-lived signed URL). The raw
//     object key is never rendered into a page.
//   - external: an approved YouTube/Vimeo link, rendered as a server-built embed URL.
const r2 = require('./r2');
const { parseVideoEmbed } = require('./video');

const TYPES = ['TEXT', 'VIDEO', 'TEXT_VIDEO'];
const TYPE_LABELS = { TEXT: 'Text Review', VIDEO: 'Video Review', TEXT_VIDEO: 'Text + Video' };

const needsQuote = (type) => type === 'TEXT' || type === 'TEXT_VIDEO';
const needsVideo = (type) => type === 'VIDEO' || type === 'TEXT_VIDEO';

function normalizeType(value, fallback = 'TEXT') {
  const v = String(Array.isArray(value) ? value[value.length - 1] : (value ?? '')).trim().toUpperCase();
  return TYPES.includes(v) ? v : fallback;
}

// '' -> null; otherwise only a recognised YouTube/Vimeo URL is accepted.
function normalizeExternalVideoUrl(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  const v = String(raw).trim();
  if (!v) return { ok: true, value: null };
  if (v.length > 500) return { ok: false, error: 'Video URL is too long.' };
  if (!parseVideoEmbed(v)) return { ok: false, error: 'Video URL must be a valid https YouTube or Vimeo link.' };
  if (!/^https:\/\//i.test(v)) return { ok: false, error: 'Video URL must use https.' };
  return { ok: true, value: v };
}

// Thumbnails: an app-hosted upload path or an https image URL. Nothing else.
function normalizeThumbnailUrl(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  const v = String(raw).trim();
  if (!v) return { ok: true, value: null };
  if (v.length > 500) return { ok: false, error: 'Thumbnail URL is too long.' };
  if (/^\/uploads\/thumbnails\/[A-Za-z0-9._\/-]+$/.test(v) && !v.includes('..')) return { ok: true, value: v };
  if (/^https:\/\/[^\s"'<>]+$/i.test(v)) return { ok: true, value: v };
  return { ok: false, error: 'Thumbnail must be an uploaded image or an https image URL.' };
}

function ownsHostedKey(key, courseId) {
  return r2.isTestimonialObjectKey(key) && key.startsWith(`courses/${courseId}/testimonials/`);
}

// final: the merged testimonial state about to be saved.
// Returns an array of human-readable errors (empty when valid).
function validateTestimonial(final, courseId) {
  const errors = [];
  const type = final.reviewType;
  if (!TYPES.includes(type)) errors.push('Review type must be Text, Video or Text + Video.');
  if (!final.reviewerName || !String(final.reviewerName).trim()) errors.push('Reviewer name is required.');
  const hasQuote = Boolean(final.quote && String(final.quote).trim());
  const hasHosted = Boolean(final.videoObjectKey);
  const hasExternal = Boolean(final.videoUrl);
  if (needsQuote(type) && !hasQuote) errors.push(type === 'TEXT_VIDEO' ? 'Text + Video reviews need a quote.' : 'Testimonial quote is required.');
  if (needsVideo(type) && !hasHosted && !hasExternal) errors.push(type === 'TEXT_VIDEO' ? 'Text + Video reviews need a video (upload or YouTube/Vimeo link).' : 'Video reviews need a video (upload or YouTube/Vimeo link).');
  if (hasHosted && !ownsHostedKey(final.videoObjectKey, courseId)) errors.push('Invalid hosted video reference.');
  if (hasHosted && hasExternal) errors.push('Use either an uploaded video or a video link, not both.');
  return errors;
}

// Public-safe shape for templates: no object key, no raw URL.
function toPublicTestimonial(row) {
  const type = TYPES.includes(row.reviewType) ? row.reviewType : 'TEXT';
  const hosted = Boolean(row.videoObjectKey) && r2.isTestimonialObjectKey(row.videoObjectKey);
  const embed = !hosted && row.videoUrl ? parseVideoEmbed(row.videoUrl) : null;
  const hasVideo = needsVideo(type) && (hosted || Boolean(embed));
  const { videoObjectKey, videoUrl, ...rest } = row;
  return {
    ...rest,
    reviewType: type,
    hasVideo,
    videoKind: hasVideo ? (hosted ? 'hosted' : 'embed') : null,
    embedUrl: hasVideo && embed ? embed.embedUrl : null,
    videoThumbnailUrl: row.videoThumbnailUrl || null,
    hasQuote: Boolean(row.quote && String(row.quote).trim()),
  };
}

async function deleteHostedVideo(key) {
  if (!r2.isTestimonialObjectKey(key)) return false;
  try {
    const cfg = await require('../services/videoStorageSettings.service').getR2ConfigOrNull();
    if (!cfg) return false;
    await r2.deleteObject(cfg, key);
    return true;
  } catch (_err) {
    return false;
  }
}

module.exports = {
  TYPES, TYPE_LABELS, needsQuote, needsVideo, normalizeType, normalizeExternalVideoUrl, normalizeThumbnailUrl,
  validateTestimonial, toPublicTestimonial, deleteHostedVideo, ownsHostedKey,
};
