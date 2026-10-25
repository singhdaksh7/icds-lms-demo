const svc = require('../../services/homeIntroVideo.service');
const imageStorage = require('../../lib/imageStorage');
const videoStorageSettings = require('../../services/videoStorageSettings.service');

const BASE = '/admin/homepage/intro-video';

async function show(req, res, next) {
  try {
    const [video, r2Config] = await Promise.all([svc.getIntroVideo(), videoStorageSettings.getR2ConfigOrNull().catch(() => null)]);
    res.render('admin/homepage/intro-video', {
      pageTitle: 'Intro Video | Admin',
      metaDescription: 'Homepage intro / promo video.',
      video,
      preview: svc.toPublicIntroVideo(video),
      r2Configured: Boolean(r2Config),
      options: { LAYOUTS: svc.LAYOUTS, SHAPES: svc.SHAPES, BACKGROUNDS: svc.BACKGROUNDS, LABELS: svc.LABELS },
    });
  } catch (err) {
    next(err);
  }
}

function adopt(req) {
  if (req.introMediaAdopted) req.introMediaAdopted = { video: true, poster: true };
}

async function save(req, res, next) {
  try {
    const files = req.files || {};
    const uploadedVideo = files.video && files.video[0];
    const uploadedPoster = files.poster && files.poster[0];
    const result = await svc.saveIntroVideo(req.body || {}, {
      videoObjectKey: uploadedVideo ? uploadedVideo.r2Key : undefined,
      posterUrl: uploadedPoster ? imageStorage.publicUrlFor(uploadedPoster.filename) : undefined,
    });
    adopt(req);
    // Replaced / removed media: delete the now-unreferenced objects (best effort).
    if (result.orphanedVideoKey) await svc.deleteHostedVideo(result.orphanedVideoKey);
    if (result.orphanedPosterUrl) imageStorage.deleteIfOwned(result.orphanedPosterUrl);
    req.flashSuccess('Intro video saved.');
    res.redirect(BASE);
  } catch (err) {
    if (err instanceof svc.HomeIntroVideoError) {
      req.flashError(err.message);
      return res.redirect(BASE);
    }
    return next(err);
  }
}

module.exports = { show, save };
