const { prisma } = require('../config/db');
const { getCoursePurchasePrice } = require('../lib/pricing');
const { buildPagination } = require('../lib/pagination');
const emailService = require('./email.service');

// A still-PENDING order that already has a Razorpay order is reused for a
// repeat "Buy" click within this window instead of piling up new orders.
const PENDING_REUSE_WINDOW_MS = 30 * 60 * 1000;

const STUDENT_ORDERS_PAGE_SIZE = 20;
const ADMIN_ORDERS_PAGE_SIZE = 20;

class OrderError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'OrderError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Ownership-safe lookups
// ---------------------------------------------------------------------------

async function getOrderForUser(orderId, userId) {
  return prisma.order.findFirst({
    where: { id: orderId, userId },
    include: { items: { include: { course: true } } },
  });
}

async function getOrderByIdAdmin(orderId) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { course: true } }, user: true },
  });
}

async function getOrderByProviderOrderId(providerOrderId) {
  if (!providerOrderId) return null;
  return prisma.order.findUnique({ where: { providerOrderId } });
}

async function listOrdersForUser(userId, { page = 1 } = {}) {
  const total = await prisma.order.count({ where: { userId } });
  const pagination = buildPagination(page, STUDENT_ORDERS_PAGE_SIZE, total);

  const orders = await prisma.order.findMany({
    where: { userId },
    include: { items: { include: { course: true } } },
    orderBy: { createdAt: 'desc' },
    skip: pagination.skip,
    take: STUDENT_ORDERS_PAGE_SIZE,
  });

  return { orders, pagination };
}

async function listOrdersAdmin({ status, q, page = 1 } = {}) {
  const where = {};

  if (status && ['PENDING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED'].includes(status)) {
    where.status = status;
  }

  const query = typeof q === 'string' ? q.trim().slice(0, 100) : '';
  if (query) {
    where.user = { OR: [{ name: { contains: query } }, { email: { contains: query } }] };
  }

  const total = await prisma.order.count({ where });
  const pagination = buildPagination(page, ADMIN_ORDERS_PAGE_SIZE, total);

  const orders = await prisma.order.findMany({
    where,
    include: { user: true, items: { include: { course: true } } },
    orderBy: { createdAt: 'desc' },
    skip: pagination.skip,
    take: ADMIN_ORDERS_PAGE_SIZE,
  });

  return { orders, pagination, query };
}

// ---------------------------------------------------------------------------
// Checkout lifecycle
// ---------------------------------------------------------------------------

// Creates a local PENDING order + a price-snapshot OrderItem. Called before
// the Razorpay provider order exists — providerOrderId is attached
// separately once Razorpay confirms it (attachProviderOrder).
async function createPendingOrder(userId, course) {
  const amount = getCoursePurchasePrice(course);

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        userId,
        amount,
        currency: course.currency,
        status: 'PENDING',
        paymentProvider: 'razorpay',
      },
    });

    await tx.orderItem.create({
      data: { orderId: order.id, courseId: course.id, price: amount },
    });

    return order;
  });
}

