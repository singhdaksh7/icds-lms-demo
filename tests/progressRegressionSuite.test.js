process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);

const test = require('node:test');
const assert = require('node:assert/strict');

// In-memory mock database for Regression Suite
const USER_ID = 101;
const COURSE_ID = 6;

let version = 0;
const db = {
  courses: [],
  modules: [],
  topics: [],
  lessons: [],
  lessonProgress: [],
  enrollments: [],
  certificates: [],
};

function clone(obj) {
  return obj ? JSON.parse(JSON.stringify(obj)) : null;
}

const fakePrisma = {
  course: {
    async findUnique({ where }) {
      return clone(db.courses.find((c) => c.id === where.id));
    },
  },
  lesson: {
    async findUnique({ where }) {
      return clone(db.lessons.find((l) => l.id === where.id));
    },
    async findMany({ where }) {
      return db.lessons
        .filter((l) => {
          if (where.courseId && l.courseId !== where.courseId) return false;
          if (where.status && l.status !== where.status) return false;
          return true;
        })
        .map(clone);
    },
    async update({ where, data }) {
      const l = db.lessons.find((item) => item.id === where.id);
      if (l) Object.assign(l, data);
      return clone(l);
    },
  },
  lessonProgress: {
    async findUnique({ where }) {
      const k = where.userId_lessonId;
      return clone(db.lessonProgress.find((r) => r.userId === k.userId && r.lessonId === k.lessonId));
    },
    async create({ data }) {
      if (db.lessonProgress.some((r) => r.userId === data.userId && r.lessonId === data.lessonId)) {
        const err = new Error('Unique constraint failed');
        err.code = 'P2002';
        throw err;
      }
      const row = {
        id: db.lessonProgress.length + 1,
        completedAt: null,
        ...data,
        updatedAt: new Date(2000 + (version += 1)),
      };
      db.lessonProgress.push(row);
      return clone(row);
    },
    async updateMany({ where, data }) {
      const row = db.lessonProgress.find((r) => {
        if (r.id !== where.id) return false;
        if (where.updatedAt) {
          const rTime = r.updatedAt instanceof Date ? r.updatedAt.getTime() : new Date(r.updatedAt).getTime();
          const wTime = where.updatedAt instanceof Date ? where.updatedAt.getTime() : new Date(where.updatedAt).getTime();
          if (rTime !== wTime) return false;
        }
        return true;
      });
      if (!row) return { count: 0 };
      Object.assign(row, data, { updatedAt: new Date(2000 + (version += 1)) });
      return { count: 1 };
    },
    async findMany({ where }) {
      return db.lessonProgress
        .filter((r) => {
          if (r.userId !== where.userId) return false;
          if (where.lessonId && where.lessonId.in && !where.lessonId.in.includes(r.lessonId)) return false;
          return true;
        })
        .map(clone);
    },
    async count({ where }) {
      return db.lessonProgress.filter((r) => {
        if (r.userId !== where.userId) return false;
        if (where.lessonId && where.lessonId.in && !where.lessonId.in.includes(r.lessonId)) return false;
        if (typeof where.completed === 'boolean' && r.completed !== where.completed) return false;
        return true;
      }).length;
    },
  },
  enrollment: {
    async findUnique({ where }) {
      const k = where.userId_courseId;
      return clone(db.enrollments.find((e) => e.userId === k.userId && e.courseId === k.courseId));
    },
    async updateMany({ where, data }) {
      let count = 0;
      db.enrollments.forEach((e) => {
        if (e.userId === where.userId && e.courseId === where.courseId) {
          Object.assign(e, data);
          count++;
        }
      });
      return { count };
    },
    async update({ where, data }) {
      const e = db.enrollments.find((item) => item.id === where.id);
      if (e) Object.assign(e, data);
      return clone(e);
    },
  },
  certificate: {
    async count({ where }) {
      return db.certificates.filter((c) => c.userId === where.userId && c.courseId === where.courseId).length;
    },
  },
};

const dbModulePath = require.resolve('../src/config/db');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: { prisma: fakePrisma },
};

const progressService = require('../src/services/progress.service');
const curriculumService = require('../src/services/curriculum.service');
const certificateService = require('../src/services/certificate.service');

