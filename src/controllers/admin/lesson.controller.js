const path = require('path');
const lessonService = require('../../services/lesson.service');
const { prisma } = require('../../config/db');
const { validateLesson, STATUSES } = require('../../validators/lesson.validator');
const fs = require('fs');
const { findExistingFile, deleteFile, resolveVideoPath, mimeTypeFor } = require('../../lib/videoStorage');
const r2 = require('../../lib/r2');
const videoStorageSettings = require('../../services/videoStorageSettings.service');

const CLEAR_R2_FIELDS = {
  videoObjectKey: null,
  videoDurationSeconds: null,
  videoSizeBytes: null,
  videoMimeType: null,
};

// DB fields for a freshly uploaded file, for either provider.
function videoFieldsForUpload(req, courseSlug) {
  if (req.file.provider === 'R2') {
    return {
      videoType: 'R2',
      videoPath: null,
      videoObjectKey: req.file.r2Key,
      videoDurationSeconds: null,
      videoSizeBytes: BigInt(req.file.size),
      videoMimeType: req.file.mimetype,
    };
  }
  return {
    videoType: 'LOCAL',
    videoPath: path.posix.join(courseSlug, req.file.filename),
    ...CLEAR_R2_FIELDS,
  };
}

// Removes an upload that never got (or lost) its DB link. Best-effort.
function discardUpload(req, courseSlug) {
  if (!req.file) return;
  if (req.file.provider === 'R2') {
    if (req.r2UploadConfig && req.file.r2Key) {
      r2.deleteObject(req.r2UploadConfig, req.file.r2Key).catch(() => {});
    }
  } else if (courseSlug) {
    deleteFile(path.posix.join(courseSlug, req.file.filename));
  }
}

async function listLessons(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) {
      req.flashError('Course not found.');
      return res.redirect('/admin/courses');
    }

    const lessons = await lessonService.listLessonsForCourseAdmin(courseId);

    res.render('admin/lessons/list', {
      pageTitle: `Lessons: ${course.title} | Admin`,
      metaDescription: 'Admin lesson management.',
      course,
      lessons,
    });
  } catch (err) {
    next(err);
  }
}

async function newLessonForm(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) {
      req.flashError('Course not found.');
      return res.redirect('/admin/courses');
    }

    res.render('admin/lessons/form', {
      pageTitle: `New Lesson: ${course.title} | Admin`,
      metaDescription: 'Create a new lesson.',
      course,
      lesson: null,
      statuses: STATUSES,
      errors: [],
      values: {},
    });
  } catch (err) {
    next(err);
  }
}

async function createLesson(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) {
      req.flashError('Course not found.');
      return res.redirect('/admin/courses');
    }

    const { errors, values } = validateLesson(req.body);

    if (errors.length > 0) {
      // A video file may already have been streamed to disk by multer
      // before validation ran — don't leave it orphaned on disk if the rest
      // of the form is being re-rendered for correction.
      discardUpload(req, course.slug);
      return res.status(400).render('admin/lessons/form', {
        pageTitle: `New Lesson: ${course.title} | Admin`,
        metaDescription: 'Create a new lesson.',
        course,
        lesson: null,
        statuses: STATUSES,
        errors,
        values: req.body,
      });
    }

    const lesson = await lessonService.createLesson(courseId, values);

    // Optional video file uploaded alongside the create form (see
    // videoUpload.middleware's loadCourseForVideo/uploadLessonVideoForCreate)
    // — attach it to the lesson that was just created. The file itself is
    // already safely on disk under storage/videos/<course.slug>/<uuid>.ext;
    // only the safe relative path is ever written to the DB.
    if (req.file) {
      await prisma.lesson.update({
        where: { id: lesson.id },
        data: videoFieldsForUpload(req, course.slug),
      });
    }

    req.flashSuccess('Lesson created successfully.');
    res.redirect(`/admin/courses/${courseId}/lessons`);
  } catch (err) {
    // Clean up an already-uploaded file if lesson creation/attach failed
    // partway through, using the course slug the upload middleware resolved
    // (req.videoCourseSlug) rather than re-deriving anything from user input.
    discardUpload(req, req.videoCourseSlug);
    if (err instanceof lessonService.LessonError) {
      req.flashError(err.message);
      return res.redirect(`/admin/courses/${req.params.courseId}/lessons`);
    }
    next(err);
  }
}

