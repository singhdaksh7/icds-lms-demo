// Pure helpers for deriving the student dashboard's summary counts, course
// state labels, and "continue learning" pick. No DB access here — callers
// (student.controller.js) pass in already-fetched enrollment/progress rows.
// Kept separate from progress.service.js (out of scope for this change) so
// the actual progress/completion math is never touched or reimplemented.

// Enrollment.progressPercent is a cached mirror of computeCourseProgress's
// `percent` (see progress.service.js) — 0 until any lesson has playback,
// capped below 100 until every lesson is genuinely completed, and exactly
// 100 only once every published lesson is completed. Classification here
// simply reads that existing semantics, it doesn't redefine them.
function classifyCourseState(progressPercent) {
  const percent = Number(progressPercent) || 0;
  if (percent >= 100) return 'COMPLETED';
  if (percent > 0) return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

const STATE_LABELS = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
};

const STATE_BUTTON_LABELS = {
  NOT_STARTED: 'Start Course',
  IN_PROGRESS: 'Continue',
  COMPLETED: 'Review Course',
};

function courseStateLabel(progressPercent) {
  return STATE_LABELS[classifyCourseState(progressPercent)];
}

function courseButtonLabel(progressPercent) {
  return STATE_BUTTON_LABELS[classifyCourseState(progressPercent)];
}

// Derives the four summary-card counts from a list of ACTIVE enrollments
// (each expected to carry a numeric `progressPercent`) plus a separately
// fetched certificates count. Never guesses/hardcodes — an empty list
// yields all zeros.
function computeDashboardSummary(enrollments, certificatesCount) {
  const list = Array.isArray(enrollments) ? enrollments : [];
  let inProgress = 0;
  let completed = 0;
  for (const enrollment of list) {
    const state = classifyCourseState(enrollment.progressPercent);
    if (state === 'IN_PROGRESS') inProgress += 1;
    else if (state === 'COMPLETED') completed += 1;
  }
  return {
    enrolledCourses: list.length,
    inProgressCourses: inProgress,
    completedCourses: completed,
    certificates: Number(certificatesCount) || 0,
  };
}

// Picks the single "Continue Learning" enrollment: the one whose most
// recent LessonProgress.updatedAt (across that course's lessons) is latest.
// Falls back to the most recently enrolled course if no enrollment has any
// progress activity at all. Returns null for zero enrollments.
//
// `enrollments` items need `id`/`progressPercent`/`enrolledAt`.
// `lastActivityByEnrollmentId` is a plain object/Map of enrollment.id ->
// Date (the max LessonProgress.updatedAt among that course's lessons for
// this user), built by the caller from already-fetched LessonProgress rows
// so this function stays DB-free.
function pickContinueLearningEnrollment(enrollments, lastActivityByEnrollmentId) {
  const list = Array.isArray(enrollments) ? enrollments : [];
  if (list.length === 0) return null;

  const getActivity = (id) => {
    if (!lastActivityByEnrollmentId) return null;
    const value = lastActivityByEnrollmentId instanceof Map
      ? lastActivityByEnrollmentId.get(id)
      : lastActivityByEnrollmentId[id];
    return value ? new Date(value) : null;
  };

  let best = null;
  let bestActivity = null;
  for (const enrollment of list) {
    const activity = getActivity(enrollment.id);
    if (activity && (!bestActivity || activity > bestActivity)) {
      bestActivity = activity;
      best = enrollment;
    }
  }
  if (best) return best;

  // No progress activity anywhere: fall back to the most recently enrolled.
  return list.reduce((latest, current) => {
    if (!latest) return current;
    return new Date(current.enrolledAt) > new Date(latest.enrolledAt) ? current : latest;
  }, null);
}

module.exports = {
  classifyCourseState,
  courseStateLabel,
  courseButtonLabel,
  computeDashboardSummary,
  pickContinueLearningEnrollment,
};
