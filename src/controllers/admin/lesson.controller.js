const path = require('path');
const lessonService = require('../../services/lesson.service');
const { prisma } = require('../../config/db');
const { validateLesson, STATUSES } = require('../../validators/lesson.validator');
const { findExistingFile } = require('../../lib/videoStorage');

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

    await lessonService.createLesson(courseId, values);
    req.flashSuccess('Lesson created successfully.');
    res.redirect(`/admin/courses/${courseId}/lessons`);
  } catch (err) {
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

    const relativePath = path.posix.join(lesson.course.slug, req.file.filename);
    await prisma.lesson.update({
      where: { id: lesson.id },
      data: { videoType: 'LOCAL', videoPath: relativePath },
    });

    if (lesson.videoType === 'LOCAL' && lesson.videoPath && lesson.videoPath !== relativePath) {
      await lessonService.cleanupOrphanedVideo(lesson.videoPath, lesson.id);
    }

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
      data: { videoType: 'LOCAL', videoPath: relativePath },
    });

    if (lesson.videoType === 'LOCAL' && lesson.videoPath && lesson.videoPath !== relativePath) {
      await lessonService.cleanupOrphanedVideo(lesson.videoPath, id);
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
      data: { videoType: 'EXTERNAL', videoPath: null },
    });

    if (lesson.videoType === 'LOCAL' && lesson.videoPath) {
      await lessonService.cleanupOrphanedVideo(lesson.videoPath, id);
    }

    req.flashSuccess('Local video detached from this lesson.');
    res.redirect(`/admin/lessons/${id}/edit`);
  } catch (err) {
    next(err);
  }
}

module.exports = {
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
