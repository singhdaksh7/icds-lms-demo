const orderService = require('../../services/order.service');
const { parsePage } = require('../../lib/pagination');

const STATUSES = ['PENDING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED'];

async function listOrders(req, res, next) {
  try {
    const status = STATUSES.includes(req.query.status) ? req.query.status : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const page = parsePage(req.query.page);

    const { orders, pagination } = await orderService.listOrdersAdmin({ status, q, page });

    const pageUrl = (targetPage) => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (q) params.set('q', q);
      if (targetPage > 1) params.set('page', String(targetPage));
      const qs = params.toString();
      return `/admin/orders${qs ? `?${qs}` : ''}`;
    };

    res.render('admin/orders/list', {
      pageTitle: 'Orders | Admin',
      metaDescription: 'Admin order management.',
      orders,
      pagination,
      pageUrl,
      statuses: STATUSES,
      filters: { status, q },
    });
  } catch (err) {
    next(err);
  }
}

async function getOrderDetail(req, res, next) {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!Number.isInteger(orderId)) {
      return res.status(404).render('public/404', { pageTitle: 'Order Not Found' });
    }

    const order = await orderService.getOrderByIdAdmin(orderId);
    if (!order) {
      req.flashError('Order not found.');
      return res.redirect('/admin/orders');
    }

    res.render('admin/orders/detail', {
      pageTitle: `Order #${order.id} | Admin`,
      metaDescription: 'Order detail.',
      order,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listOrders, getOrderDetail };
