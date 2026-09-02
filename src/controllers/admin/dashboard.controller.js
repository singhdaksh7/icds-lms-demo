const { getDashboardStats } = require('../../services/admin.service');
const { getPaymentStats } = require('../../services/order.service');

async function getDashboard(req, res, next) {
  try {
    const [stats, paymentStats] = await Promise.all([getDashboardStats(), getPaymentStats()]);

    res.render('admin/dashboard', {
      pageTitle: 'Admin Dashboard | ICDS',
      metaDescription: 'ICDS admin dashboard.',
      stats,
      paymentStats,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getDashboard };
