process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

const test = require('node:test');
const assert = require('node:assert/strict');

const { prisma } = require('../src/config/db');
const curriculumService = require('../src/services/curriculum.service');
const videoStorageSettingsService = require('../src/services/videoStorageSettings.service');
const r2 = require('../src/lib/r2');

// --- 1. Cross-course validation ------------------------------------------------

test('validateTopicCourseBinding rejects when topic belongs to a different course', async () => {
  const origFindUnique = prisma.courseTopic.findUnique;
  prisma.courseTopic.findUnique = async ({ where }) => {
    if (where.id === 99) {
      return {
        id: 99,
        moduleId: 10,
        module: { id: 10, courseId: 777 }, // Belongs to course 777
      };
    }
    return null;
  };

  try {
    // Attempting to bind topic 99 to course 100
    await assert.rejects(
      async () => {
        await curriculumService.validateTopicCourseBinding(100, 99);
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.ok(err.message.includes('Cross-course topic assignment rejected'));
        return true;
      }
    );
  } finally {
    prisma.courseTopic.findUnique = origFindUnique;
  }
});

test('validateTopicCourseBinding succeeds when topic belongs to the same course', async () => {
  const origFindUnique = prisma.courseTopic.findUnique;
  prisma.courseTopic.findUnique = async ({ where }) => {
    if (where.id === 55) {
      return {
        id: 55,
        moduleId: 12,
        module: { id: 12, courseId: 100 }, // Same course 100
      };
    }
    return null;
  };

  try {
    const topic = await curriculumService.validateTopicCourseBinding(100, 55);
    assert.equal(topic.id, 55);
    assert.equal(topic.module.courseId, 100);
  } finally {
    prisma.courseTopic.findUnique = origFindUnique;
  }
});

test('validateTopicCourseBinding returns null when topicId is null/undefined', async () => {
  const result = await curriculumService.validateTopicCourseBinding(100, null);
  assert.equal(result, null);
});

test('validateResourceCourseBinding rejects cross-course topic attachment', async () => {
  const origFindUnique = prisma.courseTopic.findUnique;
  prisma.courseTopic.findUnique = async () => ({
    id: 99,
    moduleId: 10,
    module: { id: 10, courseId: 999 }, // Belongs to course 999
  });

  try {
    await assert.rejects(
      async () => {
        await curriculumService.validateResourceCourseBinding(100, 99);
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.ok(err.message.includes('Cross-course topic assignment rejected'));
        return true;
      }
    );
  } finally {
    prisma.courseTopic.findUnique = origFindUnique;
  }
});

// --- 2. Delete safety -----------------------------------------------------------

test('deleteTopic unassigns lessons without deleting lesson rows or media files', async () => {
  let unassignedLessons = null;
  let unassignedResources = null;
  let deletedTopicId = null;

  const origFindUnique = prisma.courseTopic.findUnique;
  const origTx = prisma.$transaction;

  prisma.courseTopic.findUnique = async () => ({ id: 42, title: 'Safe Topic' });
  prisma.$transaction = async (fn) => {
    const tx = {
      courseTopic: {
        findUnique: async () => ({ id: 42, title: 'Safe Topic' }),
        delete: async ({ where }) => { deletedTopicId = where.id; },
      },
      lesson: {
        updateMany: async ({ where, data }) => {
          unassignedLessons = { where, data };
        },
      },
      courseResource: {
        updateMany: async ({ where, data }) => {
          unassignedResources = { where, data };
        },
      },
    };
    return fn(tx);
  };

  try {
    const res = await curriculumService.deleteTopic(42);
    assert.equal(res.success, true);
    assert.equal(deletedTopicId, 42);
    assert.deepEqual(unassignedLessons.where, { topicId: 42 });
    assert.deepEqual(unassignedLessons.data, { topicId: null });
    assert.deepEqual(unassignedResources.where, { topicId: 42 });
    assert.deepEqual(unassignedResources.data, { topicId: null });
  } finally {
    prisma.courseTopic.findUnique = origFindUnique;
    prisma.$transaction = origTx;
  }
});

test('deleteModule unassigns lessons from all child topics without deleting lessons', async () => {
  let unassignedLessonsWhere = null;
  let deletedModuleId = null;

  const origFindUnique = prisma.courseModule.findUnique;
  const origTx = prisma.$transaction;

  prisma.courseModule.findUnique = async () => ({
    id: 77,
    title: 'Safe Module',
    topics: [{ id: 101 }, { id: 102 }],
  });

  prisma.$transaction = async (fn) => {
    const tx = {
      courseModule: {
        findUnique: async () => ({
          id: 77,
          title: 'Safe Module',
          topics: [{ id: 101 }, { id: 102 }],
        }),
        delete: async ({ where }) => { deletedModuleId = where.id; },
      },
      lesson: {
        updateMany: async ({ where, data }) => {
          unassignedLessonsWhere = where;
          assert.equal(data.topicId, null);
        },
      },
      courseResource: {
        updateMany: async () => {},
      },
    };
    return fn(tx);
  };

  try {
    const res = await curriculumService.deleteModule(77);
    assert.equal(res.success, true);
    assert.equal(deletedModuleId, 77);
    assert.deepEqual(unassignedLessonsWhere, { topicId: { in: [101, 102] } });
  } finally {
    prisma.courseModule.findUnique = origFindUnique;
    prisma.$transaction = origTx;
  }
});

