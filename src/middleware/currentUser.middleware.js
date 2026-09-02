const { getSafeUserById } = require('../services/auth.service');

// Loads the authenticated user from the database based on session.userId
// and exposes only UI-safe fields as res.locals.currentUser, so every EJS
// view (navbar included) can react to auth state without touching the
// session directly.
async function currentUser(req, res, next) {
  res.locals.currentUser = null;

  if (!req.session || !req.session.userId) {
    return next();
  }

  try {
    const user = await getSafeUserById(req.session.userId);

    if (!user || user.status !== 'ACTIVE') {
      // Stale/deactivated session identity: drop it rather than trust it.
      req.session.userId = null;
      req.session.role = null;
      return next();
    }

    req.currentUser = user;
    res.locals.currentUser = user;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = currentUser;
