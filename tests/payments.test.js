process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.RAZORPAY_ENABLED = 'true';
process.env.RAZORPAY_KEY_ID = 'rzp_test_KEYID123';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret_value_abc';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret_value_xyz';
process.env.APP_BASE_URL = 'https://lms.example.test';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const nodemailer = require('nodemailer');

const { prisma } = require('../src/config/db');
const razorpayService = require('../src/services/razorpay.service');
const courseService = require('../src/services/course.service');
const smtpSettings = require('../src/services/smtpSettings.service');
const orderService = require('../src/services/order.service');
const checkoutController = require('../src/controllers/checkout.controller');
const paymentController = require('../src/controllers/payment.controller');
const webhookRoutes = require('../src/routes/webhook.routes');
const { toPaise } = require('../src/lib/money');
const emailTemplates = require('../src/lib/emailTemplates');
const emailService = require('../src/services/email.service');
const secretBox = require('../src/lib/secretBox');
const { validateSmtpSettings } = require('../src/validators/smtp.validator');

// ---------------------------------------------------------------------------
// In-memory fake of exactly the Prisma surface the payment code touches.
// ---------------------------------------------------------------------------
const dec = (n) => ({ toFixed: (d) => Number(n).toFixed(d), valueOf: () => Number(n) });

function installFakeDb() {
  const db = {
    users: [
      { id: 1, name: 'Stu Dent', email: 'stu@example.com', role: 'STUDENT' },
      { id: 2, name: 'Other Person', email: 'other@example.com', role: 'STUDENT' },
    ],
    courses: [
      { id: 10, slug: 'paid-course', title: 'Paid Course', price: dec(4999), salePrice: null, currency: 'INR' },
      { id: 11, slug: 'free-course', title: 'Free Course', price: dec(0), salePrice: null, currency: 'INR' },
    ],
    orders: [],
    items: [],
    enrollments: [],
    seq: 100,
  };
  const withRels = (o) =>
    o && {
      ...o,
      items: db.items.filter((i) => i.orderId === o.id).map((i) => ({ ...i, course: db.courses.find((c) => c.id === i.courseId) })),
      user: db.users.find((u) => u.id === o.userId),
    };
  const matchOrder = (o, w = {}) =>
    Object.entries(w).every(([k, v]) => {
      if (k === 'status' && v && v.in) return v.in.includes(o.status);
      if (k === 'providerOrderId' && v && v.not === null) return o.providerOrderId != null;
      if (k === 'createdAt' || k === 'items') return true;
      return o[k] === v;
    });

  prisma.order = {
    findUnique: async ({ where }) => withRels(db.orders.find((o) => matchOrder(o, where))) || null,
    findFirst: async ({ where }) => {
      const found = db.orders.find((o) => matchOrder(o, where) && (!where.items || db.items.some((i) => i.orderId === o.id && i.courseId === where.items.some.courseId)));
      return found ? { ...found } : null;
    },
    create: async ({ data }) => {
      const row = { id: ++db.seq, providerOrderId: null, providerPaymentId: null, ...data, amount: dec(data.amount) };
      db.orders.push(row);
      return { ...row };
    },
    update: async ({ where, data }) => Object.assign(db.orders.find((o) => o.id === where.id), data),
    updateMany: async ({ where, data }) => {
      const rows = db.orders.filter((o) => matchOrder(o, where));
      if (data.providerPaymentId) {
        const clash = db.orders.some((o) => o.providerPaymentId === data.providerPaymentId && !rows.includes(o));
        if (clash) throw Object.assign(new Error('unique'), { code: 'P2002' });
      }
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
  };
  prisma.orderItem = {
    create: async ({ data }) => {
      db.items.push({ ...data });
      return data;
    },
  };
  prisma.enrollment = {
    findUnique: async ({ where }) => {
      const k = where.userId_courseId;
      return db.enrollments.find((e) => e.userId === k.userId && e.courseId === k.courseId) || null;
    },
    create: async ({ data }) => {
      db.enrollments.push({ id: ++db.seq, ...data });
      return data;
    },
    update: async ({ where, data }) => Object.assign(db.enrollments.find((e) => e.id === where.id), data),
  };
  prisma.$transaction = async (fn) => fn(prisma);
  return db;
}

// Mock transport capturing outgoing mail; replaces the real SMTP transport.
function installMailCapture({ fail = false } = {}) {
  const sent = [];
  require('../src/lib/mailer').resetTransport();
  smtpSettings.getEffectiveConfig = async () => ({
    source: 'env',
    host: 'smtp.example.test',
    port: 587,
    secure: false,
    user: 'smtp-user',
    password: 'SMTP_SECRET_PASSWORD_VALUE',
    fromEmail: 'noreply@example.test',
    fromName: 'ICDS Test',
  });
  nodemailer.createTransport = () => ({
    sendMail: async (msg) => {
      if (fail) throw new Error('connect ECONNREFUSED smtp.example.test:587');
      sent.push(msg);
      return { messageId: 'x' };
    },
  });
  return sent;
}

function captureConsole() {
  const lines = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.join(' '));
  return {
    lines,
    restore: () => Object.assign(console, orig),
  };
}