async function editLessonForm(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const lesson = await lessonService.getLessonByIdAdmin(id);
    if (!lesson) {
      req.flashError('Lesson not found.');
      return res.redirect('/admin/courses');
    }

    res.render('admin/lessons/form', {
      pageTitle: `Edit: ${lesson.title} | Admin`,
      metaDescription: 'Edit lesson.',
      course: lesson.course,
      lesson,
      statuses: STATUSES,
      errors: [],
      values: lesson,
    });
  } catch (err) {
    next(err);
  }
}

async function updateLesson(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await lessonService.getLessonByIdAdmin(id);
    if (!existing) {
      req.flashError('Lesson not found.');
      return res.redirect('/admin/courses');
    }

    const { errors, values } = validateLesson(req.body);

    if (errors.length > 0) {
      return res.status(400).render('admin/lessons/form', {
        pageTitle: `Edit: ${existing.title} | Admin`,
        metaDescription: 'Edit lesson.',
        course: existing.course,
        lesson: existing,
        statuses: STATUSES,
        errors,
        values: { ...req.body, id },
      });
    }

    await lessonService.updateLesson(id, values);
    req.flashSuccess('Lesson updated successfully.');
    res.redirect(`/admin/courses/${existing.courseId}/lessons`);
  } catch (err) {
    if (err instanceof lessonService.LessonError) {
      req.flashError(err.message);
      return res.redirect('/admin/courses');
    }
    next(err);
  }
}

async function deleteLesson(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const courseId = await lessonService.deleteLesson(id);
    req.flashSuccess('Lesson deleted.');
    res.redirect(`/admin/courses/${courseId}/lessons`);
  } catch (err) {
    if (err instanceof lessonService.LessonError) {
      req.flashError(err.message);
      return res.redirect('/admin/courses');
    }
    next(err);
  }
}

// Handles a direct browser upload (see videoUpload.middleware) — multer has
// already streamed the file to storage/videos/<courseSlug>/<uuid>.ext by the
// time this runs. We only ever record the server-generated relative path.
async function uploadLessonVideo(req, res, next) {
  try {
    const lesson = req.lessonForVideo;
    if (!req.file) {
      req.flashError('No video file was uploaded, or the file type/size was rejected.');
      return res.redirect(`/admin/lessons/${lesson.id}/edit`);
    }

    // New file is already stored. Link it in the DB FIRST; only after that
    // succeeds is the previous video removed. If the DB update fails the new
    // orphan is deleted and the current working video is left untouched.
    try {
      await prisma.lesson.update({
        where: { id: lesson.id },
        data: videoFieldsForUpload(req, lesson.course.slug),
      });
    } catch (dbErr) {
      discardUpload(req, lesson.course.slug);
      throw dbErr;
    }

    await lessonService.cleanupPreviousVideo(lesson, lesson.id);

    req.flashSuccess('Video uploaded and attached to this lesson.');
    res.redirect(`/admin/lessons/${lesson.id}/edit`);
  } catch (err) {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      req.flashError('Video file is too large. Use File Manager/SFTP for large videos (see README).');
      return res.redirect(`/admin/lessons/${req.params.id}/edit`);
    }
    next(err);
  }
}

// For videos already placed under storage/videos/<courseSlug>/ via
// Hostinger File Manager/SFTP (see README "Video Upload") — admin only
// supplies the bare filename, never a path.
async function registerLessonVideo(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const lesson = await lessonService.getLessonByIdAdmin(id);
    if (!lesson) {
      req.flashError('Lesson not found.');
      return res.redirect('/admin/courses');
    }

    const filename = typeof req.body.filename === 'string' ? req.body.filename.trim() : '';
    const relativePath = findExistingFile(lesson.course.slug, filename);
    if (!relativePath) {
      req.flashError(
        `File not found. It must already exist at storage/videos/${lesson.course.slug}/<filename> and be a .mp4 or .webm file.`
      );
      return res.redirect(`/admin/lessons/${id}/edit`);
    }

    await prisma.lesson.update({
      where: { id },
      data: { videoType: 'LOCAL', videoPath: relativePath, ...CLEAR_R2_FIELDS },
    });

    if (!(lesson.videoType === 'LOCAL' && lesson.videoPath === relativePath)) {
      await lessonService.cleanupPreviousVideo(lesson, id);
    }

    req.flashSuccess('Existing video file registered for this lesson.');
    res.redirect(`/admin/lessons/${id}/edit`);
  } catch (err) {
    next(err);
  }
}

