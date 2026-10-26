// PUBLIC delivery of a course's mentor video (marketing media). Deliberately separate from the
// enrollment-protected lesson video path: no student authorization here, but
//   - only keys of the shape courses/<id>/mentor/<uuid>.<ext> belonging to THAT course are ever signed
//     (lesson / testimonial / promo / doctor keys - or another course's mentor key - can never be),
//   - the course must be PUBLISHED and the video must be the displayed media (an Admin may preview any),
//   - the response is a short-lived signed URL; the object key and credentials never leave the server.
const { prisma } = require('../config/db');
const r2 = require('../lib/r2');
const videoStorageSettings = require('../services/videoStorageSettings.service');

async function getCourseMentorVideoSource(req, res, next) {
  try {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    const raw = req.params.courseId;
    const id = /^\d{1,10}$/.test(raw) ? parseInt(raw, 10) : NaN;
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) return res.status(404).json({ error: 'Not found' });

    const row = await prisma.courseMentorMedia.findUnique({ where: { courseId: id }, include: { course: { select: { status: true } } } });
    if (!row || !row.course || !row.videoObjectKey || !r2.isMentorObjectKey(row.videoObjectKey, id)) return res.status(404).json({ error: 'Not found' });
    const isAdmin = Boolean(req.currentUser && req.currentUser.role === 'ADMIN');
    if (!isAdmin && (row.course.status !== 'PUBLISHED' || row.mediaMode !== 'VIDEO')) return res.status(404).json({ error: 'Not found' });
    const config = await videoStorageSettings.getR2ConfigOrNull();
    if (!config) return res.status(503).json({ error: 'Video unavailable' });
    const { url, expiresInSeconds } = await r2.signedGetUrl(config, row.videoObjectKey);
    const mimeType = row.videoObjectKey.endsWith('.webm') ? 'video/webm' : 'video/mp4';
    return res.json({ url, expiresInSeconds, mimeType });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getCourseMentorVideoSource };
