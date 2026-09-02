const express = require('express');
const router = express.Router();

const webhookController = require('../controllers/webhook.controller');

// express.raw() here is what preserves the exact request bytes Razorpay
// signed — this route MUST be mounted in server.js before the app's global
// express.json()/express.urlencoded(), or the body would already be parsed
// (and re-serializing it for verification would not reliably match the
// original bytes byte-for-byte).
//
// Deliberately NOT session/CSRF-protected: Razorpay's webhook has no
// session cookie to send, and authenticity comes entirely from the
// signature verified inside the controller.
router.post('/razorpay', express.raw({ type: 'application/json', limit: '1mb' }), webhookController.handleRazorpayWebhook);

module.exports = router;
