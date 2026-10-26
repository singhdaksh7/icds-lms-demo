const svc = require('../../services/doctorMedia.service');
const imageStorage = require('../../lib/imageStorage');
const videoStorageSettings = require('../../services/videoStorageSettings.service');

const BASE = '/admin/doctor-media';

async function show(req, res, next) {
  try {
    const [media, r2Config] = await Promise.all([svc.getDoctorMedia(), videoStorageSettings.getR2ConfigOrNull().catch(() => null)]);
    res.render('admin/doctor-media/index', {
      pageTitle: 'Doctor Photo / Video | Admin',
      metaDescription: 'Photo or video shown in the about-the-doctor sections.',
      media,
      preview: svc.toPublicDoctorMedia(media),
      r2Configured: Boolean(r2Config),
      modes: svc.MODES,
    });
  } catch (err) {
    next(err);
  }
}

function adopt(req) {
  if (req.doctorMediaAdopted) req.doctorMediaAdopted = { video: true, poster: true, photo: true };
}

async function save(req, res, next) {
  try {
    const files = req.files || {};
    const video = files.video && files.video[0];
    const poster = files.poster && files.poster[0];
    const photo = files.photo && files.photo[0];
    const result = await svc.saveDoctorMedia(req.body || {}, {
      videoObjectKey: video ? video.r2Key : undefined,
      posterUrl: poster ? imageStorage.publicUrlFor(poster.filename) : undefined,
      photoUrl: photo ? imageStorage.publicUrlFor(photo.filename) : undefined,
    });
    adopt(req);
    // Replaced / removed media: delete the now-unreferenced objects (best effort).
    if (result.orphanedVideoKey) await svc.deleteHostedVideo(result.orphanedVideoKey);
    if (result.orphanedPosterUrl) imageStorage.deleteIfOwned(result.orphanedPosterUrl);
    if (result.orphanedPhotoUrl) imageStorage.deleteIfOwned(result.orphanedPhotoUrl);
    req.flashSuccess('Doctor photo / video saved.');
    res.redirect(BASE);
  } catch (err) {
    if (err instanceof svc.DoctorMediaError) {
      req.flashError(err.message);
      return res.redirect(BASE);
    }
    return next(err);
  }
}

module.exports = { show, save };
