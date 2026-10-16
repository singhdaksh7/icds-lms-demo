const razorpaySettings = require('../../services/razorpaySettings.service');
const razorpayService = require('../../services/razorpay.service');
const site = require('../../config/site');
const { validateRazorpaySettings } = require('../../validators/razorpay.validator');

async function renderPage(req, res, status, { errors = [], values = null } = {}) {
  const current = await razorpaySettings.getAdminView();
  const origin = site.baseUrl || `${req.protocol}://${req.get('host')}`;
  res.status(status).render('admin/payment-settings', {
    pageTitle: 'Payment Settings | Admin',
    metaDescription: 'Admin Razorpay settings.',
    current,
    errors,
    // Secrets are never echoed back — only non-secret fields repopulate.
    values: values ? { ...values, keySecret: '', webhookSecret: '' } : current,
    webhookUrl: `${origin}/webhooks/razorpay`,
  });
}

async function showPage(req, res, next) {
  try {
    await renderPage(req, res, 200);
  } catch (err) {
    next(err);
  }
}

async function save(req, res, next) {
  try {
    const current = await razorpaySettings.getAdminView();
    const { errors, values } = validateRazorpaySettings(req.body, {
      hasKeySecret: current.hasKeySecret,
      hasWebhookSecret: current.hasWebhookSecret,
    });
    if (errors.length > 0) return await renderPage(req, res, 400, { errors, values });

    await razorpaySettings.save(values);
    req.flashSuccess(
      values.enabled
        ? 'Payment settings saved and payments are ENABLED. Use "Test connection" to confirm the keys work.'
        : 'Payment settings saved. Payments are currently switched OFF.'
    );
    res.redirect('/admin/payment-settings');
  } catch (err) {
    next(err);
  }
}

async function reset(req, res, next) {
  try {
    await razorpaySettings.clear();
    req.flashSuccess('Saved payment settings removed. The server default configuration (if any) is now used.');
    res.redirect('/admin/payment-settings');
  } catch (err) {
    next(err);
  }
}

// Read-only credential check (lists one order); never charges anything.
async function testConnection(req, res, next) {
  try {
    const cfg = await razorpaySettings.getEffectiveConfig();
    if (!cfg.keyId || !cfg.keySecret) {
      req.flashError('No Razorpay keys are saved yet.');
    } else if (!cfg.enabled) {
      req.flashError('Payments are switched off — enable them and save before testing.');
    } else {
      try {
        await razorpayService.testConnection();
        req.flashSuccess(`Connection OK — Razorpay accepted the ${cfg.mode === 'live' ? 'LIVE' : 'TEST'} keys.`);
      } catch (err) {
        req.flashError(`Razorpay rejected the keys: ${razorpayService.describeError(err)}`);
      }
    }
    res.redirect('/admin/payment-settings');
  } catch (err) {
    next(err);
  }
}

module.exports = { showPage, save, reset, testConnection };
