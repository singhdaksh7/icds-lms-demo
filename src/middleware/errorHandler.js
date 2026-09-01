const { IS_PRODUCTION } = require('../config/env');

// Centralized error handler. Must be registered last, after all routes.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;

  // Never leak stack traces, DB credentials, or internal details in production.
  if (!IS_PRODUCTION) {
    console.error(err);
  } else {
    console.error(err.message);
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
