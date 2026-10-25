// Admin routes for the "Player" feature area (per-course student player
// presentation). Mounted inside the authenticated admin router
// (src/routes/admin.routes.js) at '/', so paths here are relative to /admin.
const express = require('express');
const router = express.Router();
const { doubleCsrfProtection } = require('../config/csrf');
const coursePlayerController = require('../controllers/admin/coursePlayer.controller');

router.post('/courses/:courseId/player-settings', doubleCsrfProtection, coursePlayerController.savePlayerSettings);
router.post('/courses/:courseId/player-settings/reset', doubleCsrfProtection, coursePlayerController.resetPlayerSettings);

module.exports = router;
