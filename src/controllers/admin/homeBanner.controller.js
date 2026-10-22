const svc = require('../../services/homeBanner.service');
const imageStorage = require('../../lib/imageStorage');

const BASE = '/admin/homepage/banners';

function renderForm(res, status, { banner, values, errors }) {
  return res.status(status).render('admin/homepage/banner-form', {
    pageTitle: `${banner ? 'Edit' : 'New'} Banner | Admin`,
    metaDescription: 'Homepage banner.',
    banner,
    values: values || {},
    errors: errors || [],
  });
}

async function list(req, res, next) {
  try {
    const banners = await svc.listBanners();
    res.render('admin/homepage/banners', {
      pageTitle: 'Homepage Banners | Admin',
      metaDescription: 'Manage homepage banners.',
      banners,
      now: new Date(),
    });
  } catch (err) {
    next(err);
  }
}

function newForm(req, res) {
  renderForm(res, 200, { banner: null, values: { overlayEnabled: true, isActive: true } });
}

async function editForm(req, res, next) {
  try {
    const banner = await svc.getBanner(parseInt(req.params.id, 10));
    if (!banner) {
      req.flashError('Banner not found.');
      return res.redirect(BASE);
    }
    renderForm(res, 200, { banner, values: banner });
  } catch (err) {
    next(err);
  }
}

// Combines an uploaded file (preferred) with the URL fallback / existing value.
function resolveImages(req, existing) {
  const files = req.files || {};
  const desktop = files.desktopImage && files.desktopImage[0];
  const mobile = files.mobileImage && files.mobileImage[0];
  const body = { ...req.body };
  body.isActive = body.isActive === 'true' ? 'true' : 'false'; // unchecked boxes are not submitted
  if (desktop) body.imageUrl = imageStorage.publicUrlFor(desktop.filename);
  else if (!String(body.imageUrl || '').trim() && existing) body.imageUrl = existing.imageUrl;
  if (mobile) body.mobileImageUrl = imageStorage.publicUrlFor(mobile.filename);
  else if (body.removeMobile === 'on') body.mobileImageUrl = '';
  else if (!String(body.mobileImageUrl || '').trim() && existing) body.mobileImageUrl = existing.mobileImageUrl || '';
  return { body, desktop, mobile };
}

async function create(req, res, next) {
  try {
    const { body, desktop, mobile } = resolveImages(req, null);
    const { errors, values } = svc.validateBannerInput(body);
    if (errors.length) return renderForm(res, 400, { banner: null, values: body, errors });
    await svc.createBanner(values);
    [desktop, mobile].forEach((f) => f && req.bannerAdopted && req.bannerAdopted.add(f.path));
    req.flashSuccess('Banner created.');
    res.redirect(BASE);
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  const id = parseInt(req.params.id, 10);
  try {
    const existing = await svc.getBanner(id);
    if (!existing) {
      req.flashError('Banner not found.');
      return res.redirect(BASE);
    }
    const { body, desktop, mobile } = resolveImages(req, existing);
    const { errors, values } = svc.validateBannerInput(body);
    if (errors.length) return renderForm(res, 400, { banner: existing, values: body, errors });
    await svc.updateBanner(id, values);
    [desktop, mobile].forEach((f) => f && req.bannerAdopted && req.bannerAdopted.add(f.path));
    if (values.imageUrl !== existing.imageUrl) imageStorage.deleteIfOwned(existing.imageUrl);
    if (values.mobileImageUrl !== existing.mobileImageUrl) imageStorage.deleteIfOwned(existing.mobileImageUrl);
    req.flashSuccess('Banner updated.');
    res.redirect(BASE);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const removed = await svc.deleteBanner(parseInt(req.params.id, 10));
    imageStorage.deleteIfOwned(removed.imageUrl);
    imageStorage.deleteIfOwned(removed.mobileImageUrl);
    req.flashSuccess('Banner deleted.');
    res.redirect(BASE);
  } catch (err) {
    if (err instanceof svc.HomeBannerError) {
      req.flashError(err.message);
      return res.redirect(BASE);
    }
    next(err);
  }
}

async function toggle(req, res, next) {
  try {
    const b = await svc.toggleBanner(parseInt(req.params.id, 10));
    req.flashSuccess(b.isActive ? 'Banner activated.' : 'Banner deactivated.');
    res.redirect(BASE);
  } catch (err) {
    if (err instanceof svc.HomeBannerError) {
      req.flashError(err.message);
      return res.redirect(BASE);
    }
    next(err);
  }
}

async function move(req, res, next) {
  try {
    await svc.moveBanner(parseInt(req.params.id, 10), req.body.direction);
    res.redirect(BASE);
  } catch (err) {
    if (err instanceof svc.HomeBannerError) {
      req.flashError(err.message);
      return res.redirect(BASE);
    }
    next(err);
  }
}

module.exports = { list, newForm, editForm, create, update, remove, toggle, move };