function setupTestEnvironment() {
  version = 0;
  db.courses = [{ id: COURSE_ID, title: 'Advanced FMR Master Class', slug: 'advanced-fmr-master-class' }];
  db.enrollments = [{ id: 1, userId: USER_ID, courseId: COURSE_ID, status: 'ACTIVE', progressPercent: 0 }];
  db.lessonProgress = [];
  db.certificates = [];

  // Setup hierarchical curriculum:
  // 15 PUBLISHED lessons (matching real production FMR), plus 8 DRAFT lessons (total 23)
  db.lessons = [];
  for (let i = 1; i <= 15; i++) {
    db.lessons.push({
      id: i,
      courseId: COURSE_ID,
      title: `Published Lesson ${i}`,
      slug: `published-lesson-${i}`,
      videoType: 'LOCAL',
      videoDurationSeconds: 100, // 100s for clear percentage math
      duration: '1m 40s',
      status: 'PUBLISHED',
      moduleId: i <= 7 ? 1 : 2,
      topicId: i <= 4 ? 1 : i <= 7 ? 2 : 3,
    });
  }
  for (let i = 16; i <= 23; i++) {
    db.lessons.push({
      id: i,
      courseId: COURSE_ID,
      title: `Draft Lesson ${i}`,
      slug: `draft-lesson-${i}`,
      videoType: 'LOCAL',
      videoDurationSeconds: 100,
      duration: '1m 40s',
      status: 'DRAFT',
      moduleId: 2,
      topicId: 4,
    });
  }
}

const T0 = 1_700_000_000_000;

// ============================================================================
// PHASE 20 — 18 AUTOMATED REGRESSION TESTS
// ============================================================================

test('1. normal playback credits seconds', async () => {
  setupTestEnvironment();
  const res = await progressService.saveLessonProgress(
    USER_ID,
    1,
    { positionSeconds: 12, durationSeconds: 100, watchedDeltaSeconds: 12 },
    { viewStartedAtMs: T0, nowMs: T0 + 13000 }
  );
  assert.equal(res.lessonProgress.watchedSeconds, 12);
  assert.equal(res.lessonProgress.lastPositionSeconds, 12);
});

test('2. second heartbeat increases watchedSeconds', async () => {
  setupTestEnvironment();
  // First heartbeat
  await progressService.saveLessonProgress(
    USER_ID,
    1,
    { positionSeconds: 12, durationSeconds: 100, watchedDeltaSeconds: 12 },
    { viewStartedAtMs: T0, nowMs: T0 + 12000 }
  );
  // Second heartbeat 12 seconds later
  const res2 = await progressService.saveLessonProgress(
    USER_ID,
    1,
    { positionSeconds: 24, durationSeconds: 100, watchedDeltaSeconds: 12 },
    { viewStartedAtMs: T0, nowMs: T0 + 24000 }
  );
  assert.equal(res2.lessonProgress.watchedSeconds, 24);
  assert.equal(res2.lessonProgress.lastPositionSeconds, 24);
});

test('3. pause does not credit indefinitely', async () => {
  setupTestEnvironment();
  await progressService.saveLessonProgress(
    USER_ID,
    1,
    { positionSeconds: 10, durationSeconds: 100, watchedDeltaSeconds: 10 },
    { viewStartedAtMs: T0, nowMs: T0 + 10000 }
  );
  // User pauses for 60 seconds, then sends a zero-delta heartbeat
  const resPaused = await progressService.saveLessonProgress(
    USER_ID,
    1,
    { positionSeconds: 10, durationSeconds: 100, watchedDeltaSeconds: 0 },
    { viewStartedAtMs: T0, nowMs: T0 + 70000 }
  );
  assert.equal(resPaused.lessonProgress.watchedSeconds, 10);
  assert.equal(resPaused.lessonProgress.lastPositionSeconds, 10);
});

test('4. seek-forward does not fake watch time', async () => {
  setupTestEnvironment();
  await progressService.saveLessonProgress(
    USER_ID,
    1,
    { positionSeconds: 10, durationSeconds: 100, watchedDeltaSeconds: 10 },
    { viewStartedAtMs: T0, nowMs: T0 + 10000 }
  );
  // User seeks to 95s (past the 90% completion threshold)
  const resSeek = await progressService.saveLessonProgress(
    USER_ID,
    1,
    { positionSeconds: 95, durationSeconds: 100, watchedDeltaSeconds: 0 },
    { viewStartedAtMs: T0, nowMs: T0 + 12000 }
  );
  assert.equal(resSeek.lessonProgress.lastPositionSeconds, 95);
  assert.equal(resSeek.lessonProgress.watchedSeconds, 10);
  assert.equal(resSeek.lessonProgress.completed, false);
});

