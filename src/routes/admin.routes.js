const express = require('express');
const router = express.Router();

const { requireRole } = require('../middleware/auth.middleware');
const { doubleCsrfProtection } = require('../config/csrf');
const {
  loadLessonForVideo,
  loadCourseForVideo,
  uploadLessonVideo,
  uploadLessonVideoForCreate,
  parseLessonUpdateFields,
} = require('../middleware/videoUpload.middleware');
const { uploadThumbnail } = require('../middleware/thumbnailUpload.middleware');
const { uploadSiteImages } = require('../middleware/siteImageUpload.middleware');
const { uploadCertificatePdf } = require('../middleware/certificateUpload.middleware');

const dashboardController = require('../controllers/admin/dashboard.controller');
const courseController = require('../controllers/admin/course.controller');
const categoryController = require('../controllers/admin/category.controller');
const instructorController = require('../controllers/admin/instructor.controller');
const lessonController = require('../controllers/admin/lesson.controller');
const studentController = require('../controllers/admin/student.controller');
const orderController = require('../controllers/admin/order.controller');
const engagementController = require('../controllers/admin/engagement.controller');
const enrollmentRequestController = require('../controllers/admin/enrollmentRequest.controller');
const faqController = require('../controllers/admin/faq.controller');
const siteContentController = require('../controllers/admin/siteContent.controller');
const reviewController = require('../controllers/admin/review.controller');
const certificateController = require('../controllers/admin/certificate.controller');

// Every route in this file is admin-only — enforced once here rather than
// repeated per-route, so it's impossible to accidentally add an
// unprotected admin route.
router.use(requireRole('ADMIN'));

// Numeric route params are validated before any controller/Prisma call (and
// before multer on upload routes), so a malformed or out-of-range id such as
// /admin/courses/abc/edit is a clean 404 instead of a Prisma error -> 500.
const MAX_INT32 = 2147483647;
function requireNumericId(req, res, next, value) {
  if (!/^\d{1,10}$/.test(value) || Number(value) < 1 || Number(value) > MAX_INT32) {
    return res.status(404).render('public/404', { pageTitle: 'Not Found' });
  }
  return next();
}
['id', 'courseId', 'lessonId'].forEach((name) => router.param(name, requireNumericId));

router.get('/', dashboardController.getDashboard);

// --- Courses ---------------------------------------------------------------
router.get('/courses', courseController.listCourses);
router.get('/courses/new', courseController.newCourseForm);
router.post('/courses', doubleCsrfProtection, courseController.createCourse);
router.get('/courses/:id/edit', courseController.editCourseForm);
router.post('/courses/:id', doubleCsrfProtection, courseController.updateCourse);
router.post(
  '/courses/:id/thumbnail/upload',
  uploadThumbnail((req) => `/admin/courses/${req.params.id}/edit`),
  doubleCsrfProtection,
  courseController.uploadCourseThumbnail
);
router.post('/courses/:id/thumbnail/remove', doubleCsrfProtection, courseController.removeCourseThumbnail);
router.post('/courses/:id/delete', doubleCsrfProtection, courseController.deleteCourse);
router.post('/courses/:id/publish', doubleCsrfProtection, courseController.publishCourse);
router.post('/courses/:id/unpublish', doubleCsrfProtection, courseController.unpublishCourse);

// --- Lessons (nested under a course) ---------------------------------------
router.get('/courses/:courseId/lessons', lessonController.listLessons);
router.get('/courses/:courseId/lessons/new', lessonController.newLessonForm);
router.post(
  '/courses/:courseId/lessons',
  loadCourseForVideo,
  uploadLessonVideoForCreate,
  doubleCsrfProtection,
  lessonController.createLesson
);
router.get('/lessons/:id/edit', lessonController.editLessonForm);
router.post(
  '/lessons/:id',
  parseLessonUpdateFields,
  doubleCsrfProtection,
  lessonController.updateLesson
);
router.post('/lessons/:id/delete', doubleCsrfProtection, lessonController.deleteLesson);

// --- Local (Hostinger-hosted) lesson video ----------------------------------
router.post(
  '/lessons/:id/video/upload',
  loadLessonForVideo,
  uploadLessonVideo,
  doubleCsrfProtection,
  lessonController.uploadLessonVideo
);
router.post(
  '/lessons/:id/video/register',
  doubleCsrfProtection,
  lessonController.registerLessonVideo
);
router.post(
  '/lessons/:id/video/remove',
  doubleCsrfProtection,
  lessonController.removeLessonVideo
);

