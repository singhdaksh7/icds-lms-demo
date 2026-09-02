const rateLimit = require('express-rate-limit');

// Applied to checkout-order-creation and payment-verification — enough
// headroom for a student retrying a failed card a few times, tight enough
// to blunt abuse. The Razorpay webhook (src/routes/webhook.routes.js) is
// intentionally NOT behind this limiter — Razorpay retries webhooks on
// non-2xx responses, and aggressively throttling it would drop legitimate
// retries.
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many payment attempts. Please try again later.' },
});

module.exports = paymentLimiter;
