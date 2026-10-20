const videoStorageSettings = require('../../services/videoStorageSettings.service');
const r2 = require('../../lib/r2');

async function renderPage(res, extra = {}) {
  const status = await videoStorageSettings.getAdminView();
  res.render('admin/video-storage/index', {
    pageTitle: 'Video Storage | Admin',
    metaDescription: 'Configure where lesson videos are stored.',
    status,
    errors: [],
    values: null,
    testResult: null,
    ...extra,
  });
}

async function showPage(req, res, next) {
  try {
    await renderPage(res);
  } catch (err) {
    next(err);
  }
}

async function saveSettings(req, res, next) {
  try {
    const current = await videoStorageSettings.getAdminView();
    const { errors, values } = videoStorageSettings.validate(req.body || {}, current);
    if (errors.length > 0) {
      // Never echo the secret back into the form.
      return res.status(400).render('admin/video-storage/index', {
        pageTitle: 'Video Storage | Admin',
        metaDescription: 'Configure where lesson videos are stored.',
        status: current,
        errors,
        values: { ...values, secret: '' },
        testResult: null,
      });
    }
    await videoStorageSettings.save(values);
    req.flashSuccess('Video storage settings saved.');
    res.redirect('/admin/video-storage');
  } catch (err) {
    next(err);
  }
}

// Uses the SAVED configuration (never request-supplied credentials).
async function testConnection(req, res, next) {
  try {
    const config = await videoStorageSettings.getR2ConfigOrNull();
    if (!config) {
      req.flashError('Save complete Cloudflare R2 settings (including the secret) before testing.');
      return res.redirect('/admin/video-storage');
    }
    let testResult;
    try {
      const result = await r2.testConnection(config);
      testResult = { ok: true, ...result };
    } catch (err) {
      testResult = { ok: false, message: r2.describeError(err) };
    }
    await renderPage(res, { testResult });
  } catch (err) {
    next(err);
  }
}

module.exports = { showPage, saveSettings, testConnection };
