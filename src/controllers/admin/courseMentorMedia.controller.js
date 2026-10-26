const svc = require('../../services/courseMentorMedia.service');
const imageStorage = require('../../lib/imageStorage');

const back = (courseId) => `/admin/courses/${courseId}/landing-page?tab=mentor`;

function adopt(req) {
  if (req.courseMentorMediaAdopted) req.courseMentorMediaAdopted = { video: true, poster: true, photo: true };
}

async function cleanup(result, courseId) {
  if (result.orphanedVideoKey) await svc.deleteHostedVideo(result.orphanedVideoKey, courseId);
  if (result.orphanedPosterUrl) imageStorage.deleteIfOwned(result.orphanedPosterUrl);
  if (result.orphanedPhotoUrl) imageStorage.deleteIfOwned(result.orphanedPhotoUrl);
}

function handleError(err, req, res, next, courseId) {
  if (err instanceof svc.CourseMentorMediaError) {
    if (err.status === 404) {
      req.flashError('Course not found.');
      return res.redirect('/admin/courses');
    }
    req.flashError(err.message);
    return res.redirect(back(courseId));
  }
  return next(err);
}

async function save(req, res, next) {
  const courseId = parseInt(req.params.courseId, 10);
  try {
    const files = req.files || {};
    const video = files.video && files.video[0];
    const poster = files.poster && files.poster[0];
    const photo = files.photo && files.photo[0];
    const result = await svc.saveCourseMentorMedia(courseId, req.body || {}, {
      videoObjectKey: video ? video.r2Key : undefined,
      posterUrl: poster ? imageStorage.publicUrlFor(poster.filename) : undefined,
      photoUrl: photo ? imageStorage.publicUrlFor(photo.filename) : undefined,
    });
    adopt(req);
    await cleanup(result, courseId); // replaced / removed media: delete the now-unreferenced files (best effort)
    req.flashSuccess('Mentor photo / video saved.');
    return res.redirect(back(courseId));
  } catch (err) {
    return handleError(err, req, res, next, courseId);
  }
}

async function reset(req, res, next) {
  const courseId = parseInt(req.params.courseId, 10);
  try {
    const result = await svc.resetCourseMentorMedia(courseId);
    await cleanup(result, courseId);
    req.flashSuccess('Mentor media reset: this course shows the instructor photo again.');
    return res.redirect(back(courseId));
  } catch (err) {
    return handleError(err, req, res, next, courseId);
  }
}

module.exports = { save, reset };
