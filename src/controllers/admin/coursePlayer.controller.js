const playerSettingsService = require('../../services/coursePlayerSettings.service');

const back = (courseId) => `/admin/courses/${courseId}/landing-page?tab=player`;

// Wraps a service call: flash the result and always land back on the Player tab.
function handler(successMessage, run) {
  return async (req, res, next) => {
    const courseId = parseInt(req.params.courseId, 10);
    try {
      await run(courseId, req);
      req.flashSuccess(successMessage);
    } catch (err) {
      if (err && err.name === 'CoursePlayerSettingsError') {
        if (err.statusCode === 404) {
          req.flashError('Course not found.');
          return res.redirect('/admin/courses');
        }
        req.flashError(err.message);
      } else {
        return next(err);
      }
    }
    return res.redirect(back(courseId));
  };
}

// Patch-style save: only the fields present in the POST body are changed.
const savePlayerSettings = handler('Player settings saved.', (courseId, req) =>
  playerSettingsService.updatePlayerSettings(courseId, req.body || {}));

const resetPlayerSettings = handler('Player settings reset to the defaults.', (courseId) =>
  playerSettingsService.resetPlayerSettings(courseId));

module.exports = { savePlayerSettings, resetPlayerSettings };
