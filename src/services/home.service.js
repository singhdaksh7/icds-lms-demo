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

module.exports = { getActiveCategories, getFeaturedCourses, getActiveInstructors };
