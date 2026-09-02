const { IS_PRODUCTION } = require('../config/env');

// Centralized error handler. Must be registered last, after all routes.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;

  // Never leak stack traces, DB credentials, or internal details in production.
  if (!IS_PRODUCTION) {
    console.error(err);
  } else {
    console.error(err.message);
  }

  // csrf-csrf throws a plain http-error with code EBADCSRFTOKEN — treat it
  // as a correctable user error (expired/missing form token), not a 500.
  if (err.code === 'EBADCSRFTOKEN') {
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ success: false, error: 'Invalid or expired form submission. Please try again.' });
    }
    if (req.flashError) {
      req.flashError('Your session expired. Please try again.');
    }
    // Referer is attacker-controlled input, so don't redirect to it
    // directly (open-redirect risk) — send the user back somewhere safe.
    return res.redirect('/');
  }

  if (req.path.startsWith('/api/')) {
    return res.status(status).json({
      success: false,
      error: IS_PRODUCTION ? 'Something went wrong.' : err.message,
    });
  }

  res.status(status).render('public/500', {
    pageTitle: 'Something Went Wrong',
    message: IS_PRODUCTION ? 'Something went wrong. Please try again.' : err.message,
  });
}

module.exports = errorHandler;
