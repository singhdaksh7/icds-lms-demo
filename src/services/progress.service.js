const { prisma } = require('../config/db');
const { isUserEnrolled } = require('./enrollment.service');

class ProgressError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProgressError';
  }
}

// A lesson is auto-marked complete once the viewer has genuinely watched
// this fraction of the reported duration — matches typical "effectively
// finished" demo behavior without requiring the very last second to play.
const COMPLETION_THRESHOLD = 0.9;

// The client throttles saves to roughly every 12 seconds (see
// public/js/lesson-progress.js SAVE_INTERVAL_MS) and only ever reports a
// delta accumulated between two saves while the video was genuinely
// playing. This is the server-side ceiling on a single reported delta —
// generous enough to absorb normal timer jitter/backgrounding, but far too
// small for a seek-to-end to pass as "watched". Never trust the client's
// delta beyond this regardless of what it claims.
const MAX_WATCHED_DELTA_SECONDS = 30;

// Never trust client-sent numbers as-is: coerce to a finite, non-negative
// integer, defaulting anything invalid to 0. Exported for testing.
function clampNonNegativeInt(value) {
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) && num > 0 ? num : 0;
}

// Same coercion, but also rejects negative deltas (a delta must never
// subtract watched time) and caps at MAX_WATCHED_DELTA_SECONDS so a client
// claiming an implausible jump (seek, reload, clock skew, tampering) can
// only ever add a small, bounded amount. Exported for testing.
function clampWatchedDelta(value) {
  const num = Math.trunc(Number(value));
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(num, MAX_WATCHED_DELTA_SECONDS);
}

// Pure decision of whether a (watchedSeconds, durationSeconds) pair counts
// as "complete", given whether the lesson was already completed before
// (completion never un-sets itself later — e.g. a student seeking back to
// rewatch a section shouldn't lose their completed status). Deliberately
// takes watchedSeconds (accumulated legitimate watch time), NEVER the raw
// playback position — that distinction is what stops "seek to the end"
// from completing a lesson. Exported for testing without touching the
// database.
function isLessonComplete(alreadyCompleted, watchedSeconds, durationSeconds) {
  if (alreadyCompleted) return true;
  return durationSeconds > 0 && watchedSeconds / durationSeconds >= COMPLETION_THRESHOLD;
}

// Pure computation of the next LessonProgress row state from the existing
// row (or null) plus one client-reported save. Exported so the exact bug
// scenario (seeking must not fake completion, resume is independent of
// watched time) can be tested directly without a database. This is the
// single place watchedSeconds, lastPositionSeconds and completed are
// derived — saveLessonProgress below just persists whatever this returns.
function computeProgressUpdate(existing, { positionSeconds, durationSeconds, watchedDeltaSeconds }) {
  const lastPositionSeconds = clampNonNegativeInt(positionSeconds);
  const duration = clampNonNegativeInt(durationSeconds);
  const delta = clampWatchedDelta(watchedDeltaSeconds);

  const priorWatched = existing ? existing.watchedSeconds : 0;
  const watchedSeconds = duration > 0
    ? Math.min(priorWatched + delta, duration)
    : priorWatched + delta;

  const wasCompleted = Boolean(existing && existing.completed);
  const completed = isLessonComplete(wasCompleted, watchedSeconds, duration);

  return {
    watchedSeconds,
    lastPositionSeconds,
    durationSeconds: duration,
    completed,
    completedAt: completed ? (existing && existing.completedAt) || new Date() : null,
  };
}

// Per-lesson progress percent used to drive the course-level percentage
// below. Completed lessons always read as 100; an in-progress (not yet
// completed) lesson is capped at 99 so only real completion ever shows
// 100%. Driven by watchedSeconds, never lastPositionSeconds.
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

  const existing = await prisma.lessonProgress.findUnique({
    where: { userId_lessonId: { userId, lessonId } },
  });

  await prisma.lessonProgress.upsert({
    where: { userId_lessonId: { userId, lessonId } },
    update: {
      completed: true,
      completedAt: new Date(),
      // Manual "Mark Complete" is an explicit, user-initiated action, so
      // watchedSeconds is set to the full known duration (if any) — it's
      // not derived from playback deltas here, but it's a one-time
      // authenticated user action, not a client-reported measurement.
      watchedSeconds: existing?.durationSeconds || existing?.watchedSeconds || 0,
    },
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

// Saves playback state for the authenticated user, called periodically
// (throttled client-side, never on every timeupdate tick) while a lesson
// video plays. Enforces enrollment and lesson-published status
// server-side exactly like markLessonComplete — userId always comes from
// the session, never the request body, which is also what prevents one
// student from overwriting another's progress (IDOR): the
// (userId, lessonId) upsert key is never client-controlled.
//
// Three independent inputs, never conflated:
//   - positionSeconds: raw playback position -> stored as
//     lastPositionSeconds, used only for resume. Can legitimately be
//     anywhere in the video (including near the end) without implying
//     anything was "watched".
//   - watchedDeltaSeconds: additional legitimate watched time accumulated
//     client-side since the last save (see public/js/lesson-progress.js) -
//     ADDED to the existing watchedSeconds total, clamped to a small
//     per-save ceiling so the client can never report a huge jump (e.g.
//     "watched 580 seconds" from one seek) as real watch time.
//   - durationSeconds: real video duration from <video> metadata.
async function saveLessonProgress(userId, lessonId, { positionSeconds, durationSeconds, watchedDeltaSeconds }) {
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
  if (!lesson || lesson.status !== 'PUBLISHED') {
    throw new ProgressError('Lesson not found.');
  }

  const enrolled = await isUserEnrolled(userId, lesson.courseId);
  if (!enrolled) {
    throw new ProgressError('You are not enrolled in this course.');
  }

  const existing = await prisma.lessonProgress.findUnique({
    where: { userId_lessonId: { userId, lessonId } },
  });

  // Server ADDS the (already-clamped) delta rather than trusting a
  // client-sent total — the client can only ever move watchedSeconds
  // forward by a small, bounded amount per save, entirely independent of
  // lastPositionSeconds (raw playback position, resume-only).
  const data = computeProgressUpdate(existing, { positionSeconds, durationSeconds, watchedDeltaSeconds });

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
  MAX_WATCHED_DELTA_SECONDS,
  clampNonNegativeInt,
  clampWatchedDelta,
  isLessonComplete,
  computeProgressUpdate,
  computeCourseProgress,
  getLessonProgressMap,
  markLessonComplete,
  saveLessonProgress,
};
