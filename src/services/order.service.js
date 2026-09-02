const { prisma } = require('../config/db');
const { getCoursePurchasePrice } = require('../lib/pricing');
const { buildPagination } = require('../lib/pagination');

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

async function attachProviderOrder(orderId, providerOrderId) {
  return prisma.order.update({ where: { id: orderId }, data: { providerOrderId } });
}

// Never downgrades a PAID order — only a still-PENDING order can become
// FAILED, so a late/duplicate failure signal can't corrupt a completed sale.
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

// THE canonical order-completion path. Both the client-side verification
// endpoint and the Razorpay webhook call this exact function — there is no
// second/competing implementation of "what happens when a payment succeeds".
//
// Idempotent: the PENDING -> PAID transition is gated by an atomic
// `updateMany({ where: { id, status: 'PENDING' } })` inside a transaction.
// MySQL row-locks that UPDATE, so if this is called twice concurrently
// (e.g. client verify + webhook racing), only one call's updateMany can
// affect a row; the loser sees count === 0 and treats it as an already-
// processed no-op instead of creating a duplicate enrollment.
async function finalizePaidOrder({ orderId, providerPaymentId, providerOrderId }) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) {
    throw new OrderError('Order not found.', 404);
  }

  if (order.status === 'PAID') {
    return { order, alreadyProcessed: true };
  }
  if (order.status !== 'PENDING') {
    throw new OrderError(`Order ${orderId} is not payable (status: ${order.status}).`, 409);
  }

  return prisma.$transaction(async (tx) => {
    const gate = await tx.order.updateMany({
      where: { id: orderId, status: 'PENDING' },
      data: {
        status: 'PAID',
        providerPaymentId,
        providerOrderId: providerOrderId || order.providerOrderId,
      },
    });

    if (gate.count === 0) {
      // Lost the race (or already finalized between the read above and
      // here) — idempotent no-op, not an error.
      const current = await tx.order.findUnique({ where: { id: orderId } });
      return { order: current, alreadyProcessed: true };
    }

    for (const item of order.items) {
      const existing = await tx.enrollment.findUnique({
        where: { userId_courseId: { userId: order.userId, courseId: item.courseId } },
      });

      if (existing) {
        // Reactivate if it had lapsed/been cancelled; keep if already
        // active. Either way, link it to this order.
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
  attachProviderOrder,
  markOrderFailed,
  finalizePaidOrder,
  getPaymentStats,
};
