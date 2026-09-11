const test = require('node:test');
const assert = require('node:assert/strict');
const {
  clampNonNegativeInt,
  isLessonComplete,
  COMPLETION_THRESHOLD,
} = require('../src/services/progress.service');

test('clampNonNegativeInt coerces invalid/negative client input to 0', () => {
  assert.equal(clampNonNegativeInt(-5), 0);
  assert.equal(clampNonNegativeInt(NaN), 0);
  assert.equal(clampNonNegativeInt(undefined), 0);
  assert.equal(clampNonNegativeInt(null), 0);
  assert.equal(clampNonNegativeInt('not a number'), 0);
  assert.equal(clampNonNegativeInt(Infinity), 0);
});

test('clampNonNegativeInt truncates fractional/string-numeric input', () => {
  assert.equal(clampNonNegativeInt(12.9), 12);
  assert.equal(clampNonNegativeInt('45'), 45);
  assert.equal(clampNonNegativeInt(0), 0);
});

test('isLessonComplete is false below the completion threshold', () => {
  assert.equal(isLessonComplete(false, 100, 1000), false);
  assert.equal(isLessonComplete(false, 0, 1000), false);
});

test('isLessonComplete is false with an unknown (zero) duration, regardless of position', () => {
  assert.equal(isLessonComplete(false, 500, 0), false);
});

test(`isLessonComplete becomes true at >= ${COMPLETION_THRESHOLD * 100}% watched`, () => {
  const duration = 1000;
  const justBelow = Math.floor(duration * COMPLETION_THRESHOLD) - 1;
  const atThreshold = Math.ceil(duration * COMPLETION_THRESHOLD);
  assert.equal(isLessonComplete(false, justBelow, duration), false);
  assert.equal(isLessonComplete(false, atThreshold, duration), true);
  assert.equal(isLessonComplete(false, duration, duration), true);
});

test('isLessonComplete never un-completes a lesson that was already completed, even after seeking back', () => {
  assert.equal(isLessonComplete(true, 0, 1000), true);
  assert.equal(isLessonComplete(true, 1, 1000), true);
});
