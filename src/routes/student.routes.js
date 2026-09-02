const express = require('express');
const router = express.Router();

const studentController = require('../controllers/student.controller');
const { requireRole } = require('../middleware/auth.middleware');
const { doubleCsrfProtection } = require('../config/csrf');

router.use(requireRole('STUDENT', 'ADMIN'));

router.get('/dashboard', studentController.getDashboard);

router.post('/lessons/:lessonId/complete', doubleCsrfProtection, studentController.completeLesson);

module.exports = router;
