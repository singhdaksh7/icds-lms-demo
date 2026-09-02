// Guards the temporary /internal/diagnostics/* routes. Deliberately not
// session/admin-based — see DIAGNOSTIC_TOKEN's comment in src/config/env.js
// for why. Disabled entirely (404) when DIAGNOSTIC_TOKEN is unset, so
// forgetting to unset it in a non-diagnostic environment is the only way
// to leave this reachable.
const crypto = require('crypto');
const { DIAGNOSTIC_TOKEN } = require('../config/env');

function timingSafeEquals(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still run a comparison of equal length to avoid a length-based
    // timing signal, then report unequal.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireDiagnosticToken(req, res, next) {
  if (!DIAGNOSTIC_TOKEN) {
    return res.status(404).end();
  }

  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token || !timingSafeEquals(token, DIAGNOSTIC_TOKEN)) {
    return res.status(404).end(); // 404, not 401/403 — don't confirm the route exists
  }

  next();
}

module.exports = { requireDiagnosticToken };
