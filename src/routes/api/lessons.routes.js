const express = require('express');
const router = express.Router();

const mediaController = require('../../controllers/media.controller');

// Authenticated, enrollment-protected. Returns a short-lived signed URL only.
router.get('/:lessonId/video-source', mediaController.getLessonVideoSource);

module.exports = router;
