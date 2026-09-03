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
  return prisma.course.findMany({
    where: { status: 'PUBLISHED', featured: true },
    include: {
      category: true,
      instructor: true,
      _count: { select: { lessons: { where: { status: 'PUBLISHED' } } } },
      reviews: { where: { status: 'APPROVED' }, select: { rating: true } },
    },
    orderBy: { publishedAt: 'desc' },
    take: limit,
  });
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

module.exports = {
  getActiveCategories,
  getFeaturedCourses,
  getActiveInstructors,
  getApprovedReviews,
  getPlatformStats,
};