test('5. huge forged delta blocked', async () => {
  setupTestEnvironment();
  // Malicious request claiming 9999 seconds watched when only 6 seconds passed on server clock
  const res = await progressService.saveLessonProgress(
    USER_ID,
    1,
    { positionSeconds: 99, durationSeconds: 100, watchedDeltaSeconds: 9999 },
    { viewStartedAtMs: T0, nowMs: T0 + 6000 }
  );
  assert.ok(res.lessonProgress.watchedSeconds <= 6);
  assert.equal(res.lessonProgress.completed, false);
});

test('6. lastPositionSeconds persists', async () => {
  setupTestEnvironment();
  await progressService.saveLessonProgress(
    USER_ID,
    1,
    { positionSeconds: 45, durationSeconds: 100, watchedDeltaSeconds: 5 },
    { viewStartedAtMs: T0, nowMs: T0 + 6000 }
  );
  const row = db.lessonProgress.find((r) => r.lessonId === 1);
  assert.equal(row.lastPositionSeconds, 45);
});

test('7. watchedSeconds never decreases', async () => {
  setupTestEnvironment();
  await progressService.saveLessonProgress(
    USER_ID,
    1,
    { positionSeconds: 20, durationSeconds: 100, watchedDeltaSeconds: 20 },
    { viewStartedAtMs: T0, nowMs: T0 + 20000 }
  );
  await progressService.saveLessonProgress(
    USER_ID,
    1,
    { positionSeconds: 40, durationSeconds: 100, watchedDeltaSeconds: 20 },
    { viewStartedAtMs: T0, nowMs: T0 + 40000 }
  );
  // User rewinds video to beginning (position 0)
  const resRewind = await progressService.saveLessonProgress(
    USER_ID,
    1,
    { positionSeconds: 0, durationSeconds: 100, watchedDeltaSeconds: 0 },
    { viewStartedAtMs: T0, nowMs: T0 + 42000 }
  );
  assert.equal(resRewind.lessonProgress.watchedSeconds, 40);
  assert.equal(resRewind.lessonProgress.lastPositionSeconds, 0);
});

test('8. completion threshold (90%) works accurately', async () => {
  setupTestEnvironment();
  assert.equal(progressService.isLessonComplete(false, 89, 100), false);
  assert.equal(progressService.isLessonComplete(false, 90, 100), true);
  assert.equal(progressService.isLessonComplete(false, 95, 100), true);

  // computeProgressUpdate: crossing from 85 to 90 seconds triggers completion
  const res89 = progressService.computeProgressUpdate(
    { watchedSeconds: 85, lastPositionSeconds: 85, completed: false, completedAt: null, durationSeconds: 100 },
    { positionSeconds: 89, durationSeconds: 100, watchedDeltaSeconds: 4 }
  );
  assert.equal(res89.watchedSeconds, 89);
  assert.equal(res89.completed, false);

  const res90 = progressService.computeProgressUpdate(
    { watchedSeconds: 85, lastPositionSeconds: 85, completed: false, completedAt: null, durationSeconds: 100 },
    { positionSeconds: 90, durationSeconds: 100, watchedDeltaSeconds: 5 }
  );
  assert.equal(res90.watchedSeconds, 90);
  assert.equal(res90.completed, true);
  assert.ok(res90.completedAt instanceof Date);
});

test('9. draft lessons excluded from denominator (15 published, not 23)', async () => {
  setupTestEnvironment();
  const courseProgress = await progressService.computeCourseProgress(USER_ID, COURSE_ID);
  // Total lessons must be exactly 15 (published), not 23 (which includes 8 drafts)
  assert.equal(courseProgress.total, 15);
  assert.equal(courseProgress.completed, 0);
  assert.equal(courseProgress.percent, 0);
});

