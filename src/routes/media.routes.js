const express = require('express');
const router = express.Router();

const mediaController = require('../controllers/media.controller');

router.get('/lessons/:lessonId/video', mediaController.getLessonVideo);
router.head('/lessons/:lessonId/video', mediaController.getLessonVideo);

module.exports = router;