// --- 3. Legacy Fallback Virtual Container ---------------------------------------

test('structureCurriculum wraps legacy flat lessons in virtual fallback module and topic', () => {
  const course = { id: 10, title: 'Legacy Course' };
  const flatLessons = [
    { id: 1, title: 'Old Lesson 1', topicId: null },
    { id: 2, title: 'Old Lesson 2', topicId: null },
  ];
  const emptyModules = [];

  const structured = curriculumService.structureCurriculum(course, emptyModules, flatLessons);
  assert.equal(structured.length, 1);
  assert.equal(structured[0].isVirtual, true);
  assert.equal(structured[0].title, 'Course Curriculum');
  assert.equal(structured[0].topics.length, 1);
  assert.equal(structured[0].topics[0].isVirtual, true);
  assert.equal(structured[0].topics[0].title, 'All Lessons');
  assert.equal(structured[0].topics[0].lessons.length, 2);
  assert.equal(structured[0].topics[0].lessons[0].title, 'Old Lesson 1');
});

test('structureCurriculum appends unassigned lessons container when some lessons have no topic', () => {
  const course = { id: 10, title: 'Mixed Course' };
  const modules = [
    {
      id: 1,
      title: 'Module 1',
      topics: [
        {
          id: 10,
          title: 'Topic 1',
          lessons: [{ id: 1, title: 'Assigned Lesson', topicId: 10 }],
        },
      ],
    },
  ];
  const unassignedLessons = [
    { id: 2, title: 'Unassigned Lesson', topicId: null },
  ];

  const structured = curriculumService.structureCurriculum(course, modules, unassignedLessons);
  assert.equal(structured.length, 2);
  assert.equal(structured[0].title, 'Module 1');
  assert.equal(structured[1].isVirtual, true);
  assert.equal(structured[1].title, 'Additional Content');
  assert.equal(structured[1].topics[0].lessons[0].title, 'Unassigned Lesson');
});

// --- 4. Derived Progress Calculation --------------------------------------------

test('getCurriculumProgress derives topic, module, and course progress without extra tables', async () => {
  const mockCurriculum = [
    {
      id: 1,
      title: 'Module 1',
      topics: [
        {
          id: 10,
          title: 'Topic 1',
          lessons: [
            { id: 101, title: 'L1', status: 'PUBLISHED' },
            { id: 102, title: 'L2', status: 'PUBLISHED' },
          ],
        },
      ],
    },
    {
      id: 2,
      title: 'Module 2',
      topics: [
        {
          id: 20,
          title: 'Topic 2',
          lessons: [
            { id: 201, title: 'L3', status: 'PUBLISHED' },
            { id: 202, title: 'L4', status: 'PUBLISHED' },
          ],
        },
      ],
    },
  ];

  const origFindMany = prisma.lessonProgress.findMany;

  // User completed L1 and L2 (Topic 1 completely finished; Topic 2 untouched)
  prisma.lessonProgress.findMany = async () => [
    { lessonId: 101, completed: true, watchedSeconds: 300, lastPositionSeconds: 300, durationSeconds: 300 },
    { lessonId: 102, completed: true, watchedSeconds: 400, lastPositionSeconds: 400, durationSeconds: 400 },
  ];

  try {
    const prog = await curriculumService.getCurriculumProgress(42, mockCurriculum);
    assert.equal(prog.courseProgress.total, 4);
    assert.equal(prog.courseProgress.completed, 2);

    // Module 1 is 100% complete
    const mod1 = prog.curriculum.find((m) => m.id === 1);
    assert.equal(mod1.completedLessons, 2);
    assert.equal(mod1.totalLessons, 2);
    assert.equal(mod1.completed, true);

    // Module 2 is 0% complete
    const mod2 = prog.curriculum.find((m) => m.id === 2);
    assert.equal(mod2.completedLessons, 0);
    assert.equal(mod2.totalLessons, 2);
    assert.equal(mod2.completed, false);
  } finally {
    prisma.lessonProgress.findMany = origFindMany;
  }
});

// --- 5. Course Resource Student Authorization & R2 Signing ----------------------

