const { getDashboardStats } = require('../../services/admin.service');

async function getDashboard(req, res, next) {
  try {
    const stats = await getDashboardStats();

    res.render('admin/dashboard', {
      pageTitle: 'Admin Dashboard | ICDS',
      metaDescription: 'ICDS admin dashboard.',
      stats,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getDashboard };
