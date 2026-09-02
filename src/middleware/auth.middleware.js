const { safeRedirectPath } = require('../lib/safeRedirect');

// Authorization must be enforced server-side; hidden frontend links are not
// a security boundary.

function requireAuth(req, res, next) {
  if (req.currentUser) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, error: 'Authentication required.' });
  }

  if (req.flashError) {
    req.flashError('You must log in to continue.');
  }

  const returnTo = safeRedirectPath(req.originalUrl, '/');
  res.redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

function requireGuest(req, res, next) {
  if (!req.currentUser) {
    return next();
  }

  res.redirect(req.currentUser.role === 'ADMIN' ? '/admin' : '/student/dashboard');
}

function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.currentUser) {
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ success: false, error: 'Authentication required.' });
      }
      const returnTo = safeRedirectPath(req.originalUrl, '/');
      return res.redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    }

    if (!roles.includes(req.currentUser.role)) {
      if (req.path.startsWith('/api/')) {
        return res.status(403).json({ success: false, error: 'Forbidden.' });
      }
      return res.status(403).render('public/403', {
        pageTitle: 'Access Denied',
      });
    }

    next();
  };
}

module.exports = { requireAuth, requireGuest, requireRole };
