// Minimal session-based flash messages (success/error), read-once.
// Avoids pulling in connect-flash for two message kinds.
function flashMiddleware(req, res, next) {
  const stored = req.session.flash || {};
  req.session.flash = {};

  res.locals.flash = {
    success: stored.success || null,
    error: stored.error || null,
  };

  req.flashSuccess = (message) => {
    req.session.flash = req.session.flash || {};
    req.session.flash.success = message;
  };

  req.flashError = (message) => {
    req.session.flash = req.session.flash || {};
    req.session.flash.error = message;
  };

  next();
}

module.exports = flashMiddleware;
