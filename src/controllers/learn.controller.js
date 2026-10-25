const courseService = require('../services/course.service');
const curriculumService = require('../services/curriculum.service');
const { isUserEnrolled } = require('../services/enrollment.service');
const { computeCourseProgress, getLessonProgressMap } = require('../services/progress.service');
const { parseVideoEmbed } = require('../lib/video');
const { isSelfHostedVideo } = require('../lib/videoStorage');
const { safeRedirectPath } = require('../lib/safeRedirect');
const { getPlayerSettings } = require('../services/coursePlayerSettings.service');

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
    const rawCurriculum = await curriculumService.getPublishedCurriculum(course.id);
    const { curriculum, progressMap, courseProgress } = await curriculumService.getCurriculumProgress(
      req.currentUser.id,
      rawCurriculum
    );
    const resources = await curriculumService.listResourcesForCourse(course.id, { publishedOnly: true });

    res.render('student/course-overview', {
      pageTitle: `${course.title} | Learning`,
      metaDescription: `Continue learning ${course.title}.`,
      course,
      lessons: publishedLessons,
      curriculum,
      resources,
      progress: courseProgress,
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

    const rawCurriculum = await curriculumService.getPublishedCurriculum(course.id);
    const { curriculum, progressMap, courseProgress } = await curriculumService.getCurriculumProgress(
      req.currentUser && enrolled && !isAdmin ? req.currentUser.id : null,
      rawCurriculum
    );
    const resources = await curriculumService.listResourcesForCourse(course.id, { publishedOnly: true });
    // Per-course player presentation (Admin > Landing Page > Player). Never throws.
    const playerSettings = await getPlayerSettings(course.id);

    // Find current module and topic for breadcrumbs
    let currentModule = null;
    let currentTopic = null;
    for (const mod of curriculum) {
      for (const top of mod.topics || []) {
        if ((top.lessons || []).some((l) => l.id === lesson.id)) {
          currentModule = mod;
          currentTopic = top;
          break;
        }
      }
      if (currentModule) break;
    }

    // Record server-side view time for credit clock
    if (req.session && req.currentUser && enrolled && !isAdmin && isSelfHostedVideo(lesson)) {
      const views = req.session.lessonViews || {};
      views[lesson.id] = Date.now();
      const keep = Object.entries(views).sort((a, b) => b[1] - a[1]).slice(0, 10);
      req.session.lessonViews = Object.fromEntries(keep);
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
      curriculum,
      currentModule,
      currentTopic,
      resources,
      videoEmbed,
      previousLesson,
      nextLesson,
      progressMap,
      progress: courseProgress,
      enrolled,
      isAdmin,
      playerSettings,
    });
  } catch (err) {
    next(err);
  }
}

async function downloadResource(req, res, next) {
  try {
    const resourceId = Number(req.params.resourceId);
    if (!resourceId) {
      return res.status(404).render('public/404', { pageTitle: 'Resource Not Found' });
    }

    if (!req.currentUser) {
      const returnTo = safeRedirectPath(req.originalUrl, '/');
      return res.redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    }

    const signed = await curriculumService.getSignedResourceDownloadUrl(
      req.currentUser.id,
      resourceId,
      req.currentUser.role
    );
    return res.redirect(signed.url);
  } catch (err) {
    if (err.statusCode === 401) {
      const returnTo = safeRedirectPath(req.originalUrl, '/');
      return res.redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    }
    if (err.statusCode === 403) {
      req.flashError(err.message || 'You must be enrolled to download this resource.');
      return res.redirect(req.params.courseSlug ? `/courses/${req.params.courseSlug}` : '/courses');
    }
    if (err.statusCode === 404) {
      return res.status(404).render('public/404', { pageTitle: 'Resource Not Found' });
    }
    return next(err);
  }
}

module.exports = { getCourseOverview, getLessonPage, downloadResource };
