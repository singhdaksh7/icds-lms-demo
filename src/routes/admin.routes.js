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
const invoiceController = require('../controllers/invoice.controller');
const taxSettingsController = require('../controllers/admin/taxSettings.controller');
const paymentSettingsController = require('../controllers/admin/paymentSettings.controller');
const emailSettingsController = require('../controllers/admin/emailSettings.controller');
const paymentLimiter = require('../middleware/paymentRateLimit');
const videoStorageController = require('../controllers/admin/videoStorage.controller');
const r2UploadController = require('../controllers/admin/r2Upload.controller');

const homeBannerController = require('../controllers/admin/homeBanner.controller');
const homeReviewsController = require('../controllers/admin/homeReviews.controller');
const founderAdminController = require('../controllers/admin/founder.controller');
const { uploadBannerImages } = require('../middleware/bannerUpload.middleware');
const { uploadTestimonialMedia } = require('../middleware/testimonialMedia.middleware');

const curriculumController = require('../controllers/admin/curriculum.controller');
const courseLandingController = require('../controllers/admin/courseLanding.controller');
const courseAppearanceController = require('../controllers/admin/courseAppearance.controller');

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
['id', 'courseId', 'lessonId', 'moduleId', 'topicId', 'resourceId', 'chipId', 'takeawayId', 'questionId', 'itemId', 'faqId', 'highlightId', 'testimonialId', 'planId', 'statId', 'columnId', 'stepId', 'sectionId'].forEach((name) => router.param(name, requireNumericId));

router.get('/', dashboardController.getDashboard);

// --- Course Landing Page / Marketing Content CMS --------------------------
router.get('/courses/:courseId/landing-page', courseLandingController.getLandingEditor);
router.get('/courses/:courseId/landing-page/preview', courseLandingController.previewLanding);
router.post('/courses/:courseId/landing-page/settings', doubleCsrfProtection, courseLandingController.saveSettings);

router.post('/courses/:courseId/landing-page/chips', doubleCsrfProtection, courseLandingController.createChip);
router.post('/courses/:courseId/landing-page/chips/:chipId/edit', doubleCsrfProtection, courseLandingController.updateChip);
router.post('/courses/:courseId/landing-page/chips/:chipId/delete', doubleCsrfProtection, courseLandingController.deleteChip);
router.post('/courses/:courseId/landing-page/chips/:chipId/move', doubleCsrfProtection, courseLandingController.moveChip);

router.post('/courses/:courseId/landing-page/takeaways', doubleCsrfProtection, courseLandingController.createTakeaway);
router.post('/courses/:courseId/landing-page/takeaways/:takeawayId/edit', doubleCsrfProtection, courseLandingController.updateTakeaway);
router.post('/courses/:courseId/landing-page/takeaways/:takeawayId/delete', doubleCsrfProtection, courseLandingController.deleteTakeaway);
router.post('/courses/:courseId/landing-page/takeaways/:takeawayId/move', doubleCsrfProtection, courseLandingController.moveTakeaway);

router.post('/courses/:courseId/landing-page/questions', doubleCsrfProtection, courseLandingController.createQuestion);
router.post('/courses/:courseId/landing-page/questions/:questionId/edit', doubleCsrfProtection, courseLandingController.updateQuestion);
router.post('/courses/:courseId/landing-page/questions/:questionId/delete', doubleCsrfProtection, courseLandingController.deleteQuestion);
router.post('/courses/:courseId/landing-page/questions/:questionId/move', doubleCsrfProtection, courseLandingController.moveQuestion);

router.post('/courses/:courseId/landing-page/audience', doubleCsrfProtection, courseLandingController.createAudienceItem);
router.post('/courses/:courseId/landing-page/audience/:itemId/edit', doubleCsrfProtection, courseLandingController.updateAudienceItem);
router.post('/courses/:courseId/landing-page/audience/:itemId/delete', doubleCsrfProtection, courseLandingController.deleteAudienceItem);
router.post('/courses/:courseId/landing-page/audience/:itemId/move', doubleCsrfProtection, courseLandingController.moveAudienceItem);

router.post('/courses/:courseId/landing-page/faqs', doubleCsrfProtection, courseLandingController.createFaq);
router.post('/courses/:courseId/landing-page/faqs/:faqId/edit', doubleCsrfProtection, courseLandingController.updateFaq);
router.post('/courses/:courseId/landing-page/faqs/:faqId/delete', doubleCsrfProtection, courseLandingController.deleteFaq);
router.post('/courses/:courseId/landing-page/faqs/:faqId/move', doubleCsrfProtection, courseLandingController.moveFaq);

