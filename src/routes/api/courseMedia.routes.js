const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const controller = require('../../controllers/courseMentorVideo.controller');

// Public marketing media; cap signing requests per IP.
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } });

// Course mentor video: signs ONLY courses/<id>/mentor/ keys of that published course while it is the displayed media.
router.get('/:courseId/mentor-video/source', limiter, controller.getCourseMentorVideoSource);

module.exports = router;