// --- Categories --------------------------------------------------------------
router.get('/categories', categoryController.listCategories);
router.post('/categories', doubleCsrfProtection, categoryController.createCategory);
router.post('/categories/:id', doubleCsrfProtection, categoryController.updateCategory);
router.post(
  '/categories/:id/image/upload',
  uploadThumbnail('/admin/categories'),
  doubleCsrfProtection,
  categoryController.uploadCategoryImage
);
router.post('/categories/:id/image/remove', doubleCsrfProtection, categoryController.removeCategoryImage);
router.post('/categories/:id/delete', doubleCsrfProtection, categoryController.deleteCategory);

// --- Instructors -------------------------------------------------------------
router.get('/instructors', instructorController.listInstructors);
router.get('/instructors/new', instructorController.newInstructorForm);
router.post('/instructors', doubleCsrfProtection, instructorController.createInstructor);
router.get('/instructors/:id/edit', instructorController.editInstructorForm);
router.post('/instructors/:id', doubleCsrfProtection, instructorController.updateInstructor);
router.post(
  '/instructors/:id/photo/upload',
  uploadThumbnail((req) => `/admin/instructors/${req.params.id}/edit`),
  doubleCsrfProtection,
  instructorController.uploadInstructorPhoto
);
router.post('/instructors/:id/photo/remove', doubleCsrfProtection, instructorController.removeInstructorPhoto);
router.post('/instructors/:id/delete', doubleCsrfProtection, instructorController.deleteInstructor);

// --- Students / manual enrollment --------------------------------------------
router.get('/students', studentController.listStudents);
router.get('/students/:id', studentController.getStudentDetail);
router.post('/students/:id/enroll', doubleCsrfProtection, studentController.enrollStudent);
router.post('/students/:id/unenroll', doubleCsrfProtection, studentController.unenrollStudent);

// --- Orders (read-only — payment state only ever comes from verified
// Razorpay events, never a manual admin override) ---------------------------
router.get('/orders', orderController.listOrders);
router.get('/orders/:id', orderController.getOrderDetail);
router.get('/enrollment-requests', enrollmentRequestController.listRequests);
router.post('/enrollment-requests/:id/approve', doubleCsrfProtection, enrollmentRequestController.approveRequest);
router.post('/enrollment-requests/:id/status', doubleCsrfProtection, enrollmentRequestController.updateStatus);
// --- Site Content (all public-page copy, images and SEO) ----------------------
// Each form saves independently to /site-content/:tab/:form. Multipart parsing
// (images) runs BEFORE CSRF protection so the token in the multipart body is
// available, mirroring the thumbnail/video upload routes.
router.param('tab', siteContentController.resolveTab);
router.param('form', siteContentController.resolveForm);
router.get('/site-content', siteContentController.index);
router.get('/site-content/:tab', siteContentController.showTab);
router.post(
  '/site-content/:tab/:form',
  uploadSiteImages((req) => `/admin/site-content/${req.params.tab}`),
  doubleCsrfProtection,
  siteContentController.saveForm
);
router.get('/settings', siteContentController.legacyRedirect);

router.get('/faqs', faqController.listFaqs);
router.post('/faqs', doubleCsrfProtection, faqController.createFaq);
router.post('/faqs/:id', doubleCsrfProtection, faqController.updateFaq);
router.post('/faqs/:id/delete', doubleCsrfProtection, faqController.deleteFaq);

router.get('/reviews', reviewController.listReviews);
router.post('/reviews/:id/status', doubleCsrfProtection, reviewController.updateReviewStatus);
router.post('/reviews/:id/delete', doubleCsrfProtection, reviewController.deleteReview);

// --- Certificates (list, admin-issued override, revoke/restore, download) -----
// Multipart parsing (optional PDF) runs BEFORE CSRF so the token in the
// multipart body is available.
router.get('/certificates', certificateController.listCertificates);
router.post(
  '/certificates',
  uploadCertificatePdf('/admin/certificates'),
  doubleCsrfProtection,
  certificateController.issueCertificate
);
router.get('/certificates/:id/download', certificateController.downloadCertificate);
router.post('/certificates/:id/revoke', doubleCsrfProtection, certificateController.revokeCertificate);
router.post('/certificates/:id/restore', doubleCsrfProtection, certificateController.restoreCertificate);
router.get('/newsletter', engagementController.newsletter);
router.get('/messages', engagementController.messages);
router.get('/messages/:id', engagementController.messageDetail);
router.post('/messages/:id/status', doubleCsrfProtection, engagementController.updateMessage);

module.exports = router;