function sign(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function callController(handler, { body = {}, params = {}, user }) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(p) {
        resolve({ status: this.statusCode, body: p });
      },
      render(view, data) {
        resolve({ status: this.statusCode, view, data });
      },
      redirect(to) {
        resolve({ status: 302, redirect: to });
      },
    };
    const req = { body, params, currentUser: user, flashError() {}, flashSuccess() {} };
    handler(req, res, reject).catch(reject);
  });
}

async function withWebhookServer(fn) {
  const app = express();
  app.use('/webhooks', webhookRoutes);
  const server = http.createServer(app).listen(0);
  const port = server.address().port;
  const post = (raw, signature) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { port, path: '/webhooks/razorpay', method: 'POST', headers: { 'content-type': 'application/json', ...(signature ? { 'x-razorpay-signature': signature } : {}) } },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        }
      );
      req.on('error', reject);
      req.end(raw);
    });
  try {
    await fn(post);
  } finally {
    server.close();
  }
}

const student = { id: 1, name: 'Stu Dent', email: 'stu@example.com', role: 'STUDENT' };

function stubCourses(db) {
  courseService.getPublishedCourseBySlug = async (slug) => db.courses.find((c) => c.slug === slug) || null;
}

function pendingOrder(db, over = {}) {
  const order = { id: ++db.seq, userId: 1, amount: dec('4999.00'), currency: 'INR', status: 'PENDING', providerOrderId: 'order_ABC', providerPaymentId: null, ...over };
  db.orders.push(order);
  db.items.push({ orderId: order.id, courseId: 10, price: dec('4999.00') });
  return order;
}

const capturedPayment = (over = {}) => ({ id: 'pay_1', order_id: 'order_ABC', amount: 499900, currency: 'INR', status: 'captured', ...over });

function webhookBody(event, payment) {
  return JSON.stringify({ event, payload: { payment: { entity: payment } } });
}

// ---------------------------------------------------------------------------
// Money / config / signature
// ---------------------------------------------------------------------------
test('paise conversion: Rs 4,999 -> 499900, no float drift', () => {
  assert.equal(toPaise('4999.00'), 499900);
  assert.equal(toPaise('4999'), 499900);
  assert.equal(toPaise('0.07'), 7);
  assert.equal(toPaise('1999.99'), 199999);
});

