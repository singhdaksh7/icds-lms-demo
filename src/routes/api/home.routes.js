const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const controller = require('../../controllers/introVideo.controller');
const doctorVideoController = require('../../controllers/doctorVideo.controller');

// Public marketing media; cap signing requests per IP.
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } });

router.get('/intro-video/source', limiter, controller.getIntroVideoSource);
// Doctor video (about-the-doctor blocks): signs ONLY site/doctor/ keys while the video is the displayed media.
router.get('/doctor-video/source', limiter, doctorVideoController.getDoctorVideoSource);

module.exports = router;
