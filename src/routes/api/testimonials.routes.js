const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const controller = require('../../controllers/testimonialMedia.controller');

// Public marketing media; cap signing requests per IP.
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } });

router.get('/:id/video-source', limiter, controller.getTestimonialVideoSource);

module.exports = router;