test('checkout signature: valid accepted; tampered order/payment/signature rejected', () => {
  const sig = sign(process.env.RAZORPAY_KEY_SECRET, 'order_ABC|pay_1');
  assert.equal(razorpayService.verifyCheckoutSignature({ orderId: 'order_ABC', paymentId: 'pay_1', signature: sig }), true);
  assert.equal(razorpayService.verifyCheckoutSignature({ orderId: 'order_ABC', paymentId: 'pay_2', signature: sig }), false);
  assert.equal(razorpayService.verifyCheckoutSignature({ orderId: 'order_XYZ', paymentId: 'pay_1', signature: sig }), false);
  assert.equal(razorpayService.verifyCheckoutSignature({ orderId: 'order_ABC', paymentId: 'pay_1', signature: 'deadbeef' }), false);
  assert.equal(razorpayService.verifyCheckoutSignature({ orderId: 'order_ABC', paymentId: 'pay_1', signature: undefined }), false);
});

test('only the public key id is exposed; secrets never appear in public helpers', () => {
  assert.equal(razorpayService.getPublicKeyId(), 'rzp_test_KEYID123');
  assert.equal(razorpayService.isConfigured(), true);
  const exposed = JSON.stringify(Object.keys(razorpayService));
  assert.ok(!exposed.includes('SECRET'));
});

// ---------------------------------------------------------------------------
// Order creation
// ---------------------------------------------------------------------------
test('create-order: price comes from the DB course, a client-sent amount is ignored', async () => {
  const db = installFakeDb();
  stubCourses(db);
  let received;
  razorpayService.createProviderOrder = async (args) => {
    received = args;
    return { id: 'order_NEW', amount: args.amountPaise, currency: args.currency };
  };
  const out = await callController(checkoutController.createOrder, {
    params: { courseSlug: 'paid-course' },
    body: { amount: '1', price: 1, amountPaise: 100 },
    user: student,
  });
  assert.equal(out.body.success, true);
  assert.equal(received.amountPaise, 499900);
  assert.equal(out.body.amount, 499900);
  assert.equal(out.body.keyId, 'rzp_test_KEYID123');
  assert.ok(!JSON.stringify(out.body).includes(process.env.RAZORPAY_KEY_SECRET));
  assert.equal(db.orders.length, 1);
  assert.equal(db.orders[0].status, 'PENDING');
  assert.equal(db.orders[0].providerOrderId, 'order_NEW');
});

test('create-order: repeat click reuses the pending order, no second Razorpay order', async () => {
  const db = installFakeDb();
  stubCourses(db);
  let calls = 0;
  razorpayService.createProviderOrder = async (args) => {
    calls += 1;
    return { id: 'order_ONLY', amount: args.amountPaise, currency: args.currency };
  };
  const run = () => callController(checkoutController.createOrder, { params: { courseSlug: 'paid-course' }, user: student });
  const a = await run();
  const b = await run();
  assert.equal(calls, 1);
  assert.equal(db.orders.length, 1);
  assert.equal(a.body.orderId, b.body.orderId);
  assert.equal(b.body.providerOrderId, 'order_ONLY');
});

test('create-order: unknown course 404, free course 400 with no Razorpay order, enrolled student 409', async () => {
  const db = installFakeDb();
  stubCourses(db);
  let calls = 0;
  razorpayService.createProviderOrder = async () => {
    calls += 1;
    return { id: 'order_X', amount: 1, currency: 'INR' };
  };
  const missing = await callController(checkoutController.createOrder, { params: { courseSlug: 'nope' }, user: student });
  assert.equal(missing.status, 404);

  const free = await callController(checkoutController.createOrder, { params: { courseSlug: 'free-course' }, user: student });
  assert.equal(free.status, 400);

  db.enrollments.push({ id: 1, userId: 1, courseId: 10, status: 'ACTIVE' });
  const owned = await callController(checkoutController.createOrder, { params: { courseSlug: 'paid-course' }, user: student });
  assert.equal(owned.status, 409);
  assert.equal(calls, 0);
  assert.equal(db.orders.length, 0);
});

test('create-order: admins cannot buy', async () => {
  const db = installFakeDb();
  stubCourses(db);
  const out = await callController(checkoutController.createOrder, { params: { courseSlug: 'paid-course' }, user: { ...student, role: 'ADMIN' } });
  assert.equal(out.status, 403);
});

