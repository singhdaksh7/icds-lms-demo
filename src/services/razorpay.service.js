// Razorpay provider abstraction — every direct SDK/crypto call for payments
// lives here, kept separate from business logic (order.service.js) and out
// of controllers entirely. Credentials come from the admin-saved settings or
// the environment (see razorpaySettings.service.js) and are read per call, so
// an admin changing keys takes effect without a restart.
const crypto = require('crypto');
const Razorpay = require('razorpay');
const settings = require('./razorpaySettings.service');

class PaymentConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaymentConfigError';
    this.status = 503;
  }
}

let client = null; // { fingerprint, instance }

async function getClient() {
  const cfg = await settings.getEffectiveConfig();
  if (!cfg.enabled || !cfg.keyId || !cfg.keySecret) {
    throw new PaymentConfigError('Payments are not configured on this server yet.');
  }
  const fingerprint = `${cfg.keyId}|${cfg.keySecret}`;
  if (!client || client.fingerprint !== fingerprint) {
    client = { fingerprint, instance: new Razorpay({ key_id: cfg.keyId, key_secret: cfg.keySecret }) };
  }
  return client.instance;
}

// The only Razorpay credential ever safe to hand to the browser — the
// Razorpay Checkout script needs it to open the payment popup.
async function getPublicKeyId() {
  return (await settings.getEffectiveConfig()).keyId || null;
}

async function isConfigured() {
  const cfg = await settings.getEffectiveConfig();
  return Boolean(cfg.enabled && cfg.keyId && cfg.keySecret);
}

async function isWebhookConfigured() {
  return Boolean((await settings.getEffectiveConfig()).webhookSecret);
}

async function createProviderOrder({ amountPaise, currency, receipt }) {
  const razorpay = await getClient();
  return razorpay.orders.create({
    amount: amountPaise,
    currency,
    receipt,
    payment_capture: 1,
  });
}

async function fetchPayment(paymentId) {
  const razorpay = await getClient();
  return razorpay.payments.fetch(paymentId);
}

// Read-only credential check used by the admin "Test connection" button —
// lists one order; never creates anything or moves money.
async function testConnection() {
  const razorpay = await getClient();
  await razorpay.orders.all({ count: 1 });
  return true;
}

function timingSafeEqualHex(expectedHex, actualHex) {
  if (typeof actualHex !== 'string' || actualHex.length !== expectedHex.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(expectedHex, 'utf8'), Buffer.from(actualHex, 'utf8'));
  } catch {
    return false;
  }
}

// Documented Razorpay Checkout signature formula:
//   generated_signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret)
// Implemented directly so the comparison itself is constant-time.
async function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  const { keySecret } = await settings.getEffectiveConfig();
  if (!keySecret) {
    throw new PaymentConfigError('Payments are not configured on this server yet.');
  }
  const expected = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  return timingSafeEqualHex(expected, signature);
}

// Same HMAC-SHA256 formula Razorpay documents for webhooks, computed over
// the exact raw request bytes (a Buffer) — never a re-serialized body.
async function verifyWebhookSignature(rawBody, signatureHeader) {
  const { webhookSecret } = await settings.getEffectiveConfig();
  if (!webhookSecret) {
    throw new PaymentConfigError('Razorpay webhook secret is not configured on this server.');
  }
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return timingSafeEqualHex(expected, signatureHeader);
}

// The Razorpay SDK rejects with `{ statusCode, error: { description, code } }`
// rather than a normal Error — normalize into a loggable string without
// request/response bodies.
function describeError(err) {
  if (err && err.error && err.error.description) {
    return `${err.error.code || 'ERROR'}: ${err.error.description}`;
  }
  return (err && err.message) || 'Unknown error';
}

module.exports = {
  PaymentConfigError,
  getPublicKeyId,
  isConfigured,
  isWebhookConfigured,
  createProviderOrder,
  fetchPayment,
  testConnection,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  describeError,
};
