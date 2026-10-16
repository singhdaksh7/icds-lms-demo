const taxSettings = require('../../services/taxSettings.service');

async function renderPage(res, status, { errors = [], values = null } = {}) {
  const current = await taxSettings.get();
  res.status(status).render('admin/tax-settings', {
    pageTitle: 'Tax & Invoice | Admin',
    metaDescription: 'Admin GST and invoice settings.',
    errors,
    values: values || current,
  });
}

async function showPage(req, res, next) {
  try {
    await renderPage(res, 200);
  } catch (err) {
    next(err);
  }
}

async function save(req, res, next) {
  try {
    const { errors, values } = taxSettings.validate(req.body);
    if (errors.length > 0) return await renderPage(res, 400, { errors, values: { ...values, inclusive: values.inclusive } });
    await taxSettings.save(values);
    req.flashSuccess('Tax & invoice settings saved.');
    res.redirect('/admin/tax-settings');
  } catch (err) {
    next(err);
  }
}

module.exports = { showPage, save };