router.post('/courses/:courseId/landing-page/why-register', doubleCsrfProtection, courseLandingController.createWhyRegisterItem);
router.post('/courses/:courseId/landing-page/why-register/:itemId/edit', doubleCsrfProtection, courseLandingController.updateWhyRegisterItem);
router.post('/courses/:courseId/landing-page/why-register/:itemId/delete', doubleCsrfProtection, courseLandingController.deleteWhyRegisterItem);
router.post('/courses/:courseId/landing-page/why-register/:itemId/move', doubleCsrfProtection, courseLandingController.moveWhyRegisterItem);

router.post('/courses/:courseId/landing-page/highlights', doubleCsrfProtection, courseLandingController.createHighlight);
router.post('/courses/:courseId/landing-page/highlights/:highlightId/edit', doubleCsrfProtection, courseLandingController.updateHighlight);
router.post('/courses/:courseId/landing-page/highlights/:highlightId/delete', doubleCsrfProtection, courseLandingController.deleteHighlight);
router.post('/courses/:courseId/landing-page/highlights/:highlightId/move', doubleCsrfProtection, courseLandingController.moveHighlight);

// Review forms are multipart (optional video + thumbnail); parsed BEFORE CSRF so the body token is readable.
router.post('/courses/:courseId/landing-page/reviews', uploadTestimonialMedia(), doubleCsrfProtection, courseLandingController.createTestimonial);
router.post('/courses/:courseId/landing-page/reviews/:testimonialId/edit', uploadTestimonialMedia(), doubleCsrfProtection, courseLandingController.updateTestimonial);
router.post('/courses/:courseId/landing-page/reviews/:testimonialId/delete', doubleCsrfProtection, courseLandingController.deleteTestimonial);
router.post('/courses/:courseId/landing-page/reviews/:testimonialId/move', doubleCsrfProtection, courseLandingController.moveTestimonial);

router.post('/courses/:courseId/landing-page/access-plans', doubleCsrfProtection, courseLandingController.createAccessPlan);
router.post('/courses/:courseId/landing-page/access-plans/:planId/edit', doubleCsrfProtection, courseLandingController.updateAccessPlan);
router.post('/courses/:courseId/landing-page/access-plans/:planId/delete', doubleCsrfProtection, courseLandingController.deleteAccessPlan);
router.post('/courses/:courseId/landing-page/access-plans/:planId/move', doubleCsrfProtection, courseLandingController.moveAccessPlan);

router.post('/courses/:courseId/landing-page/stats', doubleCsrfProtection, courseLandingController.createStat);
router.post('/courses/:courseId/landing-page/stats/:statId/edit', doubleCsrfProtection, courseLandingController.updateStat);
router.post('/courses/:courseId/landing-page/stats/:statId/delete', doubleCsrfProtection, courseLandingController.deleteStat);
router.post('/courses/:courseId/landing-page/stats/:statId/move', doubleCsrfProtection, courseLandingController.moveStat);

router.post('/courses/:courseId/landing-page/comparison-columns', doubleCsrfProtection, courseLandingController.createComparisonColumn);
router.post('/courses/:courseId/landing-page/comparison-columns/:columnId/edit', doubleCsrfProtection, courseLandingController.updateComparisonColumn);
router.post('/courses/:courseId/landing-page/comparison-columns/:columnId/delete', doubleCsrfProtection, courseLandingController.deleteComparisonColumn);
router.post('/courses/:courseId/landing-page/comparison-columns/:columnId/move', doubleCsrfProtection, courseLandingController.moveComparisonColumn);

router.post('/courses/:courseId/landing-page/comparison-columns/:columnId/items', doubleCsrfProtection, courseLandingController.createComparisonItem);
router.post('/courses/:courseId/landing-page/comparison-items/:itemId/edit', doubleCsrfProtection, courseLandingController.updateComparisonItem);
router.post('/courses/:courseId/landing-page/comparison-items/:itemId/delete', doubleCsrfProtection, courseLandingController.deleteComparisonItem);
router.post('/courses/:courseId/landing-page/comparison-items/:itemId/move', doubleCsrfProtection, courseLandingController.moveComparisonItem);

router.post('/courses/:courseId/landing-page/access-steps', doubleCsrfProtection, courseLandingController.createAccessStep);
router.post('/courses/:courseId/landing-page/access-steps/:stepId/edit', doubleCsrfProtection, courseLandingController.updateAccessStep);
router.post('/courses/:courseId/landing-page/access-steps/:stepId/delete', doubleCsrfProtection, courseLandingController.deleteAccessStep);
router.post('/courses/:courseId/landing-page/access-steps/:stepId/move', doubleCsrfProtection, courseLandingController.moveAccessStep);

