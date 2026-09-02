const lessonService = require('../../services/lesson.service');
const { prisma } = require('../../config/db');
const { validateLesson, STATUSES } = require('../../validators/lesson.validator');

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

module.exports = { listLessons, newLessonForm, createLesson, editLessonForm, updateLesson, deleteLesson };
