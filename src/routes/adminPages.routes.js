// Admin routes for standalone pages (/admin/pages) and header/footer navigation
// (/admin/navigation). Mounted inside the authenticated admin router at '/'.
// FAQ routes (/admin/faqs) stay in admin.routes.js.
const express = require('express');
const router = express.Router();
const { doubleCsrfProtection } = require('../config/csrf');
const pages = require('../controllers/admin/sitePages.controller');
const nav = require('../controllers/admin/navigation.controller');

router.get('/pages', pages.list);
router.get('/pages/:slug', pages.edit);
router.post('/pages/:slug', doubleCsrfProtection, pages.save);
router.post('/pages/:slug/sections', doubleCsrfProtection, pages.addSection);
router.post('/pages/:slug/sections/:id/edit', doubleCsrfProtection, pages.updateSection);
router.post('/pages/:slug/sections/:id/delete', doubleCsrfProtection, pages.deleteSection);
router.post('/pages/:slug/sections/:id/move', doubleCsrfProtection, pages.moveSection);

router.get('/navigation', nav.list);
router.post('/navigation', doubleCsrfProtection, nav.create);
router.post('/navigation/defaults', doubleCsrfProtection, nav.seedDefaults);
router.post('/navigation/:id/edit', doubleCsrfProtection, nav.update);
router.post('/navigation/:id/delete', doubleCsrfProtection, nav.remove);
router.post('/navigation/:id/move', doubleCsrfProtection, nav.move);
router.post('/navigation/:id/toggle', doubleCsrfProtection, nav.toggle);

module.exports = router;
