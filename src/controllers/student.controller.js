const { listEnrollmentsForUser } = require('../services/enrollment.service');
const { markLessonComplete, ProgressError } = require('../services/progress.service');
const { prisma } = require('../config/db');

async function getDashboard(req, res, next) {
  try {
    const enrollments = await listEnrollmentsForUser(req.currentUser.id);

    res.render('student/dashboard', {
      pageTitle: 'My Courses | ICDS',
      metaDescription: 'Your enrolled courses and learning progress.',
      enrollments,
    });
  } catch (err) {
    next(err);
  }
}

async function completeLesson(req, res, next) {
  try {
    const lessonId = parseInt(req.params.lessonId, 10);
    if (!Number.isInteger(lessonId)) {
      return res.status(404).render('public/404', { pageTitle: 'Not Found' });
    }

    const { lesson } = await markLessonComplete(req.currentUser.id, lessonId);
    const course = await prisma.course.findUnique({ where: { id: lesson.courseId } });

    req.flashSuccess('Lesson marked as complete.');
    res.redirect(`/learn/${course.slug}/${lesson.slug}`);
  } catch (err) {
    if (err instanceof ProgressError) {
      req.flashError(err.message);
      return res.redirect('/student/dashboard');
    }
    next(err);
  }
}

module.exports = { getDashboard, completeLesson };