test('routes: payment endpoints require authentication', () => {
  const stackOf = (router, path) => router.stack.find((l) => l.route && l.route.path === path).route.stack.map((s) => s.handle.name);
  const checkoutRoutes = require('../src/routes/checkout.routes');
  const paymentRoutes = require('../src/routes/payment.routes');
  assert.ok(stackOf(checkoutRoutes, '/checkout/:courseSlug/create-order').includes('requireAuth'));
  assert.ok(stackOf(paymentRoutes, '/payments/razorpay/verify').includes('requireAuth'));
});

// ---------------------------------------------------------------------------
// Client verification
// ---------------------------------------------------------------------------
function verifyBody(orderId = 'order_ABC', paymentId = 'pay_1', secret = process.env.RAZORPAY_KEY_SECRET) {
  return { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(secret, `${orderId}|${paymentId}`) };
}

test('verify: captured payment with valid signature enrolls exactly once; repeats are idempotent', async () => {
  const db = installFakeDb();
  const sent = installMailCapture();
  pendingOrder(db);
  razorpayService.fetchPayment = async () => capturedPayment();

  const first = await callController(paymentController.verifyPayment, { body: verifyBody(), user: student });
  assert.equal(first.body.success, true);
  const second = await callController(paymentController.verifyPayment, { body: verifyBody(), user: student });
  assert.equal(second.body.success, true);
  assert.equal(second.body.alreadyProcessed, true);

  assert.equal(db.enrollments.length, 1);
  assert.equal(db.enrollments[0].status, 'ACTIVE');
  assert.equal(db.orders[0].status, 'PAID');
  assert.equal(db.orders[0].providerPaymentId, 'pay_1');
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 1, 'exactly one confirmation email');
});

test('verify: invalid signature is rejected, order is not paid, no enrollment', async () => {
  const db = installFakeDb();
  pendingOrder(db);
  razorpayService.fetchPayment = async () => capturedPayment();
  const body = { ...verifyBody(), razorpay_signature: sign('wrong-secret', 'order_ABC|pay_1') };
  const cap = captureConsole();
  const out = await callController(paymentController.verifyPayment, { body, user: student });
  cap.restore();
  assert.equal(out.status, 400);
  assert.equal(db.enrollments.length, 0);
  assert.notEqual(db.orders[0].status, 'PAID');
});

test('verify: another student cannot verify someone else\'s order', async () => {
  const db = installFakeDb();
  pendingOrder(db);
  razorpayService.fetchPayment = async () => capturedPayment();
  const out = await callController(paymentController.verifyPayment, { body: verifyBody(), user: { ...student, id: 2 } });
  assert.equal(out.status, 403);
  assert.equal(db.enrollments.length, 0);
});

test('verify: unknown order 404; missing fields 400', async () => {
  installFakeDb();
  const a = await callController(paymentController.verifyPayment, { body: verifyBody('order_NOPE'), user: student });
  assert.equal(a.status, 404);
  const b = await callController(paymentController.verifyPayment, { body: {}, user: student });
  assert.equal(b.status, 400);
});

test('verify: authorized-but-not-captured, wrong amount, wrong provider order never enroll', async () => {
  for (const payment of [capturedPayment({ status: 'authorized' }), capturedPayment({ amount: 100 }), capturedPayment({ order_id: 'order_OTHER' })]) {
    const db = installFakeDb();
    pendingOrder(db);
    razorpayService.fetchPayment = async () => payment;
    const cap = captureConsole();
    const out = await callController(paymentController.verifyPayment, { body: verifyBody(), user: student });
    cap.restore();
    assert.equal(out.status, 400);
    assert.equal(db.enrollments.length, 0);
    assert.notEqual(db.orders[0].status, 'PAID');
  }
});

test('verify: Razorpay lookup failure never grants access (502)', async () => {
  const db = installFakeDb();
  pendingOrder(db);
  razorpayService.fetchPayment = async () => {
    throw new Error('network down');
  };
  const cap = captureConsole();
  const out = await callController(paymentController.verifyPayment, { body: verifyBody(), user: student });
  cap.restore();
  assert.equal(out.status, 502);
  assert.equal(db.enrollments.length, 0);
});

