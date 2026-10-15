const settingsService = require('../../services/settings.service');
const { validateSettings, SAFE_CTA_TARGETS } = require('../../validators/settings.validator');
const imageStorage = require('../../lib/imageStorage');
const siteConfig = require('../../config/site');

// Environment values that apply when the matching admin field is left blank
// (shown as placeholders so the admin can see what the site falls back to).
function envFallbacks() {
  const d = siteConfig.envDefaults;
  return { name: d.name, email: d.contactEmail, phone: d.contactPhone, address: d.address };
}

const BOOLEAN_KEYS = new Set([
  'why.enabled',
  'process.enabled',
  'instructors.enabled',
  'newsletter.enabled',
  'nav.showAbout',
  'nav.showInstructors',
  'nav.showReviews',
  'nav.showFaq',
]);

// Text fields where clearing the input is meaningful: a blank value is saved
// as "" and the public site then falls back to the environment/default value.
const BLANK_CLEARS_PREFIXES = ['site.name', 'contact.', 'legal.'];

function blankClears(key) {
  return BLANK_CLEARS_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix));
}

// True while a legal page still shows the built-in provisional copy. Surfaced
// only inside Admin so the client knows to replace it - never on the public
// pages.
function legalProvisional(settings) {
  const d = settingsService.DEFAULTS;
  return {
    privacy: (settings['legal.privacy.body'] || d['legal.privacy.body']) === d['legal.privacy.body'],
    terms: (settings['legal.terms.body'] || d['legal.terms.body']) === d['legal.terms.body'],
  };
}

function whyImageUrl(settings) {
  const relPath = settings && settings['why.imagePath'];
  return relPath ? imageStorage.siteImagePublicUrl(relPath) : null;
}

async function editSettingsForm(req, res, next) {
  try {
    const settings = await settingsService.listSettingsAdmin();
    res.render('admin/settings/edit', {
      pageTitle: 'Homepage Settings | Admin',
      metaDescription: 'Admin homepage content settings.',
      settings,
      ctaTargets: SAFE_CTA_TARGETS,
      whyImageUrl: whyImageUrl(settings),
      legalProvisional: legalProvisional(settings),
      env: envFallbacks(),
      errors: [],
    });
  } catch (err) {
    next(err);
  }
}

async function updateSettingsAction(req, res, next) {
  try {
    const { errors, values } = validateSettings(req.body);

    if (errors.length > 0) {
      // A file may already have been written to disk by multer before this
      // validation ran (see uploadSiteImage in the route chain). Clean it
      // up rather than leaving an orphaned file, since it never gets
      // referenced by any saved setting.
      if (req.file) {
        imageStorage.deleteSiteImageIfOwned(`site/${req.file.filename}`);
      }
      return res.status(400).render('admin/settings/edit', {
        pageTitle: 'Homepage Settings | Admin',
        metaDescription: 'Admin homepage content settings.',
        settings: values,
        ctaTargets: SAFE_CTA_TARGETS,
        whyImageUrl: whyImageUrl(values),
        legalProvisional: legalProvisional(values),
        env: envFallbacks(),
        errors,
      });
    }

    // Blank text fields fall back to the built-in default on the public
    // site rather than persisting an empty override forever — only
    // non-empty values (and every boolean toggle) are actually stored.
    const toSave = {};
    for (const [key, value] of Object.entries(values)) {
      if (BOOLEAN_KEYS.has(key) || value !== '' || blankClears(key)) {
        toSave[key] = value;
      }
    }

    // Image handling mirrors the "save new first, delete old after DB
    // success" pattern used for lesson video replacement: if no new file
    // was selected, why.imagePath is left out of toSave entirely (same
    // "leave unchanged" behavior as the other why.* text fields) — it is
    // never accidentally cleared.
    let previousImagePath = null;
    if (req.file) {
      const current = await settingsService.listSettingsAdmin();
      previousImagePath = current['why.imagePath'] || null;
      toSave['why.imagePath'] = `site/${req.file.filename}`;
    }

    await settingsService.updateSettings(toSave);

    if (req.file && previousImagePath && previousImagePath !== toSave['why.imagePath']) {
      imageStorage.deleteSiteImageIfOwned(previousImagePath);
    }

    req.flashSuccess('Homepage settings updated.');
    res.redirect('/admin/settings');
  } catch (err) {
    next(err);
  }
}

// Detaches the custom Why ICDS image. The homepage then falls back to the
// bundled default image. Admin-only + CSRF-protected at the route.
async function removeWhyImage(req, res, next) {
  try {
    const current = await settingsService.listSettingsAdmin();
    const previous = current['why.imagePath'] || '';
    if (!previous) {
      req.flashSuccess('No custom image to remove - the default image is already in use.');
      return res.redirect('/admin/settings');
    }
    await settingsService.updateSettings({ 'why.imagePath': '' });
    imageStorage.deleteSiteImageIfOwned(previous);
    req.flashSuccess('Custom image removed. The default image is now shown.');
    res.redirect('/admin/settings');
  } catch (err) {
    next(err);
  }
}

module.exports = { editSettingsForm, updateSettingsAction, removeWhyImage };
