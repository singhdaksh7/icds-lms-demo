const express = require('express');
const router = express.Router();
const { getHomePage } = require('../controllers/home.controller');
const publicController = require('../controllers/public.controller');
const founderController = require('../controllers/founder.controller');
const pagesController = require('../controllers/pages.controller');
const seoController = require('../controllers/seo.controller');
const { doubleCsrfProtection } = require('../config/csrf');
const { newsletterRateLimit, contactRateLimit } = require('../middleware/phase6RateLimit');

router.get('/', getHomePage);
router.get('/robots.txt', seoController.robotsTxt);
router.get('/sitemap.xml', seoController.sitemapXml);
router.get('/site.webmanifest', seoController.webManifest);
router.get('/founder', founderController.founderPage);
// CMS-backed standalone pages (real routes, never homepage-anchor redirects).
router.get('/about', pagesController.aboutPage);
router.get('/faq', pagesController.faqPage);
router.get('/reviews', pagesController.reviewsPage);
router.get('/contact', publicController.contactPage);
router.post('/contact', contactRateLimit, doubleCsrfProtection, publicController.postContact);
router.post('/newsletter/subscribe', newsletterRateLimit, doubleCsrfProtection, publicController.subscribe);
router.get('/certificates/verify/:certificateNumber', publicController.verifyCertificate);
router.get('/privacy', publicController.privacy);
router.get('/terms', publicController.terms);

module.exports = router;
