const { prisma } = require('../config/db');
const enrollmentService = require('./enrollment.service');

class EnrollmentRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EnrollmentRequestError';
  }
}

// Idempotent: a student who clicks "Request Enrollment" twice for the same
// course doesn't create a second row while an earlier request is still
// PENDING/CONTACTED — returns the existing one instead.
async function createRequest(userId, courseId, message) {
  const existing = await prisma.enrollmentRequest.findFirst({
    where: { userId, courseId, status: { in: ['PENDING', 'CONTACTED'] } },
  });
  if (existing) {
    return existing;
  }

  return prisma.enrollmentRequest.create({
    data: { userId, courseId, message: message || null },
  });
}

async function listRequestsAdmin({ status } = {}) {
  return prisma.enrollmentRequest.findMany({
    where: status ? { status } : undefined,
    include: {
      user: { select: { id: true, name: true, email: true } },
      course: { select: { id: true, title: true, slug: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function countPending() {
  return prisma.enrollmentRequest.count({ where: { status: 'PENDING' } });
}

async function setStatus(id, status) {
  const existing = await prisma.enrollmentRequest.findUnique({ where: { id } });
  if (!existing) {
    throw new EnrollmentRequestError('Enrollment request not found.');
  }
  return prisma.enrollmentRequest.update({ where: { id }, data: { status } });
}

// Approves the request: performs the same orderId=null manual enrollment as
// the student-admin "Enroll" action, then marks the request ENROLLED. Never
// fabricates payment/order state.
async function approveAndEnroll(id) {
  const existing = await prisma.enrollmentRequest.findUnique({ where: { id } });
  if (!existing) {
    throw new EnrollmentRequestError('Enrollment request not found.');
  }

  await enrollmentService.enrollStudentManually(existing.userId, existing.courseId);
  return prisma.enrollmentRequest.update({ where: { id }, data: { status: 'ENROLLED' } });
}

module.exports = {
  EnrollmentRequestError,
  createRequest,
  listRequestsAdmin,
  countPending,
  setStatus,
  approveAndEnroll,
};