// Returns the user's recent PENDING order for this course (same price, a
// Razorpay order already attached) or null. Prevents duplicate active orders
// when a student double-clicks Buy / retries after closing the popup.
async function findReusablePendingOrder(userId, course) {
  const amount = getCoursePurchasePrice(course);
  const order = await prisma.order.findFirst({
    where: {
      userId,
      status: 'PENDING',
      providerOrderId: { not: null },
      createdAt: { gte: new Date(Date.now() - PENDING_REUSE_WINDOW_MS) },
      items: { some: { courseId: course.id } },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!order) return null;
  return Number(order.amount) === Number(amount) && order.currency === course.currency ? order : null;
}

async function attachProviderOrder(orderId, providerOrderId) {
  return prisma.order.update({ where: { id: orderId }, data: { providerOrderId } });
}

// Never downgrades a PAID order — only a still-PENDING order can become
// FAILED, so a late/duplicate failure signal can't corrupt a completed sale.
// FAILED is not terminal: a later genuinely captured payment on the same
// Razorpay order (customer retried inside Checkout) still finalizes it.
async function markOrderFailed(orderId, reason) {
  const result = await prisma.order.updateMany({
    where: { id: orderId, status: 'PENDING' },
    data: { status: 'FAILED' },
  });
  console.log(
    `[payment] order ${orderId} ${result.count > 0 ? 'marked FAILED' : 'left unchanged (not PENDING)'}: ${reason}`
  );
  return result.count > 0;
}

// Order state machine:
//   PENDING --(captured payment verified)--> PAID
//   PENDING --(payment.failed / bad signature)--> FAILED
//   FAILED  --(captured payment verified)--> PAID   (retry inside Checkout)
//   PAID    --(refund.processed webhook)--> REFUNDED (access is NOT revoked)
// Enrollment: ACTIVE is created/reactivated only inside the PENDING|FAILED -> PAID
// transition below.
const PAYABLE_STATUSES = ['PENDING', 'FAILED'];

// THE canonical order-completion path. Both the client-side verification
// endpoint and the Razorpay webhook call this exact function.
//
// Idempotent: the -> PAID transition is gated by an atomic
// `updateMany({ where: { id, status in PAYABLE } })` inside a transaction.
// MySQL row-locks that UPDATE, so concurrent calls (client verify +
// webhook) can't both win; the loser sees count === 0 and returns an
// already-processed no-op instead of duplicating the enrollment. The unique
// index on providerPaymentId additionally stops one payment id from
// settling a second order.
async function finalizePaidOrder({ orderId, providerPaymentId, providerOrderId }) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) {
    throw new OrderError('Order not found.', 404);
  }

  if (order.status === 'PAID' || order.status === 'REFUNDED') {
    return { order, alreadyProcessed: true };
  }
  if (!PAYABLE_STATUSES.includes(order.status)) {
    throw new OrderError(`Order ${orderId} is not payable (status: ${order.status}).`, 409);
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const gate = await tx.order.updateMany({
        where: { id: orderId, status: { in: PAYABLE_STATUSES } },
        data: {
          status: 'PAID',
          providerPaymentId,
          providerOrderId: providerOrderId || order.providerOrderId,
        },
      });

      if (gate.count === 0) {
        const current = await tx.order.findUnique({ where: { id: orderId } });
        return { order: current, alreadyProcessed: true };
      }

      for (const item of order.items) {
        const existing = await tx.enrollment.findUnique({
          where: { userId_courseId: { userId: order.userId, courseId: item.courseId } },
        });

        if (existing) {
          await tx.enrollment.update({
            where: { id: existing.id },
            data: { status: 'ACTIVE', accessExpiresAt: null, orderId: order.id },
          });
        } else {
          await tx.enrollment.create({
            data: { userId: order.userId, courseId: item.courseId, status: 'ACTIVE', orderId: order.id },
          });
        }
      }

      const updated = await tx.order.findUnique({ where: { id: orderId } });
      return { order: updated, alreadyProcessed: false };
    });
  } catch (err) {
    if (err && err.code === 'P2002') {
      // providerPaymentId already belongs to a different order.
      throw new OrderError('This payment has already been applied to another order.', 409);
    }
    throw err;
  }

  if (!result.alreadyProcessed) {
    // Secondary to the payment: never awaited into the response path and
    // never allowed to undo a committed payment/enrollment.
    sendPaymentConfirmation(result.order.id).catch((err) =>
      console.error(`[payment] confirmation email failed for order ${result.order.id}: ${err.message}`)
    );
  }
  return result;
}

async function sendPaymentConfirmation(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true, items: { include: { course: true } } },
  });
  if (!order) return;
  await emailService.sendPaymentConfirmationEmail(null, {
    toEmail: order.user.email,
    studentName: order.user.name,
    courseTitle: order.items.map((i) => i.course.title).join(', '),
    amount: order.amount,
    currency: order.currency,
    paymentReference: order.providerPaymentId,
    orderId: order.id,
  });
}

// Refund reconciliation (refunds themselves are initiated from the Razorpay
// Dashboard). Only a PAID order moves to REFUNDED, and ONLY on a full refund.
// Business rule: a refund does NOT automatically revoke course access — an
// admin cancels the enrollment manually if that is the intended outcome.
async function markOrderRefunded(providerPaymentId) {
  if (!providerPaymentId) return false;
  const result = await prisma.order.updateMany({
    where: { providerPaymentId, status: 'PAID' },
    data: { status: 'REFUNDED' },
  });
  return result.count > 0;
}

// ---------------------------------------------------------------------------
// Admin dashboard metrics
// ---------------------------------------------------------------------------

async function getPaymentStats() {
  const [pending, paid, failed, refunded, cancelled, revenue] = await Promise.all([
    prisma.order.count({ where: { status: 'PENDING' } }),
    prisma.order.count({ where: { status: 'PAID' } }),
    prisma.order.count({ where: { status: 'FAILED' } }),
    prisma.order.count({ where: { status: 'REFUNDED' } }),
    prisma.order.count({ where: { status: 'CANCELLED' } }),
    // Decimal-safe aggregation — Prisma sums the underlying Decimal column
    // in the database and returns a Decimal, never a JS float.
    prisma.order.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }),
  ]);

  const totalOrders = pending + paid + failed + refunded + cancelled;

  return {
    totalOrders,
    pendingOrders: pending,
    paidOrders: paid,
    failedOrders: failed,
    refundedOrders: refunded,
    cancelledOrders: cancelled,
    totalPaidRevenue: revenue._sum.amount || 0,
  };
}

module.exports = {
  OrderError,
  getOrderForUser,
  getOrderByIdAdmin,
  getOrderByProviderOrderId,
  listOrdersForUser,
  listOrdersAdmin,
  createPendingOrder,
  findReusablePendingOrder,
  attachProviderOrder,
  markOrderFailed,
  markOrderRefunded,
  finalizePaidOrder,
  getPaymentStats,
};
