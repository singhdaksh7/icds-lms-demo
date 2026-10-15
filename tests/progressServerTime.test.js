process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);

const test = require('node:test');
const assert = require('node:assert/strict');

// --- In-memory stand-in for the Prisma client ------------------------------
// The real service code (saveLessonProgress, markLessonComplete,
// isCertificateEligible) runs unchanged against this; only the database is
// faked. It models the pieces that matter for the hardening: a unique
// (userId, lessonId) row, and updateMany({ where: { id, updatedAt } }) as an
// optimistic-concurrency check.
const USER = 1;
const COURSE = 10;
let version = 0;
const db = { lessons: [], progress: [], enrollments: [] };

function clone(row) { return row ? { ...row } : null; }

const fakePrisma = {
  lesson: {
    async findUnique({ where }) { await Promise.resolve(); return clone(db.lessons.find((l) => l.id === where.id)); },
    async findMany({ where }) { return db.lessons.filter((l) => l.courseId === where.courseId && l.status === where.status).map((l) => ({ id: l.id })); },
  },
  enrollment: {
    async findUnique() { return db.enrollments[0] ? { ...db.enrollments[0] } : null; },
    async updateMany() { return { count: 1 }; },
  },
  lessonProgress: {
    async findUnique({ where }) {
      await Promise.resolve();
      const k = where.userId_lessonId;
      return clone(db.progress.find((r) => r.userId === k.userId && r.lessonId === k.lessonId));
    },
    async create({ data }) {
      await Promise.resolve();
      if (db.progress.some((r) => r.userId === data.userId && r.lessonId === data.lessonId)) {
        const err = new Error('unique'); err.code = 'P2002'; throw err;
      }
      const row = { id: db.progress.length + 1, completedAt: null, ...data, updatedAt: new Date(1000 + (version += 1)) };
      db.progress.push(row);
      return clone(row);
    },
    async updateMany({ where, data }) {
      await Promise.resolve();
      const row = db.progress.find((r) => r.id === where.id && r.updatedAt.getTime() === where.updatedAt.getTime());
      if (!row) return { count: 0 };
      Object.assign(row, data, { updatedAt: new Date(1000 + (version += 1)) });
      return { count: 1 };
    },
    async findMany({ where }) { return db.progress.filter((r) => r.userId === where.userId && where.lessonId.in.includes(r.lessonId)).map(clone); },
    async count({ where }) { return db.progress.filter((r) => r.userId === where.userId && where.lessonId.in.includes(r.lessonId) && r.completed === where.completed).length; },
  },
};

const dbModulePath = require.resolve('../src/config/db');
require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: { prisma: fakePrisma } };

const progress = require('../src/services/progress.service');
const certificates = require('../src/services/certificate.service');

function reset({ duration = 60, videoType = 'LOCAL', lessonCount = 1 } = {}) {
  version = 0;
  db.lessons = Array.from({ length: lessonCount }, (_, i) => ({ id: i + 1, courseId: COURSE, status: 'PUBLISHED', videoType }));
  db.progress = [];
  db.enrollments = [{ userId: USER, courseId: COURSE, status: 'ACTIVE' }];
  return duration;
}

const T0 = 1_700_000_000_000; // arbitrary "page served" time (ms)
const save = (lessonId, report, nowMs, viewStartedAtMs = T0) =>
  progress.saveLessonProgress(USER, lessonId, report, { nowMs, viewStartedAtMs });
const row = (lessonId = 1) => db.progress.find((r) => r.lessonId === lessonId);

// --- pure credit function --------------------------------------------------

test('computeCreditedDelta: a huge reported delta is capped by real elapsed time', () => {
  const r = progress.computeCreditedDelta({ reportedDelta: 9999, referenceMs: T0, nowMs: T0 + 5000 });
  assert.equal(r.credited, 5);
});

test('computeCreditedDelta: never exceeds the per-save ceiling even after a long gap', () => {
  const r = progress.computeCreditedDelta({ reportedDelta: 9999, referenceMs: T0, nowMs: T0 + 600_000 });
  assert.equal(r.credited, progress.MAX_WATCHED_DELTA_SECONDS);
});

