const KEY_ID_RE = /^rzp_(test|live)_[A-Za-z0-9]{6,40}$/;
const SECRET_RE = /^[\x21-\x7e]{6,100}$/; // printable, no whitespace

function validateRazorpaySettings(body = {}, { hasKeySecret = false, hasWebhookSecret = false } = {}) {
  const errors = [];
  const values = {
    enabled: body.enabled === '1' || body.enabled === 'on' || body.enabled === 'true',
    keyId: typeof body.keyId === 'string' ? body.keyId.trim() : '',
    keySecret: typeof body.keySecret === 'string' ? body.keySecret.trim() : '',
    webhookSecret: typeof body.webhookSecret === 'string' ? body.webhookSecret.trim() : '',
    confirmLive: body.confirmLive === '1' || body.confirmLive === 'on',
  };

  if (!KEY_ID_RE.test(values.keyId)) errors.push('Key ID must look like rzp_test_xxxxxxxx (Test Mode) or rzp_live_xxxxxxxx (Live Mode).');
  if (values.keySecret ? !SECRET_RE.test(values.keySecret) : !hasKeySecret) errors.push('Enter the Key Secret from the Razorpay Dashboard.');
  if (values.webhookSecret && !SECRET_RE.test(values.webhookSecret)) errors.push('Webhook secret must be 6-100 characters with no spaces.');
  if (values.enabled && !values.webhookSecret && !hasWebhookSecret) errors.push('Save the Webhook Secret before enabling payments — the webhook is what confirms payments that finish after the browser closes.');
  if (values.enabled && /^rzp_live_/.test(values.keyId) && !values.confirmLive) {
    errors.push('These are LIVE keys — real money will be charged. Tick the confirmation box to enable Live Mode.');
  }
  return { errors, values };
}

module.exports = { validateRazorpaySettings };
