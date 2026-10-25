const { prisma } = require('../config/db');

class HomeReviewsAdminError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'HomeReviewsAdminError';
    this.status = status;
  }
}

// Genuine = published and not demo. Only these may appear on the homepage.
async function listGenuineReviews() {
  return prisma.courseTestimonial.findMany({
    where: { isPublished: true, isDemo: false },
    orderBy: [{ featuredOnHome: 'desc' }, { homeSortOrder: 'asc' }, { id: 'asc' }],
    include: { course: { select: { id: true, title: true } } },
  });
}

async function listDemoReviews() {
  return prisma.courseTestimonial.findMany({
    where: { isDemo: true },
    orderBy: [{ id: 'asc' }],
    include: { course: { select: { id: true, title: true } } },
  });
}

async function setFeatured(id, featured) {
  const row = await prisma.courseTestimonial.findUnique({ where: { id } });
  if (!row) throw new HomeReviewsAdminError('Review not found', 404);
  if (featured && row.isDemo) throw new HomeReviewsAdminError('Demo reviews cannot be featured on the homepage.');
  if (featured && !row.isPublished) throw new HomeReviewsAdminError('Publish the review before featuring it.');
  let homeSortOrder = row.homeSortOrder;
  if (featured && !row.featuredOnHome) {
    const agg = await prisma.courseTestimonial.aggregate({ where: { featuredOnHome: true }, _max: { homeSortOrder: true } });
    homeSortOrder = (agg._max.homeSortOrder == null ? -1 : agg._max.homeSortOrder) + 1;
  }
  return prisma.courseTestimonial.update({ where: { id }, data: { featuredOnHome: Boolean(featured), homeSortOrder } });
}

// Explicit numeric position for a featured review (lower = earlier). Ties fall back to id.
async function setHomeOrder(id, order) {
  const n = parseInt(order, 10);
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw new HomeReviewsAdminError('Order must be a whole number between 0 and 9999.');
  const row = await prisma.courseTestimonial.findUnique({ where: { id } });
  if (!row) throw new HomeReviewsAdminError('Review not found', 404);
  if (!row.featuredOnHome) throw new HomeReviewsAdminError('Feature the review on the homepage first.');
  return prisma.courseTestimonial.update({ where: { id }, data: { homeSortOrder: n } });
}

// Swap among featured rows, normalising ties first.
async function moveFeatured(id, direction) {
  if (direction !== 'up' && direction !== 'down') throw new HomeReviewsAdminError('Invalid direction');
  return prisma.$transaction(async (tx) => {
    const all = await tx.courseTestimonial.findMany({
      where: { featuredOnHome: true, isPublished: true, isDemo: false },
      orderBy: [{ homeSortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, homeSortOrder: true },
    });
    const idx = all.findIndex((r) => r.id === id);
    if (idx === -1) throw new HomeReviewsAdminError('Review is not featured', 404);
    const t = direction === 'up' ? idx - 1 : idx + 1;
    if (t >= 0 && t < all.length) [all[idx], all[t]] = [all[t], all[idx]];
    for (let i = 0; i < all.length; i += 1) {
      if (all[i].homeSortOrder !== i) await tx.courseTestimonial.update({ where: { id: all[i].id }, data: { homeSortOrder: i } });
    }
  });
}

module.exports = { HomeReviewsAdminError, listGenuineReviews, listDemoReviews, setFeatured, setHomeOrder, moveFeatured };
