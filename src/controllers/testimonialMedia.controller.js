// PUBLIC delivery of testimonial videos (marketing media). Deliberately separate from the
// enrollment-protected lesson video path: no student authorization here, but
//   - only keys under courses/<id>/testimonials/ are ever signed (lesson keys can never be),
//   - only published reviews of PUBLISHED courses are served,
//   - demo reviews are served only to an Admin (preview) - never publicly, even in demo-showcase mode,
//   - the response is a short-lived signed URL; the object key and credentials never leave the server.
const { prisma } = require('../config/db');
const r2 = require('../lib/r2');
const videoStorageSettings = require('../services/videoStorageSettings.service');

async function getTestimonialVideoSource(req, res, next) {
  try {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    const raw = req.params.id;
    const id = /^\d{1,10}$/.test(raw) ? parseInt(raw, 10) : NaN;
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) return res.status(404).json({ error: 'Not found' });

    const t = await prisma.courseTestimonial.findUnique({ where: { id }, include: { course: { select: { status: true } } } });
    if (!t || !t.isPublished || !t.course || t.course.status !== 'PUBLISHED' || t.reviewType === 'TEXT') return res.status(404).json({ error: 'Not found' });
    if (!t.videoObjectKey || !r2.isTestimonialObjectKey(t.videoObjectKey)) return res.status(404).json({ error: 'Not found' });
    // Demo videos are Admin-Preview only (not even the demo-showcase switch makes them public).
    if (t.isDemo && !(req.currentUser && req.currentUser.role === 'ADMIN')) return res.status(404).json({ error: 'Not found' });
    const config = await videoStorageSettings.getR2ConfigOrNull();
    if (!config) return res.status(503).json({ error: 'Video unavailable' });
    const { url, expiresInSeconds } = await r2.signedGetUrl(config, t.videoObjectKey);
    const mimeType = t.videoObjectKey.endsWith('.webm') ? 'video/webm' : 'video/mp4';
    return res.json({ url, expiresInSeconds, mimeType });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getTestimonialVideoSource };