test('getSignedResourceDownloadUrl allows ADMIN without enrollment check', async () => {
  const origResourceFind = prisma.courseResource.findUnique;
  const origSignedGet = r2.signedGetUrl;
  const origGetR2Config = videoStorageSettingsService.getR2ConfigOrNull;

  prisma.courseResource.findUnique = async () => ({
    id: 1,
    courseId: 6,
    title: 'Dental Case History Forms',
    objectKey: 'courses/advanced-fmr-master-class/resources/dental-case-history-forms.pdf',
    contentType: 'application/pdf',
    isPublished: true,
  });

  videoStorageSettingsService.getR2ConfigOrNull = async () => ({
    bucket: 'test-bucket',
    accountId: 'test-acc',
  });

  r2.signedGetUrl = async (config, key, ttl, opts) => {
    assert.equal(key, 'courses/advanced-fmr-master-class/resources/dental-case-history-forms.pdf');
    assert.equal(opts.filename, 'Dental Case History Forms.pdf');
    return { url: 'https://signed-r2.url/dental-case-history-forms.pdf?expires=123', expiresInSeconds: ttl };
  };

  try {
    const result = await curriculumService.getSignedResourceDownloadUrl(1, 1, 'ADMIN');
    assert.equal(result.url, 'https://signed-r2.url/dental-case-history-forms.pdf?expires=123');
  } finally {
    prisma.courseResource.findUnique = origResourceFind;
    r2.signedGetUrl = origSignedGet;
    videoStorageSettingsService.getR2ConfigOrNull = origGetR2Config;
  }
});

test('getSignedResourceDownloadUrl allows enrolled STUDENT', async () => {
  const origResourceFind = prisma.courseResource.findUnique;
  const origEnrollmentFind = prisma.enrollment.findUnique;
  const origSignedGet = r2.signedGetUrl;
  const origGetR2Config = videoStorageSettingsService.getR2ConfigOrNull;

  prisma.courseResource.findUnique = async () => ({
    id: 1,
    courseId: 6,
    title: 'Dental Case History Forms',
    objectKey: 'courses/advanced-fmr-master-class/resources/dental-case-history-forms.pdf',
    contentType: 'application/pdf',
    isPublished: true,
  });

  prisma.enrollment.findUnique = async () => ({
    id: 1,
    status: 'ACTIVE',
  });

  videoStorageSettingsService.getR2ConfigOrNull = async () => ({
    bucket: 'test-bucket',
    accountId: 'test-acc',
  });

  r2.signedGetUrl = async (config, key, ttl) => ({
    url: 'https://signed-r2.url/ok',
    expiresInSeconds: ttl,
  });

  try {
    const result = await curriculumService.getSignedResourceDownloadUrl(42, 1, 'STUDENT');
    assert.equal(result.url, 'https://signed-r2.url/ok');
  } finally {
    prisma.courseResource.findUnique = origResourceFind;
    prisma.enrollment.findUnique = origEnrollmentFind;
    r2.signedGetUrl = origSignedGet;
    videoStorageSettingsService.getR2ConfigOrNull = origGetR2Config;
  }
});

test('getSignedResourceDownloadUrl rejects unenrolled STUDENT with 403', async () => {
  const origResourceFind = prisma.courseResource.findUnique;
  const origEnrollmentFind = prisma.enrollment.findUnique;

  prisma.courseResource.findUnique = async () => ({
    id: 1,
    courseId: 6,
    title: 'Dental Case History Forms',
    objectKey: 'courses/advanced-fmr-master-class/resources/dental-case-history-forms.pdf',
    isPublished: true,
  });

  // Not enrolled
  prisma.enrollment.findUnique = async () => null;

  try {
    await assert.rejects(
      async () => {
        await curriculumService.getSignedResourceDownloadUrl(99, 1, 'STUDENT');
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.ok(err.message.includes('not enrolled'));
        return true;
      }
    );
  } finally {
    prisma.courseResource.findUnique = origResourceFind;
    prisma.enrollment.findUnique = origEnrollmentFind;
  }
});

test('getSignedResourceDownloadUrl rejects anonymous user with 401', async () => {
  const origResourceFind = prisma.courseResource.findUnique;
  prisma.courseResource.findUnique = async () => ({
    id: 1,
    courseId: 6,
    title: 'Dental Case History Forms',
    objectKey: 'courses/advanced-fmr-master-class/resources/dental-case-history-forms.pdf',
    isPublished: true,
  });

  try {
    await assert.rejects(
      async () => {
        await curriculumService.getSignedResourceDownloadUrl(null, 1, null);
      },
      (err) => {
        assert.equal(err.statusCode, 401);
        return true;
      }
    );
  } finally {
    prisma.courseResource.findUnique = origResourceFind;
  }
});

// --- 6. R2 Resource Object Key Validation ---------------------------------------

test('r2.isOwnedObjectKey allows valid resource keys and rejects path traversal', () => {
  assert.equal(
    r2.isOwnedObjectKey('courses/advanced-fmr-master-class/resources/dental-case-history-forms.pdf'),
    true
  );
  assert.equal(
    r2.isOwnedObjectKey('courses/6/resources/case-doc.pdf'),
    true
  );
  assert.equal(
    r2.isOwnedObjectKey('courses/6/lessons/24/29b8e13b-d72b-4c38-88d1-5bd2aeef1d75.mp4'),
    true
  );

  // Path traversal & arbitrary keys rejected
  assert.equal(r2.isOwnedObjectKey('courses/../secret.txt'), false);
  assert.equal(r2.isOwnedObjectKey('system/passwords.txt'), false);
  assert.equal(r2.isOwnedObjectKey('courses/6/resources/../../etc/passwd'), false);
});
