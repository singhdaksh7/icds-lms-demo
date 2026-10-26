// Admin routes for the per-course mentor photo / video (Landing Page -> Mentor Display). Mounted inside the
// authenticated admin router (src/routes/admin.routes.js) at '/', so paths are relative to /admin.
const express = require('express');
const router = express.Router();
const { doubleCsrfProtection } = require('../config/csrf');
const { uploadCourseMentorMedia } = require('../middleware/courseMentorMediaUpload.middleware');
const controller = require('../controllers/admin/courseMentorMedia.controller');

// Multipart: the upload middleware runs BEFORE csrf so the token inside the multipart body is readable
// (same arrangement as the doctor media / intro video / testimonial media routes).
router.post('/courses/:courseId/mentor-media', uploadCourseMentorMedia(), doubleCsrfProtection, controller.save);
// Back to the default look (deletes this course's mentor media row).
router.post('/courses/:courseId/mentor-media/reset', doubleCsrfProtection, controller.reset);

module.exports = router;
