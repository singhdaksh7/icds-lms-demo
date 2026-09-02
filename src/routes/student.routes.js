const express = require('express');
const router = express.Router();

const studentController = require('../controllers/student.controller');
const { requireRole } = require('../middleware/auth.middleware');
const { doubleCsrfProtection } = require('../config/csrf');
const { certificateRateLimit } = require('../middleware/phase6RateLimit');

router.use(requireRole('STUDENT'));

router.get('/dashboard', studentController.getDashboard);
router.get('/profile', studentController.profilePage);
router.post('/profile', doubleCsrfProtection, studentController.updateProfile);
router.get('/security', studentController.securityPage);
router.post('/security/password', doubleCsrfProtection, studentController.changePassword);
router.get('/certificates', studentController.listCertificates);
router.post('/courses/:courseId/certificate', certificateRateLimit, doubleCsrfProtection, studentController.issueCertificate);
router.get('/certificates/:id/download', studentController.downloadCertificate);

router.get('/orders', studentController.listMyOrders);
router.get('/orders/:id', studentController.getMyOrderDetail);

router.post('/lessons/:lessonId/complete', doubleCsrfProtection, studentController.completeLesson);

module.exports = router;
