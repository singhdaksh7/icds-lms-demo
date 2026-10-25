const admin = require('../../services/homeReviewsAdmin.service');

const BASE = '/admin/homepage/reviews';

async function show(req, res, next) {
  try {
    // Loaded lazily: the settings service is owned by the homepage work.
    const reviewsSvc = require('../../services/homeReviews.service');
    const [settings, genuine, demo] = await Promise.all([
      reviewsSvc.getHomeReviewSettings(),
      admin.listGenuineReviews(),
      admin.listDemoReviews(),
    ]);
    res.render('admin/homepage/reviews', {
      pageTitle: 'Homepage Reviews | Admin',
      metaDescription: 'Homepage reviews settings.',
      settings,
      genuine,
      demo,
    });
  } catch (err) {
    next(err);
  }
}

async function saveSettings(req, res, next) {
  try {
    const reviewsSvc = require('../../services/homeReviews.service');
    // Patch-style: only fields present in the form are passed on (and saved).
    const input = {};
    Object.keys(reviewsSvc.KEYS).forEach((field) => {
      if (req.body[field] !== undefined) input[field] = req.body[field];
    });
    await reviewsSvc.saveHomeReviewSettings(input);
    req.flashSuccess('Homepage reviews settings saved.');
    res.redirect(BASE);
  } catch (err) {
    if (err && err.validation) {
      req.flashError(err.message);
      return res.redirect(BASE);
    }
    next(err);
  }
}

async function handle(req, res, next, fn, okMessage) {
  try {
    await fn();
    if (okMessage) req.flashSuccess(okMessage);
    res.redirect(BASE);
  } catch (err) {
    if (err instanceof admin.HomeReviewsAdminError) {
      req.flashError(err.message);
      return res.redirect(BASE);
    }
    next(err);
  }
}

function feature(req, res, next) {
  const featured = req.body.featured === 'true';
  return handle(req, res, next, () => admin.setFeatured(parseInt(req.params.id, 10), featured), featured ? 'Review featured on homepage.' : 'Review removed from featured.');
}

function setOrder(req, res, next) {
  return handle(req, res, next, () => admin.setHomeOrder(parseInt(req.params.id, 10), req.body.order), 'Homepage order updated.');
}

function move(req, res, next) {
  return handle(req, res, next, () => admin.moveFeatured(parseInt(req.params.id, 10), req.body.direction));
}

module.exports = { show, saveSettings, feature, move, setOrder };
