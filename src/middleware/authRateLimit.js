const rateLimit = require('express-rate-limit');

// Stricter than the app-wide limiter (server.js) — auth endpoints are prime
// targets for credential stuffing / account enumeration, but the limits
// here are still loose enough not to get in the way of normal manual
// testing during development.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many attempts. Please try again later.' },
});

module.exports = authLimiter;
