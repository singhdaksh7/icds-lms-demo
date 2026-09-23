const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyCourseState,
  courseStateLabel,
  courseButtonLabel,
  computeDashboardSummary,
  pickContinueLearningEnrollment,
} = require('../src/services/dashboard.service');

// --- classifyCourseState / labels ---------------------------------------

test('classifyCourseState: 0% is NOT_STARTED', () => {
  assert.equal(classifyCourseState(0), 'NOT_STARTED');
});

test('classifyCourseState: exactly 99% is IN_PROGRESS, not COMPLETED', () => {
  assert.equal(classifyCourseState(99), 'IN_PROGRESS');
});

test('classifyCourseState: exactly 100% is COMPLETED (boundary)', () => {
  assert.equal(classifyCourseState(100), 'COMPLETED');
});

test('classifyCourseState treats missing/invalid percent as 0 (NOT_STARTED)', () => {
  assert.equal(classifyCourseState(undefined), 'NOT_STARTED');
  assert.equal(classifyCourseState(null), 'NOT_STARTED');
  assert.equal(classifyCourseState(NaN), 'NOT_STARTED');
});

test('courseStateLabel / courseButtonLabel match state for each boundary', () => {
  assert.equal(courseStateLabel(0), 'Not Started');
  assert.equal(courseButtonLabel(0), 'Start Course');
  assert.equal(courseStateLabel(45), 'In Progress');
  assert.equal(courseButtonLabel(45), 'Continue');
  assert.equal(courseStateLabel(100), 'Completed');
  assert.equal(courseButtonLabel(100), 'Review Course');
});

// --- computeDashboardSummary ---------------------------------------------

test('computeDashboardSummary: zero enrollments -> all zeros, never fake data', () => {
  const summary = computeDashboardSummary([], 0);
  assert.deepEqual(summary, {
    enrolledCourses: 0,
    inProgressCourses: 0,
    completedCourses: 0,
    certificates: 0,
  });
});

test('computeDashboardSummary: one enrollment with partial progress', () => {
  const summary = computeDashboardSummary([{ progressPercent: 40 }], 0);
  assert.equal(summary.enrolledCourses, 1);
  assert.equal(summary.inProgressCourses, 1);
  assert.equal(summary.completedCourses, 0);
});

test('computeDashboardSummary: one fully completed course', () => {
  const summary = computeDashboardSummary([{ progressPercent: 100 }], 1);
  assert.equal(summary.enrolledCourses, 1);
  assert.equal(summary.inProgressCourses, 0);
  assert.equal(summary.completedCourses, 1);
  assert.equal(summary.certificates, 1);
});

test('computeDashboardSummary: mixed set classifies each enrollment independently, boundary 99 vs 100', () => {
  const summary = computeDashboardSummary(
    [{ progressPercent: 0 }, { progressPercent: 99 }, { progressPercent: 100 }],
    2,
  );
  assert.equal(summary.enrolledCourses, 3);
  assert.equal(summary.inProgressCourses, 1);
  assert.equal(summary.completedCourses, 1);
  assert.equal(summary.certificates, 2);
});

test('computeDashboardSummary: certificates count with zero and with some', () => {
  assert.equal(computeDashboardSummary([], 0).certificates, 0);
  assert.equal(computeDashboardSummary([], 5).certificates, 5);
});

// --- pickContinueLearningEnrollment --------------------------------------

test('pickContinueLearningEnrollment: zero enrollments -> null', () => {
  assert.equal(pickContinueLearningEnrollment([], {}), null);
});

test('pickContinueLearningEnrollment: picks the enrollment with the most recent LessonProgress activity', () => {
  const enrollments = [
    { id: 1, progressPercent: 30, enrolledAt: '2026-01-01' },
    { id: 2, progressPercent: 60, enrolledAt: '2026-02-01' },
  ];
  const activity = { 1: new Date('2026-03-01'), 2: new Date('2026-02-15') };
  const picked = pickContinueLearningEnrollment(enrollments, activity);
  assert.equal(picked.id, 1);
});

test('pickContinueLearningEnrollment: falls back to most recently enrolled when no activity exists anywhere', () => {
  const enrollments = [
    { id: 1, progressPercent: 0, enrolledAt: '2026-01-01' },
    { id: 2, progressPercent: 0, enrolledAt: '2026-03-01' },
  ];
  const picked = pickContinueLearningEnrollment(enrollments, {});
  assert.equal(picked.id, 2);
});

test('pickContinueLearningEnrollment: works with a Map for activity lookup too', () => {
  const enrollments = [
    { id: 1, progressPercent: 20, enrolledAt: '2026-01-01' },
    { id: 2, progressPercent: 20, enrolledAt: '2026-01-02' },
  ];
  const activity = new Map([[2, new Date('2026-05-01')]]);
  const picked = pickContinueLearningEnrollment(enrollments, activity);
  assert.equal(picked.id, 2);
});
