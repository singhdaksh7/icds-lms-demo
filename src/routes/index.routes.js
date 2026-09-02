const express = require('express');
const router = express.Router();
const { getHomePage } = require('../controllers/home.controller');
const publicController = require('../controllers/public.controller');
const { doubleCsrfProtection } = require('../config/csrf');
const { newsletterRateLimit, contactRateLimit } = require('../middleware/phase6RateLimit');

router.get('/', getHomePage);
router.get('/contact', publicController.contactPage);
router.post('/contact', contactRateLimit, doubleCsrfProtection, publicController.postContact);
router.post('/newsletter/subscribe', newsletterRateLimit, doubleCsrfProtection, publicController.subscribe);
router.get('/certificates/verify/:certificateNumber', publicController.verifyCertificate);
router.get('/privacy', publicController.privacy);
router.get('/terms', publicController.terms);

module.exports = router;
