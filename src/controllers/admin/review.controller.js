const { prisma } = require('../../config/db');

// Student reviews are real records tied to a student and a course, so Admin
// can only moderate them (show / hide / delete) - never invent or edit a
// review's author, text or rating.
const STATUSES = ['APPROVED', 'PENDING', 'REJECTED'];

async function listReviews(req, res, next) {
  try {
    const reviews = await prisma.review.findMany({
      include: { user: { select: { name: true, email: true } }, course: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.render('admin/reviews/list', {
      pageTitle: 'Reviews | Admin',
      metaDescription: 'Admin review moderation.',
      reviews,
    });
  } catch (err) {
    next(err);
  }
}

async function updateReviewStatus(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const status = typeof req.body.status === 'string' ? req.body.status : '';
    if (!STATUSES.includes(status)) {
      req.flashError('Invalid review status.');
      return res.redirect('/admin/reviews');
    }
    const result = await prisma.review.updateMany({ where: { id }, data: { status } });
    if (result.count === 0) req.flashError('Review not found.');
    else req.flashSuccess(status === 'APPROVED' ? 'Review is now visible on the site.' : 'Review is hidden from the site.');
    res.redirect('/admin/reviews');
  } catch (err) {
    next(err);
  }
}

async function deleteReview(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await prisma.review.deleteMany({ where: { id } });
    if (result.count === 0) req.flashError('Review not found.');
    else req.flashSuccess('Review deleted.');
    res.redirect('/admin/reviews');
  } catch (err) {
    next(err);
  }
}

module.exports = { listReviews, updateReviewStatus, deleteReview, STATUSES };
