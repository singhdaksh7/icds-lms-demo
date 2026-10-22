const { prisma } = require('../config/db');

async function getActiveCategories() {
  return prisma.category.findMany({
    where: { status: 'ACTIVE' },
    include: {
      _count: { select: { courses: { where: { status: 'PUBLISHED' } } } },
    },
    orderBy: { name: 'asc' },
  });
}

async function getFeaturedCourses(limit = 6) {
  const include = {
    category: true,
    instructor: true,
    _count: { select: { lessons: { where: { status: 'PUBLISHED' } } } },
    reviews: { where: { status: 'APPROVED' }, select: { rating: true } },
  };
  // Featured courses first; top up with the latest published ones so the
  // homepage never shows an empty Courses section while courses are live.
  const featured = await prisma.course.findMany({
    where: { status: 'PUBLISHED', featured: true },
    include,
    orderBy: { publishedAt: 'desc' },
    take: limit,
  });
  if (featured.length >= limit) return featured;
  const others = await prisma.course.findMany({
    where: { status: 'PUBLISHED', id: { notIn: featured.map((c) => c.id) } },
    include,
    orderBy: { publishedAt: 'desc' },
    take: limit - featured.length,
  });
  return featured.concat(others);
}

async function getActiveInstructors() {
  return prisma.instructor.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { name: 'asc' },
  });
}

async function getApprovedReviews(limit = 6) {
  return prisma.review.findMany({
    where: { status: 'APPROVED' },
    include: {
      user: { select: { name: true } },
      course: { select: { title: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

// Real, DB-derived counts for the homepage stats strip. Never fabricate
// these — a stat with a zero count should be hidden by the view instead.
async function getPlatformStats() {
  const [courseCount, instructorCount, studentCount, ratingAgg] = await Promise.all([
    prisma.course.count({ where: { status: 'PUBLISHED' } }),
    prisma.instructor.count({ where: { status: 'ACTIVE' } }),
    prisma.enrollment.groupBy({ by: ['userId'], where: { status: 'ACTIVE' } }).then((rows) => rows.length),
    prisma.review.aggregate({ where: { status: 'APPROVED' }, _avg: { rating: true }, _count: { rating: true } }),
  ]);

  return {
    courseCount,
    instructorCount,
    studentCount,
    averageRating: ratingAgg._count.rating > 0 ? Number(ratingAgg._avg.rating).toFixed(1) : null,
    ratingCount: ratingAgg._count.rating,
  };
}

// Homepage mentor spotlight query: loads selected instructor (or Dr. Tanu Raghav fallback)
// with published credentials.
async function getMentorInstructor(instructorId = null) {
  const numericId = parseInt(instructorId, 10);
  let instructor = null;

  if (numericId && !Number.isNaN(numericId)) {
    instructor = await prisma.instructor.findUnique({
      where: { id: numericId },
      include: {
        credentials: {
          where: { isPublished: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    if (instructor && instructor.status === 'ACTIVE') {
      return instructor;
    }
  }

  instructor = await prisma.instructor.findFirst({
    where: {
      status: 'ACTIVE',
      OR: [
        { name: { contains: 'Tanu' } },
        { slug: { contains: 'tanu' } },
      ],
    },
    include: {
      credentials: {
        where: { isPublished: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  if (!instructor) {
    instructor = await prisma.instructor.findFirst({
      where: { status: 'ACTIVE' },
      include: {
        credentials: {
          where: { isPublished: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { id: 'asc' },
    });
  }

  return instructor;
}

// Safe CTA URL: only site-relative paths or http(s) URLs. Anything else
// (javascript:, data:, protocol-relative //host) is dropped.
function safeCtaUrl(url) {
  const v = typeof url === 'string' ? url.trim() : '';
  if (!v) return '';
  if (/^\/(?![/\\])/.test(v)) return v;
  if (/^https?:\/\/[^\s]+$/i.test(v)) return v;
  return '';
}

// Active banners for the homepage carousel (Agent 5's service owns the query).
// Defensive: a missing service or DB error just hides the carousel.
async function getHomeBanners(now = new Date()) {
  let rows = [];
  try {
    // eslint-disable-next-line global-require
    const { getActiveBanners } = require('./homeBanner.service');
    rows = await getActiveBanners(now);
  } catch (_err) {
    return [];
  }
  return (Array.isArray(rows) ? rows : [])
    .filter((b) => b && b.imageUrl)
    .map((b) => ({
      ...b,
      ctaUrl: safeCtaUrl(b.ctaUrl),
      secondaryCtaUrl: safeCtaUrl(b.secondaryCtaUrl),
    }));
}

module.exports = {
  safeCtaUrl,
  getHomeBanners,
  getActiveCategories,
  getFeaturedCourses,
  getActiveInstructors,
  getApprovedReviews,
  getPlatformStats,
  getMentorInstructor,
};
