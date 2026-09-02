function getDashboard(req, res) {
  res.render('student/dashboard', {
    pageTitle: 'Student Dashboard | ICDS',
    metaDescription: 'Your ICDS student dashboard.',
  });
}

module.exports = { getDashboard };
