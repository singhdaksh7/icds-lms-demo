// Admin routes for the homepage media / sections / reviews feature area. Mounted inside the
// authenticated admin router (src/routes/admin.routes.js) at '/', so paths are relative to /admin.
const express = require('express');
const router = express.Router();
const { doubleCsrfProtection } = require('../config/csrf');
const { uploadIntroVideoMedia } = require('../middleware/introVideoUpload.middleware');

const introVideoController = require('../controllers/admin/homeIntroVideo.controller');
const homeSectionsController = require('../controllers/admin/homeSections.controller');
const homeReviewsController = require('../controllers/admin/homeReviews.controller');

// Intro / promo video. Multipart: the upload middleware runs BEFORE csrf so the token inside the
// multipart body is readable (same pattern as banners / testimonials).
router.get('/homepage/intro-video', introVideoController.show);
router.post('/homepage/intro-video', uploadIntroVideoMedia(), doubleCsrfProtection, introVideoController.save);

// Homepage section order + visibility.
router.get('/homepage/sections', homeSectionsController.show);
router.post('/homepage/sections/:key/toggle', doubleCsrfProtection, homeSectionsController.toggle);
router.post('/homepage/sections/:key/move', doubleCsrfProtection, homeSectionsController.move);

// Explicit numeric homepage order for a featured review.
router.post('/homepage/reviews/:id/order', doubleCsrfProtection, homeReviewsController.setOrder);

module.exports = router;
