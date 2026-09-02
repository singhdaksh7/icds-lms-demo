const courseService = require('../services/course.service');
const { isUserEnrolled } = require('../services/enrollment.service');
const { computeCourseProgress, getLessonProgressMap } = require('../services/progress.service');
const { parseVideoEmbed } = require('../lib/video');
const { safeRedirectPath } = require('../lib/safeRedirect');

async function getCourseOverview(req, res, next) {
  try {
    const isAdmin = Boolean(req.currentUser && req.currentUser.role === 'ADMIN');
    const course = await courseService.getCourseBySlugForViewer(req.params.courseSlug, isAdmin);

    if (!course) {
      return res.status(404).render('public/404', { pageTitle: 'Course Not Found' });
    }

    if (!req.currentUser) {
      const returnTo = safeRedirectPath(req.originalUrl, '/');
      return res.redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    }

    let enrolled = isAdmin;
    if (!isAdmin) {
      enrolled = await isUserEnrolled(req.currentUser.id, course.id);
    }

    if (!enrolled) {
      req.flashError('Enroll in this course to access the learning area.');
      return res.redirect(`/courses/${course.slug}`);
    }

    const publishedLessons = course.lessons.filter((l) => l.status === 'PUBLISHED');
    const lessonIds = publishedLessons.map((l) => l.id);

    const [progress, progressMap] = await Promise.all([
      isAdmin
        ? Promise.resolve({ completed: 0, total: publishedLessons.length, percent: 0 })
        : computeCourseProgress(req.currentUser.id, course.id),
      isAdmin ? Promise.resolve({}) : getLessonProgressMap(req.currentUser.id, lessonIds),
    ]);

    res.render('student/course-overview', {
      pageTitle: `${course.title} | Learning`,
      metaDescription: `Continue learning ${course.title}.`,
      course,
      lessons: publishedLessons,
      progress,
      progressMap,
      isAdmin,
    });
  } catch (err) {
    next(err);
  }
}

async function getLessonPage(req, res, next) {
  try {
    const { courseSlug, lessonSlug } = req.params;
    const isAdmin = Boolean(req.currentUser && req.currentUser.role === 'ADMIN');

    const course = await courseService.getCourseBySlugForViewer(courseSlug, isAdmin);
    if (!course) {
      return res.status(404).render('public/404', { pageTitle: 'Course Not Found' });
    }

    const publishedLessons = course.lessons
      .filter((l) => l.status === 'PUBLISHED')
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

    const lessonIndex = publishedLessons.findIndex((l) => l.slug === lessonSlug);
    const lesson = lessonIndex === -1 ? null : publishedLessons[lessonIndex];

    if (!lesson) {
      return res.status(404).render('public/404', { pageTitle: 'Lesson Not Found' });
    }

    let enrolled = false;
    if (req.currentUser) {
      enrolled = isAdmin || (await isUserEnrolled(req.currentUser.id, course.id));
    }

    const allowed = lesson.preview || enrolled;

    if (!allowed) {
      if (!req.currentUser) {
        const returnTo = safeRedirectPath(req.originalUrl, '/');
        return res.redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      }
      req.flashError('Enroll in this course to access this lesson.');
      return res.redirect(`/courses/${course.slug}`);
    }

    const videoEmbed = parseVideoEmbed(lesson.videoUrl);

    let progressMap = {};
    let progress = { completed: 0, total: publishedLessons.length, percent: 0 };
    if (req.currentUser && enrolled && !isAdmin) {
      const lessonIds = publishedLessons.map((l) => l.id);
      [progressMap, progress] = await Promise.all([
        getLessonProgressMap(req.currentUser.id, lessonIds),
        computeCourseProgress(req.currentUser.id, course.id),
      ]);
    }

    const previousLesson = lessonIndex > 0 ? publishedLessons[lessonIndex - 1] : null;
    const nextLesson =
      lessonIndex < publishedLessons.length - 1 ? publishedLessons[lessonIndex + 1] : null;

    res.render('student/lesson', {
      pageTitle: `${lesson.title} | ${course.title}`,
      metaDescription: `${lesson.title} — part of ${course.title}.`,
      course,
      lesson,
      lessons: publishedLessons,
      videoEmbed,
      previousLesson,
      nextLesson,
      progressMap,
      progress,
      enrolled,
      isAdmin,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getCourseOverview, getLessonPage };
