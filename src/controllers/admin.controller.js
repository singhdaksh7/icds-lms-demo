function getDashboard(req, res) {
  res.render('admin/dashboard', {
    pageTitle: 'Admin Dashboard | ICDS',
    metaDescription: 'ICDS admin dashboard.',
  });
}

module.exports = { getDashboard };