test('the same payment id cannot settle a second order', async () => {
  const db = installFakeDb();
  pendingOrder(db);
  const second = pendingOrder(db, { providerOrderId: 'order_DEF' });
  await orderService.finalizePaidOrder({ orderId: db.orders[0].id, providerPaymentId: 'pay_SAME', providerOrderId: 'order_ABC' });
  await assert.rejects(
    orderService.finalizePaidOrder({ orderId: second.id, providerPaymentId: 'pay_SAME', providerOrderId: 'order_DEF' }),
    /already been applied/
  );
  assert.equal(db.enrollments.length, 1);
});

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------
test('webhook: invalid or missing signature is rejected and changes nothing', async () => {
  const db = installFakeDb();
  pendingOrder(db);
  const raw = webhookBody('payment.captured', capturedPayment());
  const cap = captureConsole();
  await withWebhookServer(async (post) => {
    assert.equal(await post(raw, sign('not-the-secret', raw)), 400);
    assert.equal(await post(raw, undefined), 400);
  });
  cap.restore();
  assert.equal(db.orders[0].status, 'PENDING');
  assert.equal(db.enrollments.length, 0);
});

test('webhook: payment.captured enrolls; duplicate delivery and order.paid are idempotent', async () => {
  const db = installFakeDb();
  installMailCapture();
  pendingOrder(db);
  const cap = captureConsole();
  await withWebhookServer(async (post) => {
    const captured = webhookBody('payment.captured', capturedPayment());
    const orderPaid = webhookBody('order.paid', capturedPayment());
    for (const raw of [captured, captured, orderPaid]) {
      assert.equal(await post(raw, sign(process.env.RAZORPAY_WEBHOOK_SECRET, raw)), 200);
    }
  });
  cap.restore();
  assert.equal(db.enrollments.length, 1);
  assert.equal(db.orders[0].status, 'PAID');
});

test('webhook + browser verify racing/duplicating still yields one enrollment', async () => {
  const db = installFakeDb();
  installMailCapture();
  pendingOrder(db);
  razorpayService.fetchPayment = async () => capturedPayment();
  const cap = captureConsole();
  await withWebhookServer(async (post) => {
    const raw = webhookBody('payment.captured', capturedPayment());
    await post(raw, sign(process.env.RAZORPAY_WEBHOOK_SECRET, raw));
  });
  await callController(paymentController.verifyPayment, { body: verifyBody(), user: student });
  cap.restore();
  assert.equal(db.enrollments.length, 1);
});

test('webhook: payment.failed never enrolls; a later captured retry on the same order still succeeds (out-of-order safe)', async () => {
  const db = installFakeDb();
  installMailCapture();
  pendingOrder(db);
  const cap = captureConsole();
  await withWebhookServer(async (post) => {
    const failed = webhookBody('payment.failed', capturedPayment({ id: 'pay_bad', status: 'failed' }));
    assert.equal(await post(failed, sign(process.env.RAZORPAY_WEBHOOK_SECRET, failed)), 200);
    assert.equal(db.orders[0].status, 'FAILED');
    assert.equal(db.enrollments.length, 0);

    const ok = webhookBody('payment.captured', capturedPayment({ id: 'pay_good' }));
    assert.equal(await post(ok, sign(process.env.RAZORPAY_WEBHOOK_SECRET, ok)), 200);
    assert.equal(db.orders[0].status, 'PAID');
    assert.equal(db.enrollments.length, 1);

    // A late failure for an earlier attempt can never downgrade a paid order.
    assert.equal(await post(failed, sign(process.env.RAZORPAY_WEBHOOK_SECRET, failed)), 200);
    assert.equal(db.orders[0].status, 'PAID');
  });
  cap.restore();
});