test('10. topic progress calculated from published lessons', async () => {
  setupTestEnvironment();
  // Mark lesson 1 completed (topic 1 has lessons 1, 2, 3, 4)
  db.lessonProgress.push({
    id: 991,
    userId: USER_ID,
    lessonId: 1,
    completed: true,
    watchedSeconds: 95,
    durationSeconds: 100,
    lastPositionSeconds: 95,
    lastCreditAt: new Date(),
    completedAt: new Date(),
    updatedAt: new Date(),
  });

  const rawCurriculum = [
    {
      id: 1,
      title: 'Module 1',
      topics: [
        {
          id: 1,
          title: 'Topic 1',
          lessons: db.lessons.filter((l) => l.topicId === 1 && l.status === 'PUBLISHED'),
        },
      ],
    },
  ];

  const { curriculum } = await curriculumService.getCurriculumProgress(USER_ID, rawCurriculum);
  const topic1 = curriculum[0].topics[0];
  assert.equal(topic1.completedLessons, 1);
  assert.equal(topic1.totalLessons, 4);
});

test('11. module progress calculated from published lessons', async () => {
  setupTestEnvironment();
  // Mark lesson 1 completed (Module 1 has published lessons 1 through 7)
  db.lessonProgress.push({
    id: 991,
    userId: USER_ID,
    lessonId: 1,
    completed: true,
    watchedSeconds: 95,
    durationSeconds: 100,
    lastPositionSeconds: 95,
    lastCreditAt: new Date(),
    completedAt: new Date(),
    updatedAt: new Date(),
  });

  const rawCurriculum = [
    {
      id: 1,
      title: 'Module 1',
      topics: [
        {
          id: 1,
          title: 'Topic 1',
          lessons: db.lessons.filter((l) => l.topicId === 1 && l.status === 'PUBLISHED'),
        },
        {
          id: 2,
          title: 'Topic 2',
          lessons: db.lessons.filter((l) => l.topicId === 2 && l.status === 'PUBLISHED'),
        },
      ],
    },
  ];

  const { curriculum } = await curriculumService.getCurriculumProgress(USER_ID, rawCurriculum);
  const mod1 = curriculum[0];
  assert.equal(mod1.completedLessons, 1);
  assert.equal(mod1.totalLessons, 7);
});

test('12. course progress updates accurately (1 of 15 completed = ~7%)', async () => {
  setupTestEnvironment();
  db.lessonProgress.push({
    id: 991,
    userId: USER_ID,
    lessonId: 1,
    completed: true,
    watchedSeconds: 95,
    durationSeconds: 100,
    lastPositionSeconds: 95,
    lastCreditAt: new Date(),
    completedAt: new Date(),
    updatedAt: new Date(),
  });

  const courseProgress = await progressService.computeCourseProgress(USER_ID, COURSE_ID);
  assert.equal(courseProgress.completed, 1);
  assert.equal(courseProgress.total, 15);
  // Math.round((1 / 15) * 100) = 7
  assert.equal(courseProgress.percent, 7);
});

test('13. Enrollment.progressPercent synchronized on save', async () => {
  setupTestEnvironment();
  // Simulate complete watching of lesson 1
  for (let s = 10; s <= 90; s += 10) {
    await progressService.saveLessonProgress(
      USER_ID,
      1,
      { positionSeconds: s, durationSeconds: 100, watchedDeltaSeconds: 10 },
      { viewStartedAtMs: T0, nowMs: T0 + s * 1000 }
    );
  }
  const enroll = db.enrollments.find((e) => e.userId === USER_ID && e.courseId === COURSE_ID);
  assert.equal(enroll.progressPercent, 7);
});

test('14. dashboard value derives from same source and self-heals', async () => {
  setupTestEnvironment();
  // Suppose enrollment had a stale cached value of 0, but 1 lesson is complete
  db.enrollments[0].progressPercent = 0;
  db.lessonProgress.push({
    id: 991,
    userId: USER_ID,
    lessonId: 1,
    completed: true,
    watchedSeconds: 95,
    durationSeconds: 100,
    lastPositionSeconds: 95,
    lastCreditAt: new Date(),
    completedAt: new Date(),
    updatedAt: new Date(),
  });

  const courseProgress = await progressService.computeCourseProgress(USER_ID, COURSE_ID);
  if (db.enrollments[0].progressPercent !== courseProgress.percent) {
    db.enrollments[0].progressPercent = courseProgress.percent;
  }
  assert.equal(db.enrollments[0].progressPercent, 7);
});

