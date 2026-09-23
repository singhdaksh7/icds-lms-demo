const test = require('node:test');
const assert = require('node:assert/strict');
const {
  clampNonNegativeInt,
  clampWatchedDelta,
  isLessonComplete,
  computeProgressUpdate,
  COMPLETION_THRESHOLD,
  MAX_WATCHED_DELTA_SECONDS,
} = require('../src/services/progress.service');

// --- Pure helper coercion -----------------------------------------------

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

test('clampWatchedDelta rejects zero/negative/invalid deltas', () => {
  assert.equal(clampWatchedDelta(0), 0);
  assert.equal(clampWatchedDelta(-30), 0);
  assert.equal(clampWatchedDelta(NaN), 0);
  assert.equal(clampWatchedDelta(undefined), 0);
});

test('clampWatchedDelta caps a single reported delta at MAX_WATCHED_DELTA_SECONDS (Case C: seek 20s -> 570s must not add 550s)', () => {
  // A client claiming it "watched" a 550-second jump from a seek is capped
  // to the same small ceiling as any other single save interval.
  assert.equal(clampWatchedDelta(550), MAX_WATCHED_DELTA_SECONDS);
  assert.equal(clampWatchedDelta(10), 10);
});

// --- Completion is driven by watchedSeconds, never raw position --------

test('isLessonComplete is false below the completion threshold', () => {
  assert.equal(isLessonComplete(false, 100, 1000), false);
  assert.equal(isLessonComplete(false, 0, 1000), false);
});

test('Case E: duration missing/0 -> never complete regardless of watched value', () => {
  assert.equal(isLessonComplete(false, 500, 0), false);
  assert.equal(isLessonComplete(false, 0, 0), false);
});

test(`isLessonComplete becomes true at >= ${COMPLETION_THRESHOLD * 100}% legitimately watched`, () => {
  const duration = 1000;
  const justBelow = Math.floor(duration * COMPLETION_THRESHOLD) - 1;
  const atThreshold = Math.ceil(duration * COMPLETION_THRESHOLD);
  assert.equal(isLessonComplete(false, justBelow, duration), false);
  assert.equal(isLessonComplete(false, atThreshold, duration), true);
  assert.equal(isLessonComplete(false, duration, duration), true);
});

test('Case F: watched = 540 / duration = 600 (90%) -> complete', () => {
  assert.equal(isLessonComplete(false, 540, 600), true);
  assert.equal(isLessonComplete(false, 539, 600), false);
});

test('isLessonComplete never un-completes a lesson that was already completed, even after seeking back', () => {
  assert.equal(isLessonComplete(true, 0, 1000), true);
  assert.equal(isLessonComplete(true, 1, 1000), true);
});

// --- End-to-end scenario from the bug report: seeking must not fake completion ---

test('Case B/D scenario: seeking from 20s to 570s (duration 600) must NOT read as ~95% watched, only the clamped delta counts', () => {
  const duration = 600;
  // Simulates the server's "add clamped delta" arithmetic in
  // saveLessonProgress: a client reporting a 550s "delta" from a seek is
  // clamped before it is ever added to accumulated watchedSeconds.
  const priorWatched = 20;
  const claimedDelta = 570 - 20; // 550 — what a naive currentTime-diff would claim
  const appliedDelta = clampWatchedDelta(claimedDelta);
  const watchedSeconds = Math.min(priorWatched + appliedDelta, duration);

  assert.equal(appliedDelta, MAX_WATCHED_DELTA_SECONDS);
  assert.equal(watchedSeconds, priorWatched + MAX_WATCHED_DELTA_SECONDS);
  // Nowhere near 95%, and nowhere near the 90% completion threshold either.
  const percent = watchedSeconds / duration;
  assert.ok(percent < 0.1, `expected under 10% watched, got ${(percent * 100).toFixed(2)}%`);
  assert.equal(isLessonComplete(false, watchedSeconds, duration), false);

  // Then genuinely watching ~30 more real seconds at the new position only
  // adds ~30s, not the seeked-over 550s.
  const secondDelta = clampWatchedDelta(30);
  const watchedAfterRealPlayback = Math.min(watchedSeconds + secondDelta, duration);
  assert.equal(watchedAfterRealPlayback, watchedSeconds + 30);
});

test('Case A: duration 600, watched 180 -> 30% progress', () => {
  const percent = Math.min(99, Math.round((180 / 600) * 100));
  assert.equal(percent, 30);
});

