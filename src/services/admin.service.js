const { prisma } = require('../config/db');
const { buildPagination } = require('../lib/pagination');

const STUDENT_PAGE_SIZE = 20;

// Real database counts only — no fabricated revenue/analytics (payments
// don't exist yet).
async function getDashboardStats() {
  const [
    totalStudents,
    totalCourses,
    publishedCourses,
    draftCourses,
    totalCategories,
    totalInstructors,
    totalEnrollments,
    totalMessages,
    newMessages,
    newsletterSubscribers,
    certificatesIssued,
    pendingEnrollmentRequests,
  ] = await Promise.all([
    prisma.user.count({ where: { role: 'STUDENT' } }),
    prisma.course.count(),
    prisma.course.count({ where: { status: 'PUBLISHED' } }),
    prisma.course.count({ where: { status: 'DRAFT' } }),
    prisma.category.count(),
    prisma.instructor.count(),
    prisma.enrollment.count(),
    prisma.contactMessage.count(),
    prisma.contactMessage.count({ where: { status: 'NEW' } }),
    prisma.newsletterSubscriber.count(),
    prisma.certificate.count(),
    prisma.enrollmentRequest.count({ where: { status: 'PENDING' } }),
  ]);

  return {
    totalStudents,
    totalCourses,
    publishedCourses,
    draftCourses,
    totalCategories,
    totalInstructors,
    totalEnrollments,
    totalMessages, newMessages, newsletterSubscribers, certificatesIssued,
    pendingEnrollmentRequests,
  };
}

async function listStudentsAdmin({ q, page = 1 } = {}) {
  const where = { role: 'STUDENT' };

  const query = typeof q === 'string' ? q.trim().slice(0, 100) : '';
  if (query) {
    where.OR = [{ name: { contains: query } }, { email: { contains: query } }];
  }

  const total = await prisma.user.count({ where });
  const pagination = buildPagination(page, STUDENT_PAGE_SIZE, total);

  const students = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      createdAt: true,
      _count: { select: { enrollments: true } },
    },
    orderBy: { createdAt: 'desc' },
    skip: pagination.skip,
    take: STUDENT_PAGE_SIZE,
  });

  return { students, pagination, query };
}

async function getStudentDetailAdmin(id) {
  const student = await prisma.user.findFirst({
    where: { id, role: 'STUDENT' },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      createdAt: true,
      enrollments: {
        include: { course: { include: { instructor: true } } },
        orderBy: { enrolledAt: 'desc' },
      },
    },
  });

  return student;
}

module.exports = { getDashboardStats, listStudentsAdmin, getStudentDetailAdmin };