router.post('/courses/:courseId/landing-page/appearance', doubleCsrfProtection, courseAppearanceController.saveAppearance);
router.post('/courses/:courseId/landing-page/appearance/reset-preset', doubleCsrfProtection, courseAppearanceController.resetToPreset);
router.post('/courses/:courseId/landing-page/appearance/reset-default', doubleCsrfProtection, courseAppearanceController.resetToDefault);
router.post('/courses/:courseId/landing-page/appearance/copy', doubleCsrfProtection, courseAppearanceController.copyFromCourse);

router.post('/courses/:courseId/landing-page/sections/:sectionKey/toggle', doubleCsrfProtection, courseLandingController.toggleSection);
router.post('/courses/:courseId/landing-page/sections/:sectionKey/move', doubleCsrfProtection, courseLandingController.moveSection);

// --- Homepage CMS: banners + reviews ------------------------------------------
// Banner multipart parsing runs BEFORE CSRF so the token in the multipart body
// is available (same as thumbnail/site-content uploads).
router.get('/homepage', (req, res) => res.redirect('/admin/homepage/banners'));
router.get('/homepage/banners', homeBannerController.list);
router.get('/homepage/banners/new', homeBannerController.newForm);
router.post('/homepage/banners', uploadBannerImages('/admin/homepage/banners/new'), doubleCsrfProtection, homeBannerController.create);
router.get('/homepage/banners/:id/edit', homeBannerController.editForm);
router.post('/homepage/banners/:id', uploadBannerImages((req) => `/admin/homepage/banners/${req.params.id}/edit`), doubleCsrfProtection, homeBannerController.update);
router.post('/homepage/banners/:id/toggle', doubleCsrfProtection, homeBannerController.toggle);
router.post('/homepage/banners/:id/move', doubleCsrfProtection, homeBannerController.move);
router.post('/homepage/banners/:id/delete', doubleCsrfProtection, homeBannerController.remove);

router.get('/homepage/reviews', homeReviewsController.show);
router.post('/homepage/reviews/settings', doubleCsrfProtection, homeReviewsController.saveSettings);
router.post('/homepage/reviews/:id/feature', doubleCsrfProtection, homeReviewsController.feature);
router.post('/homepage/reviews/:id/move', doubleCsrfProtection, homeReviewsController.move);

// --- Founder page CMS -----------------------------------------------------------
// :entity is whitelisted in founderAdmin.service (qualifications, timeline,
// initiatives, stats, faqs, research); :key against the section key list.
router.get('/founder', founderAdminController.show);
router.post('/founder/profile', doubleCsrfProtection, founderAdminController.saveProfile);
router.post('/founder/sections/:key/toggle', doubleCsrfProtection, founderAdminController.toggleSection);
router.post('/founder/sections/:key/move', doubleCsrfProtection, founderAdminController.moveSection);
router.post('/founder/items/:entity', doubleCsrfProtection, founderAdminController.createItem);
router.post('/founder/items/:entity/:id/edit', doubleCsrfProtection, founderAdminController.updateItem);
router.post('/founder/items/:entity/:id/delete', doubleCsrfProtection, founderAdminController.deleteItem);
router.post('/founder/items/:entity/:id/toggle', doubleCsrfProtection, founderAdminController.togglePublished);
router.post('/founder/items/:entity/:id/move', doubleCsrfProtection, founderAdminController.moveItem);

// --- Curriculum Builder (Modules, Topics, Reorder, Resources) --------------
router.get('/courses/:courseId/curriculum', curriculumController.getCurriculumBuilder);
router.post('/courses/:courseId/curriculum/modules', doubleCsrfProtection, curriculumController.createModule);
router.post('/courses/:courseId/curriculum/modules/:moduleId/edit', doubleCsrfProtection, curriculumController.updateModule);
router.post('/courses/:courseId/curriculum/modules/:moduleId/delete', doubleCsrfProtection, curriculumController.deleteModule);
router.post('/courses/:courseId/curriculum/modules/reorder', doubleCsrfProtection, curriculumController.reorderModules);

router.post('/courses/:courseId/curriculum/topics', doubleCsrfProtection, curriculumController.createTopic);
router.post('/courses/:courseId/curriculum/topics/:topicId/edit', doubleCsrfProtection, curriculumController.updateTopic);
router.post('/courses/:courseId/curriculum/topics/:topicId/delete', doubleCsrfProtection, curriculumController.deleteTopic);
router.post('/courses/:courseId/curriculum/topics/:topicId/move', doubleCsrfProtection, curriculumController.moveTopic);
router.post('/courses/:courseId/curriculum/topics/reorder', doubleCsrfProtection, curriculumController.reorderTopics);

