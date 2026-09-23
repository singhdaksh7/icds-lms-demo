const settingsService = require('../../services/settings.service');
const { validateSettings, SAFE_CTA_TARGETS } = require('../../validators/settings.validator');
const imageStorage = require('../../lib/imageStorage');

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
        errors,
      });
    }

    // Blank text fields fall back to the built-in default on the public
    // site rather than persisting an empty override forever — only
    // non-empty values (and every boolean toggle) are actually stored.
    const toSave = {};
    for (const [key, value] of Object.entries(values)) {
      if (BOOLEAN_KEYS.has(key) || value !== '') {
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

module.exports = { editSettingsForm, updateSettingsAction };
