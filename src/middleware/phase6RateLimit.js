const rateLimit = require('express-rate-limit');
const formLimiter = (max) => rateLimit({ windowMs: 15 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false, message: 'Please try again later.' });
module.exports = { newsletterRateLimit: formLimiter(10), contactRateLimit: formLimiter(8), certificateRateLimit: formLimiter(20) };