test('computeCreditedDelta: with no trustworthy reference nothing is credited and the clock starts now', () => {
  const r = progress.computeCreditedDelta({ reportedDelta: 30, referenceMs: null, nowMs: T0 });
  assert.equal(r.credited, 0);
  assert.equal(r.nextReferenceMs, T0);
});

test('computeCreditedDelta: negative / NaN / future reference never produce credit or negative values', () => {
  assert.equal(progress.computeCreditedDelta({ reportedDelta: -5, referenceMs: T0, nowMs: T0 + 10_000 }).credited, 0);
  assert.equal(progress.computeCreditedDelta({ reportedDelta: NaN, referenceMs: T0, nowMs: T0 + 10_000 }).credited, 0);
  assert.equal(progress.computeCreditedDelta({ reportedDelta: 20, referenceMs: T0 + 60_000, nowMs: T0 }).credited, 0);
});

test('computeCreditedDelta: the unspent-time bank is capped so idle time cannot become a burst', () => {
  const r = progress.computeCreditedDelta({ reportedDelta: 0, referenceMs: T0, nowMs: T0 + 3_600_000 });
  assert.equal(r.credited, 0);
  assert.equal(r.nextReferenceMs, T0 + 3_600_000 - progress.MAX_CLOCK_BANK_SECONDS * 1000);
});

// --- end-to-end through saveLessonProgress ---------------------------------

test('first legitimate save gets reasonable credit (bounded by time since the page was served)', async () => {
  reset();
  const { lessonProgress } = await save(1, { positionSeconds: 12, durationSeconds: 60, watchedDeltaSeconds: 11 }, T0 + 12_300);
  assert.equal(lessonProgress.watchedSeconds, 11);
  assert.equal(lessonProgress.lastPositionSeconds, 12);
});

test('a single request claiming 9999s only gets the real elapsed time', async () => {
  reset();
  const { lessonProgress } = await save(1, { positionSeconds: 60, durationSeconds: 60, watchedDeltaSeconds: 9999 }, T0 + 4_000);
  assert.equal(lessonProgress.watchedSeconds, 4);
  assert.equal(lessonProgress.completed, false);
});

test('rapid replay every 100ms cannot accumulate watch time (fake completion impossible)', async () => {
  reset();
  // 20 real seconds pass; the attacker fires a 9999s claim every 100ms (200 requests).
  for (let i = 1; i <= 200; i += 1) {
    await save(1, { positionSeconds: 59, durationSeconds: 60, watchedDeltaSeconds: 9999 }, T0 + i * 100);
  }
  const r = row();
  assert.ok(r.watchedSeconds <= 20, `watched ${r.watchedSeconds}s must not exceed the 20s of real time`);
  assert.equal(r.completed, false);
});

test('immediate second request gets little or no credit; after 10 real seconds up to ~10s is credited', async () => {
  reset();
  await save(1, { positionSeconds: 10, durationSeconds: 60, watchedDeltaSeconds: 10 }, T0 + 10_000);
  const afterFirst = row().watchedSeconds;
  assert.equal(afterFirst, 10);

  await save(1, { positionSeconds: 10, durationSeconds: 60, watchedDeltaSeconds: 30 }, T0 + 10_100);
  assert.ok(row().watchedSeconds - afterFirst <= 1, 'replay 100ms later must add at most the tiny unspent remainder');

  const before = row().watchedSeconds;
  await save(1, { positionSeconds: 20, durationSeconds: 60, watchedDeltaSeconds: 30 }, T0 + 20_100);
  const gained = row().watchedSeconds - before;
  assert.ok(gained >= 9 && gained <= 10, `expected ~10s after 10 real seconds, got ${gained}`);
});

test('parallel simultaneous requests cannot each spend the same elapsed time', async () => {
  reset();
  await save(1, { positionSeconds: 10, durationSeconds: 60, watchedDeltaSeconds: 10 }, T0 + 10_000);
  const before = row().watchedSeconds;
  await Promise.all(Array.from({ length: 25 }, () =>
    save(1, { positionSeconds: 20, durationSeconds: 60, watchedDeltaSeconds: 30 }, T0 + 20_000)));
  assert.ok(row().watchedSeconds - before <= 10, `25 parallel claims gained ${row().watchedSeconds - before}s (max allowed 10)`);
});

