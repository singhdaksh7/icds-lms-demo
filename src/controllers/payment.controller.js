const orderService = require('../services/order.service');
const razorpayService = require('../services/razorpay.service');
const { toPaise } = require('../lib/money');

async function verifyPayment(req, res, next) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Missing payment verification fields.' });
    }

    const order = await orderService.getOrderByProviderOrderId(razorpay_order_id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    // Ownership check — a signed-in student can only verify their own
    // order, never someone else's by guessing/reusing a provider order id.
    if (order.userId !== req.currentUser.id) {
      return res.status(403).json({ success: false, error: 'Forbidden.' });
    }

    if (order.status === 'PAID') {
      // Idempotent: the popup's success callback can fire more than once
      // (retry, double-tap) — already-finalized is still a success reply.
      return res.json({ success: true, orderId: order.id, alreadyProcessed: true });
    }

    let validSignature;
    try {
      validSignature = razorpayService.verifyCheckoutSignature({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
      });
    } catch (err) {
      if (err instanceof razorpayService.PaymentConfigError) {
        return res.status(503).json({ success: false, error: 'Payments are not available right now.' });
      }
      throw err;
    }

    if (!validSignature) {
      await orderService.markOrderFailed(order.id, 'invalid checkout signature');
      console.error(`[payment] invalid checkout signature for order ${order.id}`);
      return res.status(400).json({ success: false, error: 'Payment verification failed.' });
    }

    // Belt-and-suspenders: don't stop at "the signature is valid" — fetch
    // the payment from Razorpay directly and confirm it actually matches
    // this order (provider order id, amount, currency) and is in a state
    // that means money actually moved, before trusting it.
    let payment;
    try {
      payment = await razorpayService.fetchPayment(razorpay_payment_id);
    } catch (err) {
      console.error(
        `[payment] failed to fetch payment ${razorpay_payment_id} from Razorpay: ${razorpayService.describeError(err)}`
      );
      return res.status(502).json({ success: false, error: 'Could not confirm payment. Please contact support.' });
    }

    if (payment.order_id !== razorpay_order_id) {
      console.error(
        `[payment] provider order mismatch for local order ${order.id}: expected ${razorpay_order_id}, payment says ${payment.order_id}`
      );
      return res.status(400).json({ success: false, error: 'Payment verification failed.' });
    }

    const expectedPaise = toPaise(order.amount.toFixed ? order.amount.toFixed(2) : String(order.amount));
    if (Number(payment.amount) !== expectedPaise || payment.currency !== order.currency) {
      console.error(
        `[payment] amount/currency mismatch for order ${order.id}: expected ${expectedPaise} ${order.currency}, got ${payment.amount} ${payment.currency}`
      );
      await orderService.markOrderFailed(order.id, 'amount/currency mismatch on verify');
      return res.status(400).json({ success: false, error: 'Payment verification failed.' });
    }

    if (!['captured', 'authorized'].includes(payment.status)) {
      return res
        .status(400)
        .json({ success: false, error: `Payment has not completed yet (status: ${payment.status}).` });
    }

    const { order: finalOrder } = await orderService.finalizePaidOrder({
      orderId: order.id,
      providerPaymentId: razorpay_payment_id,
      providerOrderId: razorpay_order_id,
    });

    console.log(`[payment] verified+finalized localOrderId=${finalOrder.id} event=client-verify`);

    res.json({ success: true, orderId: finalOrder.id });
  } catch (err) {
    if (err instanceof orderService.OrderError) {
      return res.status(err.status || 400).json({ success: false, error: err.message });
    }
    next(err);
  }
}

async function getPaymentSuccess(req, res, next) {
  try {
    const orderId = parseInt(req.params.orderId, 10);
    if (!Number.isInteger(orderId)) {
      return res.status(404).render('public/404', { pageTitle: 'Order Not Found' });
    }

    const isAdmin = req.currentUser && req.currentUser.role === 'ADMIN';
    const order = isAdmin
      ? await orderService.getOrderByIdAdmin(orderId)
      : await orderService.getOrderForUser(orderId, req.currentUser.id);

    if (!order) {
      return res.status(404).render('public/404', { pageTitle: 'Order Not Found' });
    }

    if (order.status !== 'PAID') {
      return res.redirect(`/payment/failed/${order.id}`);
    }

    res.render('public/payment-success', {
      pageTitle: 'Payment Successful | ICDS',
      metaDescription: 'Your payment was successful.',
      order,
    });
  } catch (err) {
    next(err);
  }
}

async function getPaymentFailed(req, res, next) {
  try {
    const orderId = parseInt(req.params.orderId, 10);
    if (!Number.isInteger(orderId)) {
      return res.status(404).render('public/404', { pageTitle: 'Order Not Found' });
    }

    const isAdmin = req.currentUser && req.currentUser.role === 'ADMIN';
    const order = isAdmin
      ? await orderService.getOrderByIdAdmin(orderId)
      : await orderService.getOrderForUser(orderId, req.currentUser.id);

    if (!order) {
      return res.status(404).render('public/404', { pageTitle: 'Order Not Found' });
    }

    if (order.status === 'PAID') {
      return res.redirect(`/payment/success/${order.id}`);
    }

    res.render('public/payment-failed', {
      pageTitle: 'Payment Failed | ICDS',
      metaDescription: 'Your payment could not be completed.',
      order,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { verifyPayment, getPaymentSuccess, getPaymentFailed };
