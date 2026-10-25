const courseAppearanceService = require('../../services/courseAppearance.service');

function backTo(courseId) {
  return `/admin/courses/${courseId}/landing-page?tab=appearance`;
}

// Wraps a service call: flash success/failure and always land back on the
// Appearance tab. Only CourseAppearanceError messages are shown to the admin.
function handler(successMessage, run) {
  return async (req, res, next) => {
    const courseId = parseInt(req.params.courseId, 10);
    try {
      await run(courseId, req);
      req.flashSuccess(successMessage);
    } catch (err) {
      if (err && err.name === 'CourseAppearanceError') {
        if (err.statusCode === 404) {
          req.flashError('Course not found.');
          return res.redirect('/admin/courses');
        }
        req.flashError(err.message);
      } else {
        return next(err);
      }
    }
    return res.redirect(backTo(courseId));
  };
}

const saveAppearance = handler('Landing page appearance saved.', (courseId, req) =>
  courseAppearanceService.updateCourseAppearance(courseId, req.body));

const resetToPreset = handler('Appearance reset to its preset.', (courseId) =>
  courseAppearanceService.resetToPreset(courseId));

const resetToDefault = handler('Appearance reset to the default theme.', (courseId) =>
  courseAppearanceService.resetAppearance(courseId));

const copyFromCourse = handler('Appearance copied. Only colours, fonts and shapes were copied.', (courseId, req) =>
  courseAppearanceService.copyAppearance(parseInt(req.body.sourceCourseId, 10), courseId));

module.exports = { saveAppearance, resetToPreset, resetToDefault, copyFromCourse };
