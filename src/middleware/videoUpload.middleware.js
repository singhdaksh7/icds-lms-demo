// Admin-only lesson video upload. Validates extension AND declared MIME
// type against a fixed whitelist (never trusts either alone), writes
// straight to disk via multer's diskStorage (never buffers the whole file
// in memory), and always generates a random filename — the original
// uploaded filename is never used for anything beyond reporting errors.
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const { prisma } = require('../config/db');
const {
  MAX_UPLOAD_BYTES,
  ensureCourseDir,
  isAllowedVideoFile,
} = require('../lib/videoStorage');
const { createR2Storage, VideoSignatureError } = require('../lib/r2MulterStorage');
const videoStorageSettings = require('../services/videoStorageSettings.service');

// Loads the target lesson (+ course, for its slug) before multer starts
// streaming the upload, so the destination directory can be computed safely
// server-side — never from any client-supplied path.
async function loadLessonForVideo(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const lesson = await prisma.lesson.findUnique({ where: { id }, include: { course: true } });
    if (!lesson || !lesson.course) {
      req.flashError('Lesson not found.');
      return res.redirect('/admin/courses');
    }
    req.lessonForVideo = lesson;
    req.videoCourseSlug = lesson.course.slug;
    next();
  } catch (err) {
    next(err);
  }
}

// Same idea, but for the lesson-create flow: there is no lesson row yet, so
// the destination directory is computed from the parent course (courseId
// route param) instead. A video file is optional here — createLesson still
// works fine with no file attached.
async function loadCourseForVideo(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) {
      req.flashError('Course not found.');
      return res.redirect('/admin/courses');
    }
    req.courseForVideo = course;
    req.videoCourseSlug = course.slug;
    next();
  } catch (err) {
    next(err);
  }
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    try {
      if (!isAllowedVideoFile(file.originalname, file.mimetype)) {
        return cb(new Error('Unsupported video file type. Only .mp4 and .webm are allowed.'));
      }
      const dir = ensureCourseDir(req.videoCourseSlug);
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const videoFileFilter = (req, file, cb) => cb(null, isAllowedVideoFile(file.originalname, file.mimetype));

const multerUpload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: videoFileFilter,
}).single('video');

// Cloudflare R2 uploads stream straight to the bucket (no VPS disk, no whole-
// file buffering), so the cap can be far larger than the 200 MB local limit.
const R2_MAX_UPLOAD_BYTES = Number(process.env.R2_MAX_UPLOAD_BYTES) || 5 * 1024 * 1024 * 1024; // 5 GiB
const r2MulterUpload = multer({
  storage: createR2Storage(),
  limits: { fileSize: R2_MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: videoFileFilter,
}).single('video');

// Picks the upload destination from the admin's Video Storage settings.
// Existing LOCAL lessons are unaffected; only where NEW uploads go changes.
async function resolveUploadTarget(req) {
  const cfg = await videoStorageSettings.getConfig();
  if (cfg.activeProvider !== 'CLOUDFLARE_R2') {
    req.videoProvider = 'LOCAL';
    return;
  }
  req.videoProvider = 'R2';
  req.r2UploadConfig = cfg.r2;
  req.r2CourseId = req.lessonForVideo ? req.lessonForVideo.courseId : req.courseForVideo.id;
  req.r2LessonId = req.lessonForVideo ? req.lessonForVideo.id : 'new';
}

// Translates multer's errors (oversized file, rejected type) into a normal
// flash-message redirect instead of a raw 500 from the generic error
// handler — these are ordinary client mistakes, not server faults.
// `redirectTo` lets callers send the admin back to the right form on
// failure (edit page for replace uploads, new-lesson form for create-time
// uploads).
function uploadVideo(redirectTo) {
  return async function (req, res, next) {
    try {
      await resolveUploadTarget(req);
    } catch (err) {
      return next(err);
    }
    const handler = req.videoProvider === 'R2' ? r2MulterUpload : multerUpload;
    handler(req, res, (err) => {
      if (!err) {
        return next();
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        req.flashError(
          req.videoProvider === 'R2'
            ? 'Video file is too large (max 5 GB).'
            : 'Video file is too large for direct upload (max 200MB). Use File Manager/SFTP for large videos (see README "Video Upload").'
        );
      } else if (req.videoProvider === 'R2' && !(err instanceof VideoSignatureError) && !/Unsupported video/.test(err.message || '')) {
        // Never surface raw storage-SDK errors to the browser.
        console.error('R2 upload failed:', err && err.name);
        req.flashError('Video upload to cloud storage failed. Check Admin > Video Storage and try again.');
      } else {
        req.flashError(err.message || 'Video upload failed.');
      }
      res.redirect(typeof redirectTo === 'function' ? redirectTo(req) : redirectTo);
    });
  };
}

const uploadLessonVideo = uploadVideo((req) => {
  const lessonId = req.lessonForVideo ? req.lessonForVideo.id : req.params.id;
  return `/admin/lessons/${lessonId}/edit`;
});

const uploadLessonVideoForCreate = uploadVideo(
  (req) => `/admin/courses/${req.params.courseId}/lessons/new`
);

// The main "Save Changes" (title/description/status) form on the edit-lesson
// page is submitted as multipart/form-data (form-content.ejs is shared with
// the create form's file input), even though updateLesson never reads
// req.file — video replacement is strictly handled by the separate
// /lessons/:id/video/upload endpoint above. Because the body is multipart,
// Express's body parsers can't populate req.body, so doubleCsrfProtection
// (which reads req.body._csrf) would never see the token unless multer runs
// first. This uses .none() — no file part is ever expected on this form —
// so a stray file field is rejected as a client error rather than silently
// accepted and ignored.
const parseLessonUpdateFields = function (req, res, next) {
  multer().none()(req, res, (err) => {
    if (!err) {
      return next();
    }
    req.flashError(err.message || 'Could not process the submitted form.');
    res.redirect(`/admin/lessons/${req.params.id}/edit`);
  });
};

module.exports = {
  loadLessonForVideo,
  loadCourseForVideo,
  uploadLessonVideo,
  uploadLessonVideoForCreate,
  parseLessonUpdateFields,
};