test('legitimate elapsed playback is credited in full (no systematic loss from jitter)', async () => {
  reset();
  // Real viewer: page served, playback starts ~1s later, saves roughly every 12s
  // (with +/- jitter), watching the whole 60s video.
  let now = T0;
  let lastSaveAt = T0 + 1000;
  const jitter = [150, -200, 90, 320, -120, 40];
  for (let i = 0; i < 5; i += 1) {
    now = lastSaveAt + 12_000 + jitter[i];
    const watched = Math.floor((now - lastSaveAt) / 1000);
    await save(1, { positionSeconds: (i + 1) * 12, durationSeconds: 60, watchedDeltaSeconds: watched }, now);
    lastSaveAt = now;
  }
  const r = row();
  assert.ok(r.watchedSeconds >= 55, `a real viewer should get ~all of their watch time, got ${r.watchedSeconds}`);
});

test('valid completion still works: watching ~the whole video completes the lesson', async () => {
  reset();
  let t = T0;
  for (let i = 0; i < 6; i += 1) {
    t += 11_000; // 11s of real playback between saves
    await save(1, { positionSeconds: (i + 1) * 11, durationSeconds: 60, watchedDeltaSeconds: 11 }, t);
  }
  assert.equal(row().completed, true);
  assert.ok(row().watchedSeconds / 60 >= progress.COMPLETION_THRESHOLD);
});

test('seek position stays independent: jumping to the end moves lastPosition but not watched time', async () => {
  reset();
  await save(1, { positionSeconds: 10, durationSeconds: 60, watchedDeltaSeconds: 10 }, T0 + 10_000);
  await save(1, { positionSeconds: 58, durationSeconds: 60, watchedDeltaSeconds: 0 }, T0 + 10_500);
  const r = row();
  assert.equal(r.lastPositionSeconds, 58);
  assert.equal(r.watchedSeconds, 10);
  assert.equal(r.completed, false);
});

test('without a recorded page-view time the first save credits nothing (and starts the clock)', async () => {
  reset();
  const { lessonProgress } = await save(1, { positionSeconds: 30, durationSeconds: 60, watchedDeltaSeconds: 30 }, T0 + 30_000, null);
  assert.equal(lessonProgress.watchedSeconds, 0);
  assert.equal(lessonProgress.lastPositionSeconds, 30);
  assert.ok(row().lastCreditAt instanceof Date);
});

test('a student cannot be credited for a lesson they are not enrolled in', async () => {
  reset();
  db.enrollments = [];
  await assert.rejects(() => save(1, { positionSeconds: 1, durationSeconds: 60, watchedDeltaSeconds: 1 }, T0 + 1000), /not enrolled/i);
});

// --- manual completion bypass ----------------------------------------------

test('"Mark Complete" is rejected for self-hosted (tracked) video lessons', async () => {
  reset({ videoType: 'LOCAL' });
  await assert.rejects(() => progress.markLessonComplete(USER, 1), /watching the video/i);
  assert.equal(row(), undefined);
});

// --- certificate gating ----------------------------------------------------

test('certificate is unavailable before legitimate completion, including after fake progress requests', async () => {
  reset({ lessonCount: 2 });
  assert.equal((await certificates.isCertificateEligible(USER, COURSE)).eligible, false);

  // attacker hammers both lessons with huge claims for 3 real seconds
  for (let i = 1; i <= 30; i += 1) {
    await save(1, { positionSeconds: 59, durationSeconds: 60, watchedDeltaSeconds: 9999 }, T0 + i * 100);
    await save(2, { positionSeconds: 59, durationSeconds: 60, watchedDeltaSeconds: 9999 }, T0 + i * 100);
  }
  assert.equal((await certificates.isCertificateEligible(USER, COURSE)).eligible, false);
});

test('certificate becomes available once every lesson is genuinely completed', async () => {
  reset({ lessonCount: 2 });
  for (const lessonId of [1, 2]) {
    let t = T0;
    for (let i = 0; i < 6; i += 1) {
      t += 11_000;
      await save(lessonId, { positionSeconds: (i + 1) * 11, durationSeconds: 60, watchedDeltaSeconds: 11 }, t);
    }
  }
  assert.equal((await certificates.isCertificateEligible(USER, COURSE)).eligible, true);
});
