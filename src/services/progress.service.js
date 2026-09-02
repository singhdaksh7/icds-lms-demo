const { prisma } = require('../config/db');
const { isUserEnrolled } = require('./enrollment.service');

class ProgressError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProgressError';
  }
}

// completed published lessons / total published lessons * 100, always
// recomputed from LessonProgress (the source of truth) rather than trusting
// any client-sent percentage. Safe for courses with zero published lessons.
async function computeCourseProgress(userId, courseId) {
  const lessons = await prisma.lesson.findMany({
    where: { courseId, status: 'PUBLISHED' },
    select: { id: true },
  });

  if (lessons.length === 0) {
    return { completed: 0, total: 0, percent: 0 };
  }

  const lessonIds = lessons.map((l) => l.id);
  const completed = await prisma.lessonProgress.count({
    where: { userId, lessonId: { in: lessonIds }, completed: true },
  });

  const percent = Math.round((completed / lessons.length) * 100);
  return { completed, total: lessons.length, percent };
}

async function getLessonProgressMap(userId, lessonIds) {
  if (lessonIds.length === 0) return {};

  const rows = await prisma.lessonProgress.findMany({
    where: { userId, lessonId: { in: lessonIds } },
  });

  const map = {};
  for (const row of rows) {
    map[row.lessonId] = row;
  }
  return map;
}

// Marks a lesson complete for the authenticated user. Enforces enrollment
// and lesson-published status server-side — userId always comes from the
// session, never from the request body.
async function markLessonComplete(userId, lessonId) {
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
  if (!lesson || lesson.status !== 'PUBLISHED') {
    throw new ProgressError('Lesson not found.');
  }

  const enrolled = await isUserEnrolled(userId, lesson.courseId);
  if (!enrolled) {
    throw new ProgressError('You are not enrolled in this course.');
  }

  await prisma.lessonProgress.upsert({
    where: { userId_lessonId: { userId, lessonId } },
    update: { completed: true, completedAt: new Date() },
    create: { userId, lessonId, completed: true, completedAt: new Date() },
  });

  const progress = await computeCourseProgress(userId, lesson.courseId);

  // Enrollment.progressPercent is a cached/derived value; keep it in sync,
  // but LessonProgress rows remain the actual source of truth.
  await prisma.enrollment.updateMany({
    where: { userId, courseId: lesson.courseId },
    data: { progressPercent: progress.percent },
  });

  return { lesson, progress };
}

module.exports = { ProgressError, computeCourseProgress, getLessonProgressMap, markLessonComplete };