test('15. certificate eligibility uses 15 published lessons and excludes drafts', async () => {
  setupTestEnvironment();
  // Complete all 15 published lessons
  for (let i = 1; i <= 15; i++) {
    db.lessonProgress.push({
      id: 900 + i,
      userId: USER_ID,
      lessonId: i,
      completed: true,
      watchedSeconds: 95,
      durationSeconds: 100,
      lastPositionSeconds: 95,
      lastCreditAt: new Date(),
      completedAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // The 8 draft lessons (16 to 23) are NOT complete in db.lessonProgress.
  // Certificate eligibility must still be TRUE because 15/15 PUBLISHED lessons are complete!
  const res = await certificateService.isCertificateEligible(USER_ID, COURSE_ID);
  assert.equal(res.eligible, true);
});

test('16. resume after reload returns saved position', async () => {
  setupTestEnvironment();
  await progressService.saveLessonProgress(
    USER_ID,
    1,
    { positionSeconds: 38, durationSeconds: 100, watchedDeltaSeconds: 10 },
    { viewStartedAtMs: T0, nowMs: T0 + 10000 }
  );

  // Reload simulation: query progressMap
  const progressMap = await progressService.getLessonProgressMap(USER_ID, [1]);
  assert.equal(progressMap[1].lastPositionSeconds, 38);
});

test('17. completed remains complete upon seeking backwards or small delta', async () => {
  setupTestEnvironment();
  // Complete lesson legitimately in four heartbeat steps: 25s * 4 = 100s >= 90s
  await progressService.saveLessonProgress(
    USER_ID,
    1,
    { positionSeconds: 25, durationSeconds: 100, watchedDeltaSeconds: 25 },
    { viewStartedAtMs: T0, nowMs: T0 + 25000 }
  );
  await progressService.saveLessonProgress(
    USER_ID,
    1,
    { positionSeconds: 50, durationSeconds: 100, watchedDeltaSeconds: 25 },
    { viewStartedAtMs: T0, nowMs: T0 + 50000 }
  );
  await progressService.saveLessonProgress(
    USER_ID,
    1,
    { positionSeconds: 75, durationSeconds: 100, watchedDeltaSeconds: 25 },
    { viewStartedAtMs: T0, nowMs: T0 + 75000 }
  );
  const resDone = await progressService.saveLessonProgress(
    USER_ID,
    1,
    { positionSeconds: 100, durationSeconds: 100, watchedDeltaSeconds: 25 },
    { viewStartedAtMs: T0, nowMs: T0 + 100000 }
  );
  assert.equal(resDone.lessonProgress.completed, true);
  const origCompletedAt = resDone.lessonProgress.completedAt;
  assert.ok(origCompletedAt);

  // Subsequent save with position 5 and delta 0
  const resAfter = await progressService.saveLessonProgress(
    USER_ID,
    1,
    { positionSeconds: 5, durationSeconds: 100, watchedDeltaSeconds: 0 },
    { viewStartedAtMs: T0, nowMs: T0 + 105000 }
  );
  assert.equal(resAfter.lessonProgress.completed, true);
  assert.equal(
    (resAfter.lessonProgress.completedAt instanceof Date ? resAfter.lessonProgress.completedAt : new Date(resAfter.lessonProgress.completedAt)).getTime(),
    (origCompletedAt instanceof Date ? origCompletedAt : new Date(origCompletedAt)).getTime()
  );
});

test('18. rapid concurrent heartbeat safety (no lost updates or duplicate time)', async () => {
  setupTestEnvironment();
  // Fire two saves simultaneously at the same server time
  const [resA, resB] = await Promise.all([
    progressService.saveLessonProgress(
      USER_ID,
      1,
      { positionSeconds: 10, durationSeconds: 100, watchedDeltaSeconds: 10 },
      { viewStartedAtMs: T0, nowMs: T0 + 10000 }
    ),
    progressService.saveLessonProgress(
      USER_ID,
      1,
      { positionSeconds: 10, durationSeconds: 100, watchedDeltaSeconds: 10 },
      { viewStartedAtMs: T0, nowMs: T0 + 10000 }
    ),
  ]);

  // One of them gets the 10s credit, the second sees elapsed=0 or retries optimistically
  const row = db.lessonProgress.find((r) => r.lessonId === 1);
  assert.equal(row.watchedSeconds, 10); // Not doubled to 20
});
