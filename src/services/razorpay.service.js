// Razorpay provider abstraction — every direct SDK/crypto call for payments
// lives here, kept separate from business logic (order.service.js) and out
// of controllers entirely.
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } = require('../config/env');

class PaymentConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaymentConfigError';
    this.status = 503;
  }
}

let client = null;

function getClient() {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    throw new PaymentConfigError('Payments are not configured on this server yet.');
  }
  if (!client) {
    client = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
  }
  return client;
}

// The only Razorpay credential ever safe to hand to the browser — the
// Razorpay Checkout script needs it to open the payment popup.
function getPublicKeyId() {
  return RAZORPAY_KEY_ID || null;
}

function isConfigured() {
  return Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);
}

function isWebhookConfigured() {
  return Boolean(RAZORPAY_WEBHOOK_SECRET);
}

async function createProviderOrder({ amountPaise, currency, receipt }) {
  const razorpay = getClient();
  return razorpay.orders.create({
    amount: amountPaise,
    currency,
    receipt,
    payment_capture: 1,
  });
}

async function fetchPayment(paymentId) {
  const razorpay = getClient();
  return razorpay.payments.fetch(paymentId);
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
// Implemented directly (rather than the SDK's internal helper, which uses a
// plain `===` string compare) so the comparison itself is constant-time.
function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  if (!RAZORPAY_KEY_SECRET) {
    throw new PaymentConfigError('Payments are not configured on this server yet.');
  }
  const payload = `${orderId}|${paymentId}`;
  const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(payload).digest('hex');
  return timingSafeEqualHex(expected, signature);
}

// Same HMAC-SHA256 formula Razorpay documents for webhooks, computed over
// the exact raw request bytes (a Buffer) — never a re-serialized/parsed
// version of the body, which can differ byte-for-byte from what Razorpay
// signed.
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!RAZORPAY_WEBHOOK_SECRET) {
    throw new PaymentConfigError('Razorpay webhook secret is not configured on this server.');
  }
  const expected = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  return timingSafeEqualHex(expected, signatureHeader);
}

// The Razorpay SDK rejects with `{ statusCode, error: { description, code } }`
// rather than a normal Error with `.message` — this normalizes either shape
// into a loggable string without ever including request/response bodies
// that might carry sensitive data.
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
  verifyCheckoutSignature,
  verifyWebhookSignature,
  describeError,
};
