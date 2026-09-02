const express = require('express');
const router = express.Router();

const authController = require('../controllers/auth.controller');
const { requireGuest } = require('../middleware/auth.middleware');
const { doubleCsrfProtection } = require('../config/csrf');
const authLimiter = require('../middleware/authRateLimit');

// ---------------------------------------------------------------------------
// Public pages
// ---------------------------------------------------------------------------
router.get('/login', requireGuest, authController.getLoginPage);
router.get('/signup', requireGuest, authController.getSignupPage);
router.get('/forgot-password', requireGuest, authController.getForgotPasswordPage);
router.get('/reset-password/:token', requireGuest, authController.getResetPasswordPage);

// ---------------------------------------------------------------------------
// Actions — all state-changing, so: rate limited + CSRF protected.
// ---------------------------------------------------------------------------
router.post(
  '/auth/signup',
  authLimiter,
  doubleCsrfProtection,
  requireGuest,
  authController.postSignup
);

router.post(
  '/auth/login',
  authLimiter,
  doubleCsrfProtection,
  requireGuest,
  authController.postLogin
);

router.post('/auth/logout', doubleCsrfProtection, authController.postLogout);

router.post(
  '/auth/forgot-password',
  authLimiter,
  doubleCsrfProtection,
  requireGuest,
  authController.postForgotPassword
);

router.post(
  '/auth/reset-password/:token',
  authLimiter,
  doubleCsrfProtection,
  requireGuest,
  authController.postResetPassword
);

module.exports = router;
