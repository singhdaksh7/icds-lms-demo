// PUBLIC delivery of the "about the doctor" video (marketing media). Deliberately separate from the
// enrollment-protected lesson video path: no student authorization here, but
//   - only keys under site/doctor/ are ever signed (lesson / testimonial / promo keys can never be),
//   - the video is signed only while the Admin has it set as the displayed media (an Admin may preview any),
//   - the response is a short-lived signed URL; the object key and credentials never leave the server.
const { prisma } = require('../config/db');
const r2 = require('../lib/r2');
const videoStorageSettings = require('../services/videoStorageSettings.service');

async function getDoctorVideoSource(req, res, next) {
  try {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    const row = await prisma.doctorMedia.findUnique({ where: { id: 1 } });
    if (!row || !row.videoObjectKey || !r2.isDoctorObjectKey(row.videoObjectKey)) return res.status(404).json({ error: 'Not found' });
    const isAdmin = Boolean(req.currentUser && req.currentUser.role === 'ADMIN');
    if (row.mediaMode !== 'VIDEO' && !isAdmin) return res.status(404).json({ error: 'Not found' });
    const config = await videoStorageSettings.getR2ConfigOrNull();
    if (!config) return res.status(503).json({ error: 'Video unavailable' });
    const { url, expiresInSeconds } = await r2.signedGetUrl(config, row.videoObjectKey);
    const mimeType = row.videoObjectKey.endsWith('.webm') ? 'video/webm' : 'video/mp4';
    return res.json({ url, expiresInSeconds, mimeType });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getDoctorVideoSource };
