const express = require('express');
const router = express.Router();

const learnController = require('../controllers/learn.controller');

// No blanket auth middleware here — preview lessons must stay reachable by
// anonymous visitors. Each controller enforces access itself (course
// overview always requires auth + enrollment; the lesson page allows
// anonymous/non-enrolled access only when lesson.preview is true).
router.get('/:courseSlug', learnController.getCourseOverview);
router.get('/:courseSlug/:lessonSlug', learnController.getLessonPage);

module.exports = router;
