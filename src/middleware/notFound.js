function notFound(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Not found' });
  }

  res.status(404).render('public/404', {
    pageTitle: 'Page Not Found',
  });
}

module.exports = notFound;
