const settingsService = require('../../services/settings.service');
const { validateSettings, SAFE_CTA_TARGETS } = require('../../validators/settings.validator');

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

async function editSettingsForm(req, res, next) {
  try {
    const settings = await settingsService.listSettingsAdmin();
    res.render('admin/settings/edit', {
      pageTitle: 'Homepage Settings | Admin',
      metaDescription: 'Admin homepage content settings.',
      settings,
      ctaTargets: SAFE_CTA_TARGETS,
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
      return res.status(400).render('admin/settings/edit', {
        pageTitle: 'Homepage Settings | Admin',
        metaDescription: 'Admin homepage content settings.',
        settings: values,
        ctaTargets: SAFE_CTA_TARGETS,
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

    await settingsService.updateSettings(toSave);
    req.flashSuccess('Homepage settings updated.');
    res.redirect('/admin/settings');
  } catch (err) {
    next(err);
  }
}

module.exports = { editSettingsForm, updateSettingsAction };
