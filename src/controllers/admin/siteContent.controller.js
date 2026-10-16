const settingsService = require('../../services/settings.service');
const { validateForm } = require('../../validators/settings.validator');
const { TABS, FORM_BY_PATH, LINK_TARGETS, DEFAULTS } = require('../../config/siteContent');
const imageStorage = require('../../lib/imageStorage');
const siteConfig = require('../../config/site');

const REMOVE_PREFIX = 'remove__';
const TAB_BY_ID = new Map(TABS.map((tab) => [tab.id, tab]));

// Environment values that apply when a matching admin field is left blank
// (shown as placeholders so the admin can see what the site falls back to).
function envFallbacks() {
  const d = siteConfig.envDefaults;
  return {
    name: d.name,
    email: d.contactEmail,
    supportEmail: d.supportEmail,
    phone: d.contactPhone,
    address: d.address,
  };
}

// True while a legal page still shows the built-in provisional copy. Surfaced
// only inside Admin so the client knows to replace it - never on the public
// pages.
function legalProvisional(settings) {
  return {
    privacy: settings['legal.privacy.body'] === DEFAULTS['legal.privacy.body'],
    terms: settings['legal.terms.body'] === DEFAULTS['legal.terms.body'],
  };
}

function imageUrls(settings) {
  const urls = {};
  for (const tab of TABS) {
    for (const form of tab.forms) {
      for (const field of form.fields) {
        if (field.type === 'image') urls[field.key] = imageStorage.siteImagePublicUrl(settings[field.key]);
      }
    }
  }
  return urls;
}

function renderTab(res, tab, settings, { errors = [], errorFormId = null, status = 200 } = {}) {
  return res.status(status).render('admin/site-content/tab', {
    pageTitle: `${tab.title} | Site Content | Admin`,
    metaDescription: 'Admin site content management.',
    tabs: TABS,
    tab,
    settings,
    linkTargets: LINK_TARGETS,
    imageUrls: imageUrls(settings),
    legalProvisional: legalProvisional(settings),
    env: envFallbacks(),
    errors,
    errorFormId,
  });
}

// Resolves :tab / :form once so every handler can rely on req.siteTab /
// req.siteForm. An unknown id is a clean 404, never a settings write.
function resolveTab(req, res, next, value) {
  const tab = TAB_BY_ID.get(value);
  if (!tab) return res.status(404).render('public/404', { pageTitle: 'Not Found' });
  req.siteTab = tab;
  return next();
}

function resolveForm(req, res, next, value) {
  const entry = FORM_BY_PATH.get(`${req.params.tab}/${value}`);
  if (!entry) return res.status(404).render('public/404', { pageTitle: 'Not Found' });
  req.siteForm = entry.form;
  return next();
}

function index(req, res) {
  res.redirect('/admin/site-content/brand');
}

async function showTab(req, res, next) {
  try {
    const settings = await settingsService.listSettingsAdmin();
    renderTab(res, req.siteTab, settings);
  } catch (err) {
    next(err);
  }
}

// Saves ONE form. Only that form's own keys are ever written, so saving the
// header can never overwrite the hero (or anything else).
async function saveForm(req, res, next) {
  try {
    const tab = req.siteTab;
    const form = req.siteForm;
    const { errors, values } = validateForm(form, req.body);

    if (errors.length > 0) {
      const current = await settingsService.listSettingsAdmin();
      return renderTab(res, tab, { ...current, ...values }, { errors, errorFormId: form.id, status: 400 });
    }

    const current = await settingsService.listSettingsAdmin();
    const toSave = { ...values };
    const superseded = [];

    for (const field of form.fields) {
      if (field.type !== 'image') continue;
      const file = (req.siteImages || {})[field.key];
      const previous = current[field.key] || '';
      if (file) {
        toSave[field.key] = `site/${file.filename}`;
        req.siteImagesAdopted.add(file.path);
        if (previous) superseded.push(previous);
      } else if (req.body[`${REMOVE_PREFIX}${field.key}`] === '1') {
        toSave[field.key] = '';
        if (previous) superseded.push(previous);
      }
    }

    await settingsService.updateSettings(toSave);
    superseded.forEach((rel) => imageStorage.deleteSiteImageIfOwned(rel));

    req.flashSuccess(`${form.title} saved.`);
    res.redirect(`/admin/site-content/${tab.id}#form-${form.id}`);
  } catch (err) {
    next(err);
  }
}

// Old bookmark: the former single "Homepage Settings" page.
function legacyRedirect(req, res) {
  res.redirect(301, '/admin/site-content/home');
}

module.exports = {
  REMOVE_PREFIX,
  resolveTab,
  resolveForm,
  index,
  showTab,
  saveForm,
  legacyRedirect,
};
