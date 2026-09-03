const { prisma } = require('../config/db');
const emailService = require('./email.service');

class EnrollmentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EnrollmentError';
  }
}

async function isUserEnrolled(userId, courseId) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } },
  });
  return Boolean(enrollment && enrollment.status === 'ACTIVE');
}

async function getEnrollment(userId, courseId) {
  return prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } },
  });
}

async function listEnrollmentsForUser(userId) {
  return prisma.enrollment.findMany({
    where: { userId },
    include: {
      course: { include: { instructor: true, category: true } },
    },
    orderBy: { enrolledAt: 'desc' },
  });
}

// Manual (no-payment) enrollment for admin operations. Reactivates a
// cancelled/expired enrollment instead of erroring on the unique
// (userId, courseId) constraint, and never creates a fake Order — orderId
// stays null, which the schema already supports.
async function enrollStudentManually(userId, courseId) {
  const [user, course] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.course.findUnique({ where: { id: courseId } }),
  ]);

  if (!user || user.role !== 'STUDENT') {
    throw new EnrollmentError('Student not found.');
  }
  if (!course) {
    throw new EnrollmentError('Course not found.');
  }

  const existing = await getEnrollment(userId, courseId);
  if (existing && existing.status === 'ACTIVE') {
    throw new EnrollmentError('This student is already enrolled in that course.');
  }

  const enrollment = existing
    ? await prisma.enrollment.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE', accessExpiresAt: null },
      })
    : await prisma.enrollment.create({
        data: { userId, courseId, status: 'ACTIVE', orderId: null },
      });

  // Notification only — never lets a failed/unconfigured email undo an
  // enrollment that already succeeded above. Covers both admin manual
  // enrollment and enrollment-request approval, since both call this same
  // function — no separate/duplicate notification path needed.
  emailService
    .sendEnrollmentApprovedEmail(null, { toEmail: user.email, studentName: user.name, courseTitle: course.title })
    .catch(() => {});

  return enrollment;
}

// Direct, no-payment enrollment for a genuinely free (price === 0) course.
// Callers must already have verified the course's server-computed purchase
// price is exactly 0 — this function itself doesn't re-check pricing, only
// enrollment state, mirroring enrollStudentManually's reactivation logic.
// No Order is ever created here (nothing was paid), so Enrollment.orderId
// stays null — indistinguishable from an admin manual enrollment in that
// respect, which is intentional.
async function enrollFree(userId, courseId) {
  const existing = await getEnrollment(userId, courseId);
  if (existing && existing.status === 'ACTIVE') {
    throw new EnrollmentError('You are already enrolled in this course.');
  }

  if (existing) {
    return prisma.enrollment.update({
      where: { id: existing.id },
      data: { status: 'ACTIVE', accessExpiresAt: null },
    });
  }

  return prisma.enrollment.create({
    data: { userId, courseId, status: 'ACTIVE', orderId: null },
  });
}

// Cancels rather than deletes, preserving LessonProgress/history.
async function cancelEnrollment(userId, courseId) {
  const existing = await getEnrollment(userId, courseId);
  if (!existing) {
    throw new EnrollmentError('Enrollment not found.');
  }

  return prisma.enrollment.update({
    where: { id: existing.id },
    data: { status: 'CANCELLED' },
  });
}

module.exports = {
  EnrollmentError,
  isUserEnrolled,
  getEnrollment,
  listEnrollmentsForUser,
  enrollStudentManually,
  enrollFree,
  cancelEnrollment,
};
