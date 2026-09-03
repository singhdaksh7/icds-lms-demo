const express = require('express');
const router = express.Router();

const checkoutController = require('../controllers/checkout.controller');
const { requireAuth } = require('../middleware/auth.middleware');
const { doubleCsrfProtection } = require('../config/csrf');
const paymentLimiter = require('../middleware/paymentRateLimit');

router.get('/checkout/:courseSlug', requireAuth, checkoutController.getCheckoutPage);

router.post(
  '/checkout/:courseSlug/create-order',
  requireAuth,
  paymentLimiter,
  doubleCsrfProtection,
  checkoutController.createOrder
);

router.post(
  '/courses/:slug/enroll-free',
  requireAuth,
  doubleCsrfProtection,
  checkoutController.enrollFree
);

router.post(
  '/courses/:slug/request-enrollment',
  requireAuth,
  doubleCsrfProtection,
  checkoutController.requestEnrollment
);

module.exports = router;
