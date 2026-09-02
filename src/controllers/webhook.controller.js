// Razorpay webhook. NOT session-authenticated, NOT CSRF-protected — its
// only authority is the verified HMAC signature (src/services/razorpay.service.js).
// req.body here is the raw request Buffer (see src/routes/webhook.routes.js,
// mounted with express.raw() BEFORE the app's global express.json()), which
// is required for the signature to verify correctly.
const razorpayService = require('../services/razorpay.service');
const orderService = require('../services/order.service');
const { toPaise } = require('../lib/money');

async function handleRazorpayWebhook(req, res) {
  if (!razorpayService.isWebhookConfigured()) {
    console.error('[webhook] Razorpay webhook secret not configured — rejecting request.');
    return res.status(503).end();
  }

  const signature = req.headers['x-razorpay-signature'];
  const rawBody = req.body; // Buffer

  let validSignature;
  try {
    validSignature = razorpayService.verifyWebhookSignature(rawBody, signature);
  } catch (err) {
    console.error('[webhook] signature verification error:', err.message);
    return res.status(400).end();
  }

  if (!validSignature) {
    console.error('[webhook] invalid signature — rejecting request.');
    return res.status(400).end();
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    console.error('[webhook] signature valid but body is not valid JSON — rejecting.');
    return res.status(400).end();
  }

  const eventType = event.event;
  console.log(`[webhook] received event=${eventType}`);

  try {
    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      await handlePaymentSuccessEvent(event, eventType);
    } else if (eventType === 'payment.failed') {
      await handlePaymentFailedEvent(event);
    } else {
      // Unknown/irrelevant event — acknowledge so Razorpay doesn't retry,
      // but don't process anything we don't have a defined handler for.
      console.log(`[webhook] unhandled event type, acknowledging: ${eventType}`);
    }
  } catch (err) {
    // A genuinely unexpected failure (e.g. transient DB error) — ask
    // Razorpay to retry rather than silently dropping the event.
    console.error(`[webhook] processing error for event=${eventType}:`, err.message);
    return res.status(500).end();
  }

  res.status(200).json({ success: true });
}

async function handlePaymentSuccessEvent(event, eventType) {
  const payment = event.payload && event.payload.payment && event.payload.payment.entity;
  if (!payment || !payment.order_id) {
    console.error(`[webhook] event=${eventType} missing payment entity/order_id — acknowledging, nothing to do.`);
    return;
  }

  const order = await orderService.getOrderByProviderOrderId(payment.order_id);
  if (!order) {
    console.error(`[webhook] no local order found for providerOrderId=${payment.order_id} — acknowledging.`);
    return;
  }

  const expectedPaise = toPaise(order.amount.toFixed ? order.amount.toFixed(2) : String(order.amount));
  if (Number(payment.amount) !== expectedPaise || payment.currency !== order.currency) {
    console.error(
      `[webhook] amount/currency mismatch for order ${order.id}: expected ${expectedPaise} ${order.currency}, got ${payment.amount} ${payment.currency} — not finalizing.`
    );
    return;
  }

  const { order: finalOrder, alreadyProcessed } = await orderService.finalizePaidOrder({
    orderId: order.id,
    providerPaymentId: payment.id,
    providerOrderId: payment.order_id,
  });

  console.log(
    `[webhook] ${alreadyProcessed ? 'already finalized (idempotent no-op)' : 'finalized'} localOrderId=${finalOrder.id} event=${eventType}`
  );
}

async function handlePaymentFailedEvent(event) {
  const payment = event.payload && event.payload.payment && event.payload.payment.entity;
  if (!payment || !payment.order_id) {
    console.log('[webhook] payment.failed missing order_id — acknowledging, nothing to do.');
    return;
  }

  const order = await orderService.getOrderByProviderOrderId(payment.order_id);
  if (!order) {
    console.log(`[webhook] payment.failed for unknown providerOrderId=${payment.order_id} — acknowledging.`);
    return;
  }

  // markOrderFailed only ever touches a still-PENDING order, so this can
  // never downgrade an order that was already finalized PAID by an earlier
  // (possibly out-of-order-delivered) payment.captured event.
  await orderService.markOrderFailed(order.id, 'payment.failed webhook');
}

module.exports = { handleRazorpayWebhook };
