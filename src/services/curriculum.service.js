const { prisma } = require('../config/db');
const { isUserEnrolled } = require('./enrollment.service');
const videoStorageSettingsService = require('./videoStorageSettings.service');
const r2 = require('../lib/r2');

class CurriculumError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'CurriculumError';
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// Helpers: Duration & Progress Formatting
// ---------------------------------------------------------------------------

function parseDurationStringToSeconds(str) {
  if (!str || typeof str !== 'string') return 0;
  const colonParts = str.trim().split(':').map(Number);
  if (colonParts.length === 2 && colonParts.every((n) => Number.isFinite(n))) {
    return colonParts[0] * 60 + colonParts[1];
  }
  if (colonParts.length === 3 && colonParts.every((n) => Number.isFinite(n))) {
    return colonParts[0] * 3600 + colonParts[1] * 60 + colonParts[2];
  }
  const minMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:min|minute)/i);
  if (minMatch) return Math.round(parseFloat(minMatch[1]) * 60);
  const hrMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:hr|hour)/i);
  if (hrMatch) return Math.round(parseFloat(hrMatch[1]) * 3600);
  return 0;
}

function formatSecondsToHuman(seconds, fallback = null) {
  if (!seconds || seconds <= 0) return fallback || 'Self-paced';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours} hr ${minutes} min`;
  if (hours > 0) return `${hours} hr`;
  if (minutes > 0) return `${minutes} min`;
  return `${seconds} sec`;
}

function lessonPercent(row) {
  if (!row) return 0;
  if (row.completed) return 100;
  if (row.durationSeconds > 0 && row.watchedSeconds > 0) {
    return Math.min(99, Math.round((row.watchedSeconds / row.durationSeconds) * 100));
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Phase 2: Cross-Course Binding Validation
// ---------------------------------------------------------------------------

async function validateTopicCourseBinding(courseId, topicId) {
  if (topicId === null || topicId === undefined || topicId === '') {
    return null;
  }
  const numericTopicId = Number(topicId);
  if (!Number.isInteger(numericTopicId) || numericTopicId < 1) {
    throw new CurriculumError('Invalid topic ID.', 400);
  }
  const topic = await prisma.courseTopic.findUnique({
    where: { id: numericTopicId },
    include: { module: true },
  });
  if (!topic) {
    throw new CurriculumError('Topic not found.', 404);
  }
  if (!topic.module || topic.module.courseId !== Number(courseId)) {
    throw new CurriculumError(
      `Cross-course topic assignment rejected: topic ${numericTopicId} belongs to course ${topic.module?.courseId}, not course ${courseId}.`,
      400
    );
  }
  return topic;
}

async function validateResourceCourseBinding(courseId, topicId) {
  return validateTopicCourseBinding(courseId, topicId);
}

// ---------------------------------------------------------------------------
// Phase 4 & 5: Curriculum Query & Legacy Fallback
// ---------------------------------------------------------------------------

function structureCurriculum(course, modules, flatLessons = [], flatResources = []) {
  if (!modules || modules.length === 0) {
    // Phase 4 virtual fallback for courses without modules
    const virtualTopic = {
      id: 'legacy-topic',
      moduleId: 'legacy-module',
      title: 'All Lessons',
      description: null,
      sortOrder: 0,
      isPublished: true,
      isVirtual: true,
      lessons: flatLessons,
      resources: flatResources,
    };
    const virtualModule = {
      id: 'legacy-module',
      courseId: course.id,
      title: 'Course Curriculum',
      description: null,
      sortOrder: 0,
      isPublished: true,
      isVirtual: true,
      topics: [virtualTopic],
    };
    return [virtualModule];
  }

  // Course has modules. If there are any unassigned lessons or resources, append them safely
  const result = [...modules];
  if (flatLessons.length > 0 || flatResources.length > 0) {
    result.push({
      id: 'unassigned-module',
      courseId: course.id,
      title: 'Additional Content',
      description: null,
      sortOrder: 999999,
      isPublished: true,
      isVirtual: true,
      topics: [
        {
          id: 'unassigned-topic',
          moduleId: 'unassigned-module',
          title: 'Unassigned Content',
          description: null,
          sortOrder: 0,
          isPublished: true,
          isVirtual: true,
          lessons: flatLessons,
          resources: flatResources,
        },
      ],
    });
  }
  return result;
}

async function getCourseCurriculum(courseId, { publishedOnly = false } = {}) {
  const numericCourseId = Number(courseId);
  const course = await prisma.course.findUnique({
    where: { id: numericCourseId },
    select: { id: true, title: true, slug: true, status: true, duration: true },
  });
  if (!course) {
    throw new CurriculumError('Course not found.', 404);
  }

  const moduleWhere = { courseId: numericCourseId };
  const topicWhere = {};
  const lessonWhere = { courseId: numericCourseId };
  const resourceWhere = { courseId: numericCourseId };

  if (publishedOnly) {
    moduleWhere.isPublished = true;
    topicWhere.isPublished = true;
    lessonWhere.status = 'PUBLISHED';
    resourceWhere.isPublished = true;
  }

  const [modules, unassignedLessons, unassignedResources] = await Promise.all([
    prisma.courseModule.findMany({
      where: moduleWhere,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        topics: {
          where: topicWhere,
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: {
            lessons: {
              where: lessonWhere,
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            },
            resources: {
              where: resourceWhere,
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
    }),
    prisma.lesson.findMany({
      where: { ...lessonWhere, topicId: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    }),
    prisma.courseResource.findMany({
      where: { ...resourceWhere, topicId: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    }),
  ]);

  return structureCurriculum(course, modules, unassignedLessons, unassignedResources);
}

async function getPublishedCurriculum(courseId) {
  return getCourseCurriculum(courseId, { publishedOnly: true });
}

// ---------------------------------------------------------------------------
// Phase 6: Derived Progress Calculation (Pure from LessonProgress)
// ---------------------------------------------------------------------------

async function getCurriculumProgress(userId, structuredCurriculum) {
  const allLessons = [];
  for (const mod of structuredCurriculum) {
    for (const topic of mod.topics || []) {
      for (const lesson of topic.lessons || []) {
        allLessons.push(lesson);
      }
    }
  }

  const lessonIds = allLessons.map((l) => l.id);
  const rows = lessonIds.length > 0 && userId
    ? await prisma.lessonProgress.findMany({
        where: { userId: Number(userId), lessonId: { in: lessonIds } },
      })
    : [];

  const progressMap = {};
  for (const row of rows) {
    progressMap[row.lessonId] = row;
  }

  for (const mod of structuredCurriculum) {
    let modLessonCount = 0;
    let modCompletedCount = 0;
    let modPercentSum = 0;

    for (const topic of mod.topics || []) {
      const topicLessons = topic.lessons || [];
      let topicCompletedCount = 0;
      let topicPercentSum = 0;

      for (const lesson of topicLessons) {
        const row = progressMap[lesson.id] || null;
        lesson.completed = Boolean(row?.completed);
        lesson.watchedSeconds = row?.watchedSeconds || 0;
        lesson.lastPositionSeconds = row?.lastPositionSeconds || 0;
        lesson.percent = lessonPercent(row);

        if (lesson.completed) topicCompletedCount += 1;
        topicPercentSum += lesson.percent;
      }

      topic.totalLessons = topicLessons.length;
      topic.completedLessons = topicCompletedCount;
      topic.progressPercent = topicLessons.length > 0 ? Math.round(topicPercentSum / topicLessons.length) : 0;
      topic.completed = topicLessons.length > 0 && topicCompletedCount === topicLessons.length;

      modLessonCount += topicLessons.length;
      modCompletedCount += topicCompletedCount;
      modPercentSum += topicPercentSum;
    }

    mod.totalLessons = modLessonCount;
    mod.completedLessons = modCompletedCount;
    mod.progressPercent = modLessonCount > 0 ? Math.round(modPercentSum / modLessonCount) : 0;
    mod.completed = modLessonCount > 0 && modCompletedCount === modLessonCount;
  }

  const courseTotal = allLessons.length;
  const courseCompleted = allLessons.filter((l) => l.completed).length;
  const coursePercentSum = allLessons.reduce((acc, l) => acc + (l.percent || 0), 0);
  const courseProgress = {
    total: courseTotal,
    completed: courseCompleted,
    percent: courseTotal > 0 ? Math.round(coursePercentSum / courseTotal) : 0,
  };

  return { curriculum: structuredCurriculum, progressMap, courseProgress };
}

// ---------------------------------------------------------------------------
// Phase 9: Public Course Honest Statistics
// ---------------------------------------------------------------------------

async function getPublicCourseStats(courseId) {
  const numericCourseId = Number(courseId);
  const [course, modules, topics, lessons, resources] = await Promise.all([
    prisma.course.findUnique({
      where: { id: numericCourseId },
      select: { id: true, duration: true },
    }),
    prisma.courseModule.findMany({
      where: { courseId: numericCourseId, isPublished: true },
      select: { id: true },
    }),
    prisma.courseTopic.findMany({
      where: { module: { courseId: numericCourseId, isPublished: true }, isPublished: true },
      select: { id: true },
    }),
    prisma.lesson.findMany({
      where: { courseId: numericCourseId, status: 'PUBLISHED' },
      select: {
        id: true,
        duration: true,
        videoType: true,
        videoObjectKey: true,
        videoPath: true,
        videoUrl: true,
        videoDurationSeconds: true,
      },
    }),
    prisma.courseResource.findMany({
      where: { courseId: numericCourseId, isPublished: true },
      select: { id: true },
    }),
  ]);

  const availableVideoLessons = lessons.filter(
    (l) => Boolean(l.videoObjectKey) || Boolean(l.videoPath) || Boolean(l.videoUrl)
  );

  let totalSeconds = 0;
  for (const l of lessons) {
    if (l.videoDurationSeconds && l.videoDurationSeconds > 0) {
      totalSeconds += l.videoDurationSeconds;
    } else if (l.duration) {
      const parsed = parseDurationStringToSeconds(l.duration);
      if (parsed > 0) totalSeconds += parsed;
    }
  }

  return {
    moduleCount: modules.length,
    topicCount: topics.length,
    lessonCount: lessons.length,
    videoCount: availableVideoLessons.length,
    totalSeconds,
    formattedDuration: formatSecondsToHuman(totalSeconds, course?.duration),
    resourceCount: resources.length,
  };
}

// ---------------------------------------------------------------------------
// Phase 7 & 8: Module CRUD & Reorder
// ---------------------------------------------------------------------------

async function createModule(courseId, { title, description = null, sortOrder = 0, isPublished = true }) {
  if (!title || !title.trim()) throw new CurriculumError('Module title is required.');
  const numericCourseId = Number(courseId);
  return prisma.courseModule.create({
    data: {
      courseId: numericCourseId,
      title: title.trim(),
      description: description ? description.trim() : null,
      sortOrder: Number(sortOrder) || 0,
      isPublished: Boolean(isPublished),
    },
  });
}

async function updateModule(moduleId, { title, description, sortOrder, isPublished }) {
  const numericId = Number(moduleId);
  const data = {};
  if (title !== undefined) {
    if (!title || !title.trim()) throw new CurriculumError('Module title cannot be empty.');
    data.title = title.trim();
  }
  if (description !== undefined) data.description = description ? description.trim() : null;
  if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0;
  if (isPublished !== undefined) data.isPublished = Boolean(isPublished);

  return prisma.courseModule.update({
    where: { id: numericId },
    data,
  });
}

// Phase 3: Safe Module Delete — topics cascade-delete, their lessons/resources become topicId: null
async function deleteModule(moduleId) {
  const numericId = Number(moduleId);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.courseModule.findUnique({
      where: { id: numericId },
      include: { topics: { select: { id: true } } },
    });
    if (!existing) throw new CurriculumError('Module not found.', 404);

    const topicIds = existing.topics.map((t) => t.id);
    if (topicIds.length > 0) {
      // Explicit safety update before deleting module
      await tx.lesson.updateMany({
        where: { topicId: { in: topicIds } },
        data: { topicId: null },
      });
      await tx.courseResource.updateMany({
        where: { topicId: { in: topicIds } },
        data: { topicId: null },
      });
    }

    await tx.courseModule.delete({ where: { id: numericId } });
    return { success: true, courseId: existing.courseId };
  });
}

async function reorderModules(courseId, moduleIdsInOrder) {
  const numericCourseId = Number(courseId);
  if (!Array.isArray(moduleIdsInOrder)) throw new CurriculumError('Invalid module IDs order.');

  return prisma.$transaction(async (tx) => {
    const modules = await tx.courseModule.findMany({
      where: { courseId: numericCourseId, id: { in: moduleIdsInOrder.map(Number) } },
      select: { id: true },
    });
    if (modules.length !== moduleIdsInOrder.length) {
      throw new CurriculumError('Some modules do not belong to this course.');
    }

    for (let index = 0; index < moduleIdsInOrder.length; index += 1) {
      await tx.courseModule.update({
        where: { id: Number(moduleIdsInOrder[index]) },
        data: { sortOrder: (index + 1) * 10 },
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Phase 7 & 8: Topic CRUD & Reorder
// ---------------------------------------------------------------------------

async function createTopic(moduleId, { title, description = null, sortOrder = 0, isPublished = true }) {
  if (!title || !title.trim()) throw new CurriculumError('Topic title is required.');
  const numericModuleId = Number(moduleId);
  const mod = await prisma.courseModule.findUnique({ where: { id: numericModuleId } });
  if (!mod) throw new CurriculumError('Module not found.', 404);

  return prisma.courseTopic.create({
    data: {
      moduleId: numericModuleId,
      title: title.trim(),
      description: description ? description.trim() : null,
      sortOrder: Number(sortOrder) || 0,
      isPublished: Boolean(isPublished),
    },
  });
}

async function updateTopic(topicId, { title, description, sortOrder, isPublished }) {
  const numericId = Number(topicId);
  const data = {};
  if (title !== undefined) {
    if (!title || !title.trim()) throw new CurriculumError('Topic title cannot be empty.');
    data.title = title.trim();
  }
  if (description !== undefined) data.description = description ? description.trim() : null;
  if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0;
  if (isPublished !== undefined) data.isPublished = Boolean(isPublished);

  return prisma.courseTopic.update({
    where: { id: numericId },
    data,
  });
}

// Phase 3: Safe Topic Delete — lessons and resources become topicId: null
async function deleteTopic(topicId) {
  const numericId = Number(topicId);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.courseTopic.findUnique({
      where: { id: numericId },
      include: { module: true },
    });
    if (!existing) throw new CurriculumError('Topic not found.', 404);

    // Unassign child lessons and resources safely
    await tx.lesson.updateMany({
      where: { topicId: numericId },
      data: { topicId: null },
    });
    await tx.courseResource.updateMany({
      where: { topicId: numericId },
      data: { topicId: null },
    });

    await tx.courseTopic.delete({ where: { id: numericId } });
    return { success: true, moduleId: existing.moduleId, courseId: existing.module?.courseId };
  });
}

async function moveTopic(topicId, targetModuleId, sortOrder = 0) {
  const numericTopicId = Number(topicId);
  const numericTargetModuleId = Number(targetModuleId);

  const [topic, targetModule] = await Promise.all([
    prisma.courseTopic.findUnique({ where: { id: numericTopicId }, include: { module: true } }),
    prisma.courseModule.findUnique({ where: { id: numericTargetModuleId } }),
  ]);
  if (!topic) throw new CurriculumError('Topic not found.', 404);
  if (!targetModule) throw new CurriculumError('Target module not found.', 404);
  if (topic.module?.courseId !== targetModule.courseId) {
    throw new CurriculumError('Cannot move topic to a module belonging to a different course.');
  }

  return prisma.courseTopic.update({
    where: { id: numericTopicId },
    data: { moduleId: numericTargetModuleId, sortOrder: Number(sortOrder) || 0 },
  });
}

async function reorderTopics(moduleId, topicIdsInOrder) {
  const numericModuleId = Number(moduleId);
  if (!Array.isArray(topicIdsInOrder)) throw new CurriculumError('Invalid topic IDs order.');

  return prisma.$transaction(async (tx) => {
    const topics = await tx.courseTopic.findMany({
      where: { moduleId: numericModuleId, id: { in: topicIdsInOrder.map(Number) } },
      select: { id: true },
    });
    if (topics.length !== topicIdsInOrder.length) {
      throw new CurriculumError('Some topics do not belong to this module.');
    }

    for (let index = 0; index < topicIdsInOrder.length; index += 1) {
      await tx.courseTopic.update({
        where: { id: Number(topicIdsInOrder[index]) },
        data: { sortOrder: (index + 1) * 10 },
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Phase 7 & 8: Lesson Move & Reorder
// ---------------------------------------------------------------------------

async function moveLessonToTopic(lessonId, targetTopicId, sortOrder = null) {
  const numericLessonId = Number(lessonId);
  const lesson = await prisma.lesson.findUnique({ where: { id: numericLessonId } });
  if (!lesson) throw new CurriculumError('Lesson not found.', 404);

  if (targetTopicId !== null && targetTopicId !== undefined && targetTopicId !== '') {
    await validateTopicCourseBinding(lesson.courseId, targetTopicId);
  }

  const data = {
    topicId: targetTopicId ? Number(targetTopicId) : null,
  };
  if (sortOrder !== null && sortOrder !== undefined) {
    data.sortOrder = Number(sortOrder);
  }

  return prisma.lesson.update({
    where: { id: numericLessonId },
    data,
  });
}

async function reorderLessons(courseId, topicId, lessonIdsInOrder) {
  const numericCourseId = Number(courseId);
  const numericTopicId = topicId ? Number(topicId) : null;
  if (!Array.isArray(lessonIdsInOrder)) throw new CurriculumError('Invalid lesson IDs order.');

  return prisma.$transaction(async (tx) => {
    for (let index = 0; index < lessonIdsInOrder.length; index += 1) {
      await tx.lesson.update({
        where: { id: Number(lessonIdsInOrder[index]) },
        data: {
          sortOrder: (index + 1) * 10,
          topicId: numericTopicId,
        },
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Phase 13 & 16: Course Resource System
// ---------------------------------------------------------------------------

async function listResourcesForCourse(courseId, { publishedOnly = false } = {}) {
  const where = { courseId: Number(courseId) };
  if (publishedOnly) where.isPublished = true;

  return prisma.courseResource.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: { topic: { select: { id: true, title: true } } },
  });
}

async function getResourceById(resourceId) {
  return prisma.courseResource.findUnique({
    where: { id: Number(resourceId) },
    include: { course: true, topic: true },
  });
}

async function createResource(courseId, { title, objectKey, topicId = null, contentType = 'application/pdf', sizeBytes = null, sortOrder = 0, isPublished = true }) {
  if (!title || !title.trim()) throw new CurriculumError('Resource title is required.');
  if (!objectKey || !objectKey.trim()) throw new CurriculumError('Resource object key is required.');

  const numericCourseId = Number(courseId);
  const cleanKey = objectKey.trim();

  // Validate object key safety
  if (!r2.isOwnedObjectKey(cleanKey)) {
    throw new CurriculumError('Invalid R2 object key format.', 400);
  }

  // Cross-course topic validation
  if (topicId) {
    await validateResourceCourseBinding(numericCourseId, topicId);
  }

  return prisma.courseResource.create({
    data: {
      courseId: numericCourseId,
      topicId: topicId ? Number(topicId) : null,
      title: title.trim(),
      objectKey: cleanKey,
      contentType: contentType || 'application/pdf',
      sizeBytes: sizeBytes ? BigInt(sizeBytes) : null,
      sortOrder: Number(sortOrder) || 0,
      isPublished: Boolean(isPublished),
    },
  });
}

async function updateResource(resourceId, { title, objectKey, topicId, contentType, sizeBytes, sortOrder, isPublished }) {
  const numericId = Number(resourceId);
  const existing = await prisma.courseResource.findUnique({ where: { id: numericId } });
  if (!existing) throw new CurriculumError('Resource not found.', 404);

  const data = {};
  if (title !== undefined) {
    if (!title || !title.trim()) throw new CurriculumError('Title cannot be empty.');
    data.title = title.trim();
  }
  if (objectKey !== undefined) {
    if (!r2.isOwnedObjectKey(objectKey)) throw new CurriculumError('Invalid R2 object key format.');
    data.objectKey = objectKey.trim();
  }
  if (topicId !== undefined) {
    if (topicId) {
      await validateResourceCourseBinding(existing.courseId, topicId);
      data.topicId = Number(topicId);
    } else {
      data.topicId = null;
    }
  }
  if (contentType !== undefined) data.contentType = contentType;
  if (sizeBytes !== undefined) data.sizeBytes = sizeBytes ? BigInt(sizeBytes) : null;
  if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0;
  if (isPublished !== undefined) data.isPublished = Boolean(isPublished);

  return prisma.courseResource.update({
    where: { id: numericId },
    data,
  });
}

async function deleteResource(resourceId) {
  const numericId = Number(resourceId);
  const existing = await prisma.courseResource.findUnique({ where: { id: numericId } });
  if (!existing) throw new CurriculumError('Resource not found.', 404);

  await prisma.courseResource.delete({ where: { id: numericId } });
  return { success: true, courseId: existing.courseId };
}

async function reorderResources(courseId, resourceIdsInOrder) {
  const numericCourseId = Number(courseId);
  if (!Array.isArray(resourceIdsInOrder)) throw new CurriculumError('Invalid resource IDs order.');

  return prisma.$transaction(async (tx) => {
    for (let index = 0; index < resourceIdsInOrder.length; index += 1) {
      await tx.courseResource.update({
        where: { id: Number(resourceIdsInOrder[index]) },
        data: { sortOrder: (index + 1) * 10 },
      });
    }
  });
}

// Student & Admin Signed Resource Download
async function getSignedResourceDownloadUrl(userId, resourceId, userRole) {
  const numericId = Number(resourceId);
  const resource = await prisma.courseResource.findUnique({
    where: { id: numericId },
    include: { course: true },
  });
  if (!resource) {
    throw new CurriculumError('Resource not found.', 404);
  }

  const isAdmin = userRole === 'ADMIN';
  if (!isAdmin) {
    if (!userId) {
      throw new CurriculumError('Authentication required.', 401);
    }
    const enrolled = await isUserEnrolled(userId, resource.courseId);
    if (!enrolled) {
      throw new CurriculumError('You are not enrolled in this course.', 403);
    }
    if (!resource.isPublished) {
      throw new CurriculumError('Resource not available.', 404);
    }
  }

  const r2Config = await videoStorageSettingsService.getR2ConfigOrNull();
  if (!r2Config) {
    throw new CurriculumError('Video and resource storage is not configured.', 503);
  }

  const filename = resource.title.endsWith('.pdf') ? resource.title : `${resource.title}.pdf`;
  const signed = await r2.signedGetUrl(r2Config, resource.objectKey, 300, { filename });
  return {
    url: signed.url,
    title: resource.title,
    contentType: resource.contentType,
    expiresInSeconds: signed.expiresInSeconds,
  };
}

module.exports = {
  CurriculumError,
  parseDurationStringToSeconds,
  formatSecondsToHuman,
  validateTopicCourseBinding,
  validateResourceCourseBinding,
  structureCurriculum,
  getCourseCurriculum,
  getPublishedCurriculum,
  getCurriculumProgress,
  getPublicCourseStats,
  createModule,
  updateModule,
  deleteModule,
  reorderModules,
  createTopic,
  updateTopic,
  deleteTopic,
  moveTopic,
  reorderTopics,
  moveLessonToTopic,
  reorderLessons,
  listResourcesForCourse,
  getResourceById,
  createResource,
  updateResource,
  deleteResource,
  reorderResources,
  getSignedResourceDownloadUrl,
};