router.post('/courses/:courseId/curriculum/lessons/move', doubleCsrfProtection, curriculumController.moveLesson);
router.post('/courses/:courseId/curriculum/lessons/reorder', doubleCsrfProtection, curriculumController.reorderLessons);

router.post('/courses/:courseId/curriculum/resources', doubleCsrfProtection, curriculumController.createResource);
router.post('/courses/:courseId/curriculum/resources/:resourceId/edit', doubleCsrfProtection, curriculumController.updateResource);
router.post('/courses/:courseId/curriculum/resources/:resourceId/delete', doubleCsrfProtection, curriculumController.deleteResource);
router.get('/courses/:courseId/curriculum/resources/:resourceId/download', curriculumController.adminDownloadResource);

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

router.post(
  '/lessons/:id/video/migrate-r2',
  doubleCsrfProtection,
  lessonController.migrateLessonVideoToR2
);

// Direct browser -> R2 multipart upload (JSON; CSRF token in the JSON body).
router.post('/lessons/:id/video/r2/start', doubleCsrfProtection, r2UploadController.start);
router.post('/lessons/:id/video/r2/part-urls', doubleCsrfProtection, r2UploadController.partUrls);
router.post('/lessons/:id/video/r2/complete', doubleCsrfProtection, r2UploadController.complete);
router.post('/lessons/:id/video/r2/abort', doubleCsrfProtection, r2UploadController.abort);

// --- Video Storage (LOCAL / Cloudflare R2) ------------------------------------
router.get('/video-storage', videoStorageController.showPage);
router.post('/video-storage', doubleCsrfProtection, videoStorageController.saveSettings);
router.post('/video-storage/test', doubleCsrfProtection, videoStorageController.testConnection);

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
router.post('/instructors/:id/credentials', doubleCsrfProtection, instructorController.createCredential);
router.post('/instructors/:id/credentials/:credId/edit', doubleCsrfProtection, instructorController.updateCredential);
router.post('/instructors/:id/credentials/:credId/delete', doubleCsrfProtection, instructorController.deleteCredential);
router.post('/instructors/:id/credentials/:credId/move', doubleCsrfProtection, instructorController.moveCredential);

// --- Students / manual enrollment --------------------------------------------
router.get('/students', studentController.listStudents);
router.get('/students/:id', studentController.getStudentDetail);
router.post('/students/:id/enroll', doubleCsrfProtection, studentController.enrollStudent);
router.post('/students/:id/unenroll', doubleCsrfProtection, studentController.unenrollStudent);

// --- Orders (read-only — payment state only ever comes from verified
// Razorpay events, never a manual admin override) ---------------------------
router.get('/orders', orderController.listOrders);
router.get('/orders/:id', orderController.getOrderDetail);
router.get('/orders/:id/invoice.pdf', invoiceController.adminInvoice);
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

// --- Tax (GST) & invoice design --------------------------------------------
router.get('/tax-settings', taxSettingsController.showPage);
router.post('/tax-settings', doubleCsrfProtection, taxSettingsController.save);
router.get('/tax-settings/preview.pdf', invoiceController.adminPreview);

// --- Payment (Razorpay) settings -------------------------------------------
// Secrets are write-only (stored encrypted, never rendered). Live keys need
// an explicit confirmation tick before payments can be enabled.
router.get('/payment-settings', paymentSettingsController.showPage);
router.post('/payment-settings', doubleCsrfProtection, paymentSettingsController.save);
router.post('/payment-settings/reset', doubleCsrfProtection, paymentSettingsController.reset);
router.post('/payment-settings/test', paymentLimiter, doubleCsrfProtection, paymentSettingsController.testConnection);

// --- Email (SMTP) settings -------------------------------------------------
// Admin-managed SMTP. The password is write-only (stored encrypted, never
// rendered). Razorpay credentials are NOT editable here - server-managed.
router.get('/email-settings', emailSettingsController.showPage);
router.post('/email-settings', doubleCsrfProtection, emailSettingsController.save);
router.post('/email-settings/reset', doubleCsrfProtection, emailSettingsController.reset);
router.post('/email-settings/test', paymentLimiter, doubleCsrfProtection, emailSettingsController.sendTest);

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
router.post('/messages/:id/delete', doubleCsrfProtection, engagementController.deleteMessage);

// Feature-area routers (student player, homepage media/sections/reviews, pages/navigation/FAQ).
router.use(require('./adminPlayer.routes'));
router.use(require('./adminHomeMedia.routes'));
router.use(require('./adminPages.routes'));

module.exports = router;
