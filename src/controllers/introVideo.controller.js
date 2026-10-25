// PUBLIC delivery of the homepage intro / promo video (marketing media). Deliberately separate
// from the enrollment-protected lesson video path: no student authorization here, but
//   - only keys under site/promo/ are ever signed (lesson / testimonial keys can never be),
//   - the block must be enabled (an Admin may still preview a disabled one),
//   - the response is a short-lived signed URL; the object key and credentials never leave the server.
const { prisma } = require('../config/db');
const r2 = require('../lib/r2');
const videoStorageSettings = require('../services/videoStorageSettings.service');

async function getIntroVideoSource(req, res, next) {
  try {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    const row = await prisma.homeIntroVideo.findUnique({ where: { id: 1 } });
    if (!row || !row.videoObjectKey || !r2.isPromoObjectKey(row.videoObjectKey)) return res.status(404).json({ error: 'Not found' });
    const isAdmin = Boolean(req.currentUser && req.currentUser.role === 'ADMIN');
    if (!row.isEnabled && !isAdmin) return res.status(404).json({ error: 'Not found' });
    const config = await videoStorageSettings.getR2ConfigOrNull();
    if (!config) return res.status(503).json({ error: 'Video unavailable' });
    const { url, expiresInSeconds } = await r2.signedGetUrl(config, row.videoObjectKey);
    const mimeType = row.videoObjectKey.endsWith('.webm') ? 'video/webm' : 'video/mp4';
    return res.json({ url, expiresInSeconds, mimeType });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getIntroVideoSource };
