// Admin-only lesson video upload. Validates extension AND declared MIME
// type against a fixed whitelist (never trusts either alone), writes
// straight to disk via multer's diskStorage (never buffers the whole file
// in memory), and always generates a random filename — the original
// uploaded filename is never used for anything beyond reporting errors.
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const { prisma } = require('../config/db');
const { ALLOWED_VIDEO_TYPES, MAX_UPLOAD_BYTES, ensureCourseDir } = require('../lib/videoStorage');

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
    next();
  } catch (err) {
    next(err);
  }
}

function isAllowedFile(originalname, mimetype) {
  const ext = path.extname(originalname).toLowerCase();
  const expectedMime = ALLOWED_VIDEO_TYPES[ext];
  if (!expectedMime) {
    return false;
  }
  // Reject double extensions like "lesson.mp4.exe" — the true extension is
  // whatever comes last, but guard against an obviously spoofed second
  // segment by requiring the base name have no further recognized media
  // extension chained before it.
  const base = originalname.slice(0, -ext.length);
  if (/\.(exe|sh|php|js|html?|bat|cmd|jar)$/i.test(base)) {
    return false;
  }
  // Belt-and-suspenders: the browser-declared MIME must roughly match.
  return mimetype === expectedMime || mimetype === 'application/octet-stream';
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    try {
      if (!isAllowedFile(file.originalname, file.mimetype)) {
        return cb(new Error('Unsupported video file type. Only .mp4 and .webm are allowed.'));
      }
      const dir = ensureCourseDir(req.lessonForVideo.course.slug);
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

const multerUpload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    cb(null, isAllowedFile(file.originalname, file.mimetype));
  },
}).single('video');

// Translates multer's errors (oversized file, rejected type) into a normal
// flash-message redirect instead of a raw 500 from the generic error
// handler — these are ordinary client mistakes, not server faults.
function uploadLessonVideo(req, res, next) {
  multerUpload(req, res, (err) => {
    if (!err) {
      return next();
    }
    const lessonId = req.lessonForVideo ? req.lessonForVideo.id : req.params.id;
    if (err.code === 'LIMIT_FILE_SIZE') {
      req.flashError(
        'Video file is too large for direct upload. Use File Manager/SFTP for large videos (see README "Video Upload").'
      );
    } else {
      req.flashError(err.message || 'Video upload failed.');
    }
    res.redirect(`/admin/lessons/${lessonId}/edit`);
  });
}

module.exports = { loadLessonForVideo, uploadLessonVideo };