test('webhook: amount mismatch is not finalized; unknown order acknowledged', async () => {
  const db = installFakeDb();
  pendingOrder(db);
  const cap = captureConsole();
  await withWebhookServer(async (post) => {
    const bad = webhookBody('payment.captured', capturedPayment({ amount: 100 }));
    assert.equal(await post(bad, sign(process.env.RAZORPAY_WEBHOOK_SECRET, bad)), 200);
    const unknown = webhookBody('payment.captured', capturedPayment({ order_id: 'order_UNKNOWN' }));
    assert.equal(await post(unknown, sign(process.env.RAZORPAY_WEBHOOK_SECRET, unknown)), 200);
  });
  cap.restore();
  assert.equal(db.enrollments.length, 0);
  assert.equal(db.orders[0].status, 'PENDING');
});

test('webhook: full refund marks the order REFUNDED but keeps the enrollment ACTIVE', async () => {
  const db = installFakeDb();
  installMailCapture();
  pendingOrder(db);
  const cap = captureConsole();
  await withWebhookServer(async (post) => {
    const ok = webhookBody('payment.captured', capturedPayment());
    await post(ok, sign(process.env.RAZORPAY_WEBHOOK_SECRET, ok));
    const refund = JSON.stringify({
      event: 'refund.processed',
      payload: { refund: { entity: { payment_id: 'pay_1' } }, payment: { entity: capturedPayment({ amount_refunded: 499900 }) } },
    });
    assert.equal(await post(refund, sign(process.env.RAZORPAY_WEBHOOK_SECRET, refund)), 200);
  });
  cap.restore();
  assert.equal(db.orders[0].status, 'REFUNDED');
  assert.equal(db.enrollments[0].status, 'ACTIVE');
});

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------
test('payment confirmation email: receipt facts, APP_BASE_URL link, no secrets', async () => {
  const sent = installMailCapture();
  await emailService.sendPaymentConfirmationEmail(null, {
    toEmail: 'stu@example.com',
    studentName: 'Stu Dent',
    courseTitle: 'Paid Course',
    amount: '4999.00',
    currency: 'INR',
    paymentReference: 'pay_1',
    orderId: 7,
  });
  assert.equal(sent.length, 1);
  const msg = sent[0];
  assert.match(msg.subject, /Paid Course/);
  assert.ok(msg.html.includes('https://lms.example.test/student/dashboard'));
  assert.ok(msg.text.includes('https://lms.example.test/student/dashboard'));
  assert.ok(msg.html.includes('₹4,999') && msg.html.includes('pay_1') && msg.html.includes('ICDS-7'));
  assert.ok(msg.from.includes('noreply@example.test'));
  for (const secret of ['SMTP_SECRET_PASSWORD_VALUE', process.env.RAZORPAY_KEY_SECRET]) {
    assert.ok(!JSON.stringify(msg).includes(secret));
  }
});

test('password reset email uses APP_BASE_URL-based link as supplied and escapes HTML', () => {
  const t = emailTemplates.passwordReset({ resetUrl: 'https://lms.example.test/reset-password/abc' });
  assert.ok(t.html.includes('https://lms.example.test/reset-password/abc'));
  const p = emailTemplates.paymentConfirmation({ studentName: '<script>x</script>', courseTitle: 'A&B', amount: 1, currency: 'INR', orderId: 1, dashboardUrl: 'https://lms.example.test/student/dashboard' });
  assert.ok(!p.html.includes('<script>x</script>'));
});

test('email header injection: CR/LF in recipient or subject is neutralised', async () => {
  const sent = installMailCapture();
  await emailService.sendPasswordResetEmail('victim@example.com\r\nBcc: evil@example.com', 'https://lms.example.test/r/1');
  assert.equal(sent.length, 1);
  assert.ok(!/[\r\n]/.test(sent[0].to));
  assert.ok(!/[\r\n]/.test(sent[0].subject));
});

