// Admin routes for the doctor photo / video. Mounted inside the authenticated admin router
// (src/routes/admin.routes.js) at '/', so paths are relative to /admin.
const express = require('express');
const router = express.Router();
const { doubleCsrfProtection } = require('../config/csrf');
const { uploadDoctorMedia } = require('../middleware/doctorMediaUpload.middleware');
const doctorMediaController = require('../controllers/admin/doctorMedia.controller');

router.get('/doctor-media', doctorMediaController.show);
// Multipart: the upload middleware runs BEFORE csrf so the token inside the multipart body is readable
// (same arrangement as the intro video / banners / testimonial media routes).
router.post('/doctor-media', uploadDoctorMedia(), doubleCsrfProtection, doctorMediaController.save);

module.exports = router;
