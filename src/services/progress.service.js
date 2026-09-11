const { prisma } = require('../config/db');
const { isUserEnrolled } = require('./enrollment.service');

class ProgressError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProgressError';
  }
}

// A lesson is auto-marked complete once the viewer has reached this fraction
// of the reported duration — matches typical "effectively finished" demo
// behavior without requiring the very last second to play.
const COMPLETION_THRESHOLD = 0.9;

// Never trust client-sent numbers as-is: coerce to a finite, non-negative
// integer, defaulting anything invalid to 0. Exported for testing.
function clampNonNegativeInt(value) {
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) && num > 0 ? num : 0;
}

// Pure decision of whether a (position, duration) pair counts as "complete",
// given whether the lesson was already completed before (completion never
// un-sets itself on a later, smaller position — e.g. a student seeking back
// to rewatch a section shouldn't lose their completed status). Exported for
// testing without touching the database.
function isLessonComplete(alreadyCompleted, watchedSeconds, durationSeconds) {
  if (alreadyCompleted) return true;
  return durationSeconds > 0 && watchedSeconds / durationSeconds >= COMPLETION_THRESHOLD;
}

// Per-lesson progress percent used to drive the course-level percentage
// below. Completed lessons always read as 100; an in-progress (not yet
// completed) lesson is capped at 99 so only real completion ever shows 100%.
function lessonPercent(row) {
  if (!row) return 0;
  if (row.completed) return 100;
  if (row.durationSeconds > 0) {
    return Math.min(99, Math.round((row.watchedSeconds / row.durationSeconds) * 100));
  }
  return 0;
}

// completed published lessons / total published lessons drives the
// completed count; the percent also folds in partial (in-progress, not yet
// completed) lesson positions so a single-lesson course shows real-time
// progress instead of staying at 0% until the video is finished. Always
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
  const rows = await prisma.lessonProgress.findMany({
    where: { userId, lessonId: { in: lessonIds } },
  });
  const rowByLesson = new Map(rows.map((row) => [row.lessonId, row]));

  let completed = 0;
  let percentSum = 0;
  for (const id of lessonIds) {
    const row = rowByLesson.get(id);
    if (row && row.completed) completed += 1;
    percentSum += lessonPercent(row);
  }

  const percent = Math.round(percentSum / lessons.length);
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

// Saves the current playback position + duration for the authenticated
// user, called periodically (throttled client-side, never on every
// timeupdate tick) while a lesson video plays. Enforces enrollment and
// lesson-published status server-side exactly like markLessonComplete —
// userId always comes from the session, never the request body, which is
// also what prevents one student from overwriting another's progress
// (IDOR): the (userId, lessonId) upsert key is never client-controlled.
async function saveLessonProgress(userId, lessonId, { positionSeconds, durationSeconds }) {
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
  if (!lesson || lesson.status !== 'PUBLISHED') {
    throw new ProgressError('Lesson not found.');
  }

  const enrolled = await isUserEnrolled(userId, lesson.courseId);
  if (!enrolled) {
    throw new ProgressError('You are not enrolled in this course.');
  }

  const watchedSeconds = clampNonNegativeInt(positionSeconds);
  const duration = clampNonNegativeInt(durationSeconds);

  const existing = await prisma.lessonProgress.findUnique({
    where: { userId_lessonId: { userId, lessonId } },
  });

  const wasCompleted = Boolean(existing && existing.completed);
  const completed = isLessonComplete(wasCompleted, watchedSeconds, duration);

  const data = {
    watchedSeconds,
    durationSeconds: duration,
    completed,
    completedAt: completed ? existing?.completedAt || new Date() : null,
  };

  const lessonProgress = await prisma.lessonProgress.upsert({
    where: { userId_lessonId: { userId, lessonId } },
    update: data,
    create: { userId, lessonId, ...data },
  });

  const progress = await computeCourseProgress(userId, lesson.courseId);
  await prisma.enrollment.updateMany({
    where: { userId, courseId: lesson.courseId },
    data: { progressPercent: progress.percent },
  });

  return { lessonProgress, progress };
}

module.exports = {
  ProgressError,
  COMPLETION_THRESHOLD,
  clampNonNegativeInt,
  isLessonComplete,
  computeCourseProgress,
  getLessonProgressMap,
  markLessonComplete,
  saveLessonProgress,
};
