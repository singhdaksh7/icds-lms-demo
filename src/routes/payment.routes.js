const express = require('express');
const router = express.Router();

const paymentController = require('../controllers/payment.controller');
const { requireAuth } = require('../middleware/auth.middleware');
const { doubleCsrfProtection } = require('../config/csrf');
const paymentLimiter = require('../middleware/paymentRateLimit');

router.post(
  '/payments/razorpay/verify',
  requireAuth,
  paymentLimiter,
  doubleCsrfProtection,
  paymentController.verifyPayment
);

router.get('/payment/success/:orderId', requireAuth, paymentController.getPaymentSuccess);
router.get('/payment/failed/:orderId', requireAuth, paymentController.getPaymentFailed);

module.exports = router;
