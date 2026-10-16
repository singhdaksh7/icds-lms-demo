const smtpSettings = require('../../services/smtpSettings.service');
const emailService = require('../../services/email.service');
const { validateSmtpSettings } = require('../../validators/smtp.validator');

async function renderPage(res, status, { errors = [], values = null } = {}) {
  const current = await smtpSettings.getAdminView();
  res.status(status).render('admin/email-settings', {
    pageTitle: 'Email Settings | Admin',
    metaDescription: 'Admin SMTP email settings.',
    current,
    errors,
    // Never echo the password back — only non-secret fields are repopulated.
    values: values ? { ...values, password: '' } : current,
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
    const { errors, values } = validateSmtpSettings(req.body);
    if (errors.length > 0) return await renderPage(res, 400, { errors, values });

    await smtpSettings.save(values);
    req.flashSuccess('Email settings saved. Use "Send test email" to confirm they work.');
    res.redirect('/admin/email-settings');
  } catch (err) {
    next(err);
  }
}

async function reset(req, res, next) {
  try {
    await smtpSettings.clear();
    req.flashSuccess('Saved email settings removed. The server default configuration (if any) is now used.');
    res.redirect('/admin/email-settings');
  } catch (err) {
    next(err);
  }
}

// Sends only to the signed-in admin's own address, so the endpoint can't be
// used to spam arbitrary recipients.
async function sendTest(req, res, next) {
  try {
    const result = await emailService.sendTestEmail(req.currentUser.email);
    if (result.sent) {
      req.flashSuccess(`Test email sent to ${req.currentUser.email}. Check your inbox (and spam folder).`);
    } else if (!result.configured) {
      req.flashError('Email is not configured yet — save your SMTP settings first.');
    } else {
      req.flashError(`Test email failed: ${result.error || 'unknown error'}. Check host, port, username and password.`);
    }
    res.redirect('/admin/email-settings');
  } catch (err) {
    next(err);
  }
}

module.exports = { showPage, save, reset, sendTest };