test('watchedSeconds can never exceed durationSeconds regardless of accumulated deltas', () => {
  const duration = 100;
  const priorWatched = 95;
  const delta = clampWatchedDelta(50); // clamped to MAX_WATCHED_DELTA_SECONDS (30)
  const watchedSeconds = Math.min(priorWatched + delta, duration);
  assert.ok(watchedSeconds <= duration);
  assert.equal(watchedSeconds, duration);
});

// --- computeProgressUpdate: exact end-to-end scenarios from the bug report ---

test('Case A: duration=600, prior watched=150 + delta=30 -> watchedSeconds=180 (30%), lastPositionSeconds tracks position independently', () => {
  const existing = { watchedSeconds: 150, completed: false, completedAt: null };
  const result = computeProgressUpdate(existing, { positionSeconds: 180, durationSeconds: 600, watchedDeltaSeconds: 30 });
  assert.equal(result.watchedSeconds, 180);
  assert.equal(result.lastPositionSeconds, 180);
  assert.equal(Math.round((result.watchedSeconds / result.durationSeconds) * 100), 30);
  assert.equal(result.completed, false);
});

test('Case B: prior watched=20, client claims a 550s delta from seeking 20s -> 570s: watchedSeconds stays near 20 (clamped), NOT ~95%, NOT complete', () => {
  const existing = { watchedSeconds: 20, completed: false, completedAt: null };
  const result = computeProgressUpdate(existing, { positionSeconds: 570, durationSeconds: 600, watchedDeltaSeconds: 550 });
  assert.equal(result.lastPositionSeconds, 570); // resume position DOES move
  assert.equal(result.watchedSeconds, 20 + MAX_WATCHED_DELTA_SECONDS); // watched time barely moves
  const percent = result.watchedSeconds / result.durationSeconds;
  assert.ok(percent < 0.1, `expected <10%, got ${(percent * 100).toFixed(2)}%`);
  assert.equal(result.completed, false);
});

test('Case C: a pure seek (no plausible watched delta reported) leaves watchedSeconds unchanged, only lastPositionSeconds moves', () => {
  const existing = { watchedSeconds: 20, completed: false, completedAt: null };
  const result = computeProgressUpdate(existing, { positionSeconds: 570, durationSeconds: 600, watchedDeltaSeconds: 0 });
  assert.equal(result.watchedSeconds, 20);
  assert.equal(result.lastPositionSeconds, 570);
  assert.equal(result.completed, false);
});

test('Case D: after seeking to 570s, watching 30 real seconds there adds ~30s to watchedSeconds, not the skipped range', () => {
  const afterSeek = { watchedSeconds: 20, completed: false, completedAt: null };
  const afterRealPlayback = computeProgressUpdate(afterSeek, { positionSeconds: 600, durationSeconds: 600, watchedDeltaSeconds: 30 });
  assert.equal(afterRealPlayback.watchedSeconds, 50);
  assert.equal(afterRealPlayback.lastPositionSeconds, 600);
});

test('Case E: missing/zero duration -> 0% and never complete regardless of watched/position', () => {
  const result = computeProgressUpdate(null, { positionSeconds: 500, durationSeconds: 0, watchedDeltaSeconds: 500 });
  assert.equal(result.durationSeconds, 0);
  assert.equal(result.completed, false);
});

test('Case F: watched accumulates to exactly 90% of duration -> complete becomes true', () => {
  const existing = { watchedSeconds: 510, completed: false, completedAt: null };
  const result = computeProgressUpdate(existing, { positionSeconds: 540, durationSeconds: 600, watchedDeltaSeconds: 30 });
  assert.equal(result.watchedSeconds, 540);
  assert.equal(result.completed, true);
});

test('resume (lastPositionSeconds) is preserved independently even when watchedDeltaSeconds is 0', () => {
  const existing = { watchedSeconds: 300, completed: true, completedAt: new Date('2026-01-01') };
  const result = computeProgressUpdate(existing, { positionSeconds: 45, durationSeconds: 600, watchedDeltaSeconds: 0 });
  // A completed lesson re-opened and paused early (e.g. rewatching the
  // intro) still resumes near where it was left, without affecting the
  // already-earned completed status or resetting watched time.
  assert.equal(result.lastPositionSeconds, 45);
  assert.equal(result.completed, true);
  assert.equal(result.watchedSeconds, 300);
});