test('SMTP failure does not roll back a valid payment/enrollment and logs no secret', async () => {
  const db = installFakeDb();
  installMailCapture({ fail: true });
  pendingOrder(db);
  const cap = captureConsole();
  const result = await orderService.finalizePaidOrder({ orderId: db.orders[0].id, providerPaymentId: 'pay_1', providerOrderId: 'order_ABC' });
  await new Promise((r) => setTimeout(r, 20));
  cap.restore();
  assert.equal(result.order.status, 'PAID');
  assert.equal(db.enrollments.length, 1);
  assert.equal(db.enrollments[0].status, 'ACTIVE');
  const logs = cap.lines.join('\n');
  assert.match(logs, /send failed/);
  assert.ok(!logs.includes('SMTP_SECRET_PASSWORD_VALUE'));
  assert.ok(!logs.includes(process.env.RAZORPAY_KEY_SECRET));
});

// ---------------------------------------------------------------------------
// Admin SMTP settings
// ---------------------------------------------------------------------------
test('secretBox round-trips, is randomised, and rejects tampering', () => {
  const a = secretBox.encrypt('app-password-123');
  const b = secretBox.encrypt('app-password-123');
  assert.notEqual(a, b);
  assert.ok(!a.includes('app-password-123'));
  assert.equal(secretBox.decrypt(a), 'app-password-123');
  assert.equal(secretBox.decrypt(a.slice(0, -4) + 'AAAA'), null);
  assert.equal(secretBox.decrypt('garbage'), null);
});

test('SMTP validator: accepts good input, rejects bad host/port/email/CRLF', () => {
  const good = validateSmtpSettings({ host: 'smtp.gmail.com', port: '587', fromEmail: 'a@b.co', fromName: 'ICDS', username: 'u', password: 'p' });
  assert.deepEqual(good.errors, []);
  assert.equal(good.values.secure, false);
  assert.ok(validateSmtpSettings({ host: 'bad host!', port: '587', fromEmail: 'a@b.co' }).errors.length);
  assert.ok(validateSmtpSettings({ host: 'smtp.x.com', port: '99999', fromEmail: 'a@b.co' }).errors.length);
  assert.ok(validateSmtpSettings({ host: 'smtp.x.com', port: '587', fromEmail: 'nope' }).errors.length);
  assert.ok(validateSmtpSettings({ host: 'smtp.x.com', port: '587', fromEmail: 'a@b.co', fromName: 'x\r\nBcc: y' }).errors.length);
});

test('admin SMTP view never exposes the password; blank password keeps the saved one', async () => {
  let row = null;
  prisma.smtpSetting = {
    findUnique: async () => row,
    upsert: async ({ create, update }) => {
      row = row ? { ...row, ...update } : { ...create };
    },
    deleteMany: async () => {
      row = null;
    },
  };
  smtpSettings.invalidate();
  delete require.cache[require.resolve('../src/services/smtpSettings.service')];
  const svc = require('../src/services/smtpSettings.service');
  await svc.save({ host: 'smtp.example.test', port: 587, secure: false, username: 'u', password: 'TopSecretPw', fromEmail: 'a@b.co', fromName: 'N' });
  assert.ok(row.passwordEnc && !row.passwordEnc.includes('TopSecretPw'));

  const view = await svc.getAdminView();
  assert.equal(view.hasPassword, true);
  assert.ok(!JSON.stringify(view).includes('TopSecretPw'));
  assert.ok(!JSON.stringify(view).includes(row.passwordEnc));

  const cfg = await svc.getEffectiveConfig();
  assert.equal(cfg.source, 'admin');
  assert.equal(cfg.password, 'TopSecretPw');

  await svc.save({ host: 'smtp2.example.test', port: 465, secure: true, username: 'u', password: '', fromEmail: 'a@b.co', fromName: '' });
  assert.equal((await svc.getEffectiveConfig()).password, 'TopSecretPw');
  assert.equal((await svc.getEffectiveConfig()).host, 'smtp2.example.test');

  await svc.clear();
  assert.equal((await svc.getEffectiveConfig()).source, 'none');
});