// Detaches the local video from the lesson (falls back to videoUrl/EXTERNAL
// if set). Does not delete the file from disk — an admin who wants that
// done can remove it via File Manager/SFTP.
async function removeLessonVideo(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const lesson = await lessonService.getLessonByIdAdmin(id);
    if (!lesson) {
      req.flashError('Lesson not found.');
      return res.redirect('/admin/courses');
    }

    await prisma.lesson.update({
      where: { id },
      data: { videoType: 'EXTERNAL', videoPath: null, ...CLEAR_R2_FIELDS },
    });

    await lessonService.cleanupPreviousVideo(lesson, id);

    req.flashSuccess('Video detached from this lesson.');
    res.redirect(`/admin/lessons/${id}/edit`);
  } catch (err) {
    next(err);
  }
}

// Admin-triggered only (never automatic): copy a LOCAL video to R2, verify the
// stored size matches, THEN switch the lesson to R2. The local file and
// videoPath are kept so the move can be rolled back; delete the local copy
// manually once playback is verified.
async function migrateLessonVideoToR2(req, res, next) {
  const id = parseInt(req.params.id, 10);
  const back = () => res.redirect(`/admin/lessons/${id}/edit`);
  let config;
  let key;
  try {
    const lesson = await lessonService.getLessonByIdAdmin(id);
    if (!lesson) {
      req.flashError('Lesson not found.');
      return res.redirect('/admin/courses');
    }
    if (lesson.videoType !== 'LOCAL' || !lesson.videoPath) {
      req.flashError('Only lessons with a local video can be migrated.');
      return back();
    }
    config = await videoStorageSettings.getR2ConfigOrNull();
    if (!config) {
      req.flashError('Cloudflare R2 is not configured. See Admin > Video Storage.');
      return back();
    }
    const absolute = resolveVideoPath(lesson.videoPath);
    const stat = absolute && fs.existsSync(absolute) ? fs.statSync(absolute) : null;
    if (!stat || !stat.isFile()) {
      req.flashError('The local video file could not be found.');
      return back();
    }
    const ext = path.extname(absolute).toLowerCase();
    const mime = mimeTypeFor(ext);
    if (!mime) {
      req.flashError('Unsupported local video type.');
      return back();
    }

    key = r2.buildObjectKey(lesson.courseId, lesson.id, ext);
    const meta = await r2.uploadStream(config, key, fs.createReadStream(absolute), mime);
    if (meta.size !== stat.size) {
      await r2.deleteObject(config, key);
      req.flashError('Upload verification failed (size mismatch); nothing was changed.');
      return back();
    }

    try {
      await prisma.lesson.update({
        where: { id },
        data: {
          videoType: 'R2',
          videoObjectKey: key,
          videoSizeBytes: BigInt(stat.size),
          videoMimeType: mime,
        },
      });
    } catch (dbErr) {
      await r2.deleteObject(config, key).catch(() => {});
      throw dbErr;
    }

    req.flashSuccess('Video migrated to Cloudflare R2. The local copy was kept - verify playback, then delete it manually.');
    return back();
  } catch (err) {
    if (config && key) r2.deleteObject(config, key).catch(() => {});
    console.error('R2 migration failed:', err && err.name);
    req.flashError('Migration to R2 failed; the lesson was not changed.');
    return back();
  }
}

module.exports = {
  migrateLessonVideoToR2,
  listLessons,
  newLessonForm,
  createLesson,
  editLessonForm,
  updateLesson,
  deleteLesson,
  uploadLessonVideo,
  registerLessonVideo,
  removeLessonVideo,
};
