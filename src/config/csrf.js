// CSRF protection for state-changing session-cookie form submissions
// (double-submit cookie pattern).
//
// The token is bound to a per-browser "anchor" id rather than req.session.id.
// Session security (section 10) requires saveUninitialized: false, which
// means an untouched session (e.g. just viewing the login page) is never
// persisted — its id can therefore change between the GET that renders the
// form and the POST that submits it, which would make a session-id-bound
// token fail even for a legitimate submission. The anchor cookie is set
// unconditionally on first visit, independent of session persistence, so
// the identifier stays stable across that GET -> POST round trip.
const crypto = require('crypto');
const { doubleCsrf } = require('csrf-csrf');
const { IS_PRODUCTION, SESSION_SECRET, SESSION_MAX_AGE_MS } = require('./env');

const ANCHOR_COOKIE_NAME = IS_PRODUCTION ? '__Host-icds.anchor' : 'icds.anchor';

function getOrCreateAnchor(req, res) {
  const existing = req.cookies && req.cookies[ANCHOR_COOKIE_NAME];
  if (existing) {
    return existing;
  }

  const anchor = crypto.randomBytes(16).toString('hex');
  res.cookie(ANCHOR_COOKIE_NAME, anchor, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  });
  return anchor;
}

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => SESSION_SECRET,
  getSessionIdentifier: (req) => getOrCreateAnchor(req, req.res),
  cookieName: IS_PRODUCTION ? '__Host-icds.csrf' : 'icds.csrf',
  cookieOptions: {
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    httpOnly: true,
    path: '/',
  },
  getCsrfTokenFromRequest: (req) => req.body && req.body._csrf,
});

// Expose a fresh token to every view via res.locals.csrfToken so EJS forms
// can render <input type="hidden" name="_csrf" value="<%= csrfToken %>">.
function exposeCsrfToken(req, res, next) {
  res.locals.csrfToken = generateCsrfToken(req, res);
  next();
}

module.exports = { doubleCsrfProtection, exposeCsrfToken };
