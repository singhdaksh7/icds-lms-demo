const svc = require('../../services/courseReviewsCarousel.service');

async function save(req, res, next) {
  const courseId = parseInt(req.params.courseId, 10);
  try {
    await svc.saveCourseReviewsCarousel(courseId, req.body);
    req.flashSuccess('Reviews carousel presentation saved.');
  } catch (err) {
    if (err && err.name === 'CourseReviewsCarouselError') {
      if (err.statusCode === 404) {
        req.flashError('Course not found.');
        return res.redirect('/admin/courses');
      }
      req.flashError(err.message);
    } else {
      return next(err);
    }
  }
  return res.redirect(`/admin/courses/${courseId}/landing-page?tab=reviews`);
}

module.exports = { save };
