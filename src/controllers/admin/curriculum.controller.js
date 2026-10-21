const { prisma } = require('../../config/db');
const curriculumService = require('../../services/curriculum.service');
const videoStorageSettingsService = require('../../services/videoStorageSettings.service');
const r2 = require('../../lib/r2');

function sendResponse(req, res, { redirectUrl, successMessage, errorMessage, statusCode = 200, data = {} }) {
  const isJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
  if (errorMessage) {
    if (isJson) {
      return res.status(statusCode >= 400 ? statusCode : 400).json({ success: false, error: errorMessage });
    }
    req.flash('error', errorMessage);
    return res.redirect(redirectUrl || req.get('Referrer') || '/admin/courses');
  }

  if (isJson) {
    return res.status(statusCode).json({ success: true, message: successMessage, ...data });
  }
  if (successMessage) req.flash('success', successMessage);
  return res.redirect(redirectUrl || req.get('Referrer') || '/admin/courses');
}

// GET /admin/courses/:courseId/curriculum
async function getCurriculumBuilder(req, res, next) {
  try {
    const courseId = Number(req.params.courseId);
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: { category: true },
    });
    if (!course) {
      return res.status(404).render('public/404', { pageTitle: 'Course Not Found' });
    }

    const curriculum = await curriculumService.getCourseCurriculum(courseId, { publishedOnly: false });
    const resources = await curriculumService.listResourcesForCourse(courseId, { publishedOnly: false });
    const stats = await curriculumService.getPublicCourseStats(courseId);

    // List all topics for easy dropdown selection
    const allTopics = [];
    for (const mod of curriculum) {
      if (!mod.isVirtual) {
        for (const topic of mod.topics || []) {
          if (!topic.isVirtual) {
            allTopics.push({
              id: topic.id,
              title: `${mod.title} → ${topic.title}`,
              moduleId: mod.id,
            });
          }
        }
      }
    }

    return res.render('admin/curriculum/builder', {
      pageTitle: `Curriculum Builder — ${course.title}`,
      course,
      curriculum,
      resources,
      allTopics,
      stats,
    });
  } catch (err) {
    return next(err);
  }
}

// POST /admin/courses/:courseId/curriculum/modules
async function createModule(req, res) {
  const courseId = Number(req.params.courseId);
  try {
    const { title, description, sortOrder, isPublished } = req.body;
    await curriculumService.createModule(courseId, {
      title,
      description,
      sortOrder,
      isPublished: isPublished === undefined ? true : (isPublished === 'true' || isPublished === '1' || isPublished === 'on'),
    });
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      successMessage: 'Module created successfully.',
    });
  } catch (err) {
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      errorMessage: err.message,
      statusCode: err.statusCode || 400,
    });
  }
}

// POST /admin/courses/:courseId/curriculum/modules/:moduleId/edit
async function updateModule(req, res) {
  const courseId = Number(req.params.courseId);
  const moduleId = Number(req.params.moduleId);
  try {
    const { title, description, sortOrder, isPublished } = req.body;
    await curriculumService.updateModule(moduleId, {
      title,
      description,
      sortOrder,
      isPublished: isPublished !== undefined ? (isPublished === 'true' || isPublished === '1' || isPublished === 'on') : undefined,
    });
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      successMessage: 'Module updated successfully.',
    });
  } catch (err) {
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      errorMessage: err.message,
      statusCode: err.statusCode || 400,
    });
  }
}

// POST /admin/courses/:courseId/curriculum/modules/:moduleId/delete
async function deleteModule(req, res) {
  const courseId = Number(req.params.courseId);
  const moduleId = Number(req.params.moduleId);
  try {
    await curriculumService.deleteModule(moduleId);
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      successMessage: 'Module deleted safely. All lessons remain preserved.',
    });
  } catch (err) {
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      errorMessage: err.message,
      statusCode: err.statusCode || 400,
    });
  }
}

// POST /admin/courses/:courseId/curriculum/modules/reorder
async function reorderModules(req, res) {
  const courseId = Number(req.params.courseId);
  try {
    const moduleIds = Array.isArray(req.body.moduleIds)
      ? req.body.moduleIds
      : (typeof req.body.moduleIds === 'string' ? req.body.moduleIds.split(',') : []);
    await curriculumService.reorderModules(courseId, moduleIds);
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      successMessage: 'Modules reordered successfully.',
    });
  } catch (err) {
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      errorMessage: err.message,
      statusCode: err.statusCode || 400,
    });
  }
}

// POST /admin/courses/:courseId/curriculum/topics
async function createTopic(req, res) {
  const courseId = Number(req.params.courseId);
  try {
    const { moduleId, title, description, sortOrder, isPublished } = req.body;
    await curriculumService.createTopic(moduleId, {
      title,
      description,
      sortOrder,
      isPublished: isPublished === undefined ? true : (isPublished === 'true' || isPublished === '1' || isPublished === 'on'),
    });
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      successMessage: 'Topic created successfully.',
    });
  } catch (err) {
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      errorMessage: err.message,
      statusCode: err.statusCode || 400,
    });
  }
}

// POST /admin/courses/:courseId/curriculum/topics/:topicId/edit
async function updateTopic(req, res) {
  const courseId = Number(req.params.courseId);
  const topicId = Number(req.params.topicId);
  try {
    const { title, description, sortOrder, isPublished } = req.body;
    await curriculumService.updateTopic(topicId, {
      title,
      description,
      sortOrder,
      isPublished: isPublished !== undefined ? (isPublished === 'true' || isPublished === '1' || isPublished === 'on') : undefined,
    });
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      successMessage: 'Topic updated successfully.',
    });
  } catch (err) {
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      errorMessage: err.message,
      statusCode: err.statusCode || 400,
    });
  }
}

// POST /admin/courses/:courseId/curriculum/topics/:topicId/delete
async function deleteTopic(req, res) {
  const courseId = Number(req.params.courseId);
  const topicId = Number(req.params.topicId);
  try {
    await curriculumService.deleteTopic(topicId);
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      successMessage: 'Topic deleted safely. Lessons are now unassigned.',
    });
  } catch (err) {
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      errorMessage: err.message,
      statusCode: err.statusCode || 400,
    });
  }
}

// POST /admin/courses/:courseId/curriculum/topics/:topicId/move
async function moveTopic(req, res) {
  const courseId = Number(req.params.courseId);
  const topicId = Number(req.params.topicId);
  try {
    const { targetModuleId, sortOrder } = req.body;
    await curriculumService.moveTopic(topicId, targetModuleId, sortOrder);
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      successMessage: 'Topic moved successfully.',
    });
  } catch (err) {
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      errorMessage: err.message,
      statusCode: err.statusCode || 400,
    });
  }
}

// POST /admin/courses/:courseId/curriculum/topics/reorder
async function reorderTopics(req, res) {
  const courseId = Number(req.params.courseId);
  try {
    const { moduleId, topicIds } = req.body;
    const ids = Array.isArray(topicIds) ? topicIds : (typeof topicIds === 'string' ? topicIds.split(',') : []);
    await curriculumService.reorderTopics(moduleId, ids);
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      successMessage: 'Topics reordered successfully.',
    });
  } catch (err) {
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      errorMessage: err.message,
      statusCode: err.statusCode || 400,
    });
  }
}

// POST /admin/courses/:courseId/curriculum/lessons/move
async function moveLesson(req, res) {
  const courseId = Number(req.params.courseId);
  try {
    const { lessonId, targetTopicId, sortOrder } = req.body;
    await curriculumService.moveLessonToTopic(lessonId, targetTopicId, sortOrder);
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      successMessage: 'Lesson topic assignment updated.',
    });
  } catch (err) {
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      errorMessage: err.message,
      statusCode: err.statusCode || 400,
    });
  }
}

// POST /admin/courses/:courseId/curriculum/lessons/reorder
async function reorderLessons(req, res) {
  const courseId = Number(req.params.courseId);
  try {
    const { topicId, lessonIds } = req.body;
    const ids = Array.isArray(lessonIds) ? lessonIds : (typeof lessonIds === 'string' ? lessonIds.split(',') : []);
    await curriculumService.reorderLessons(courseId, topicId, ids);
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      successMessage: 'Lessons reordered successfully.',
    });
  } catch (err) {
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      errorMessage: err.message,
      statusCode: err.statusCode || 400,
    });
  }
}

// POST /admin/courses/:courseId/curriculum/resources
async function createResource(req, res) {
  const courseId = Number(req.params.courseId);
  try {
    const { title, objectKey, topicId, contentType, sizeBytes, sortOrder, isPublished } = req.body;
    await curriculumService.createResource(courseId, {
      title,
      objectKey,
      topicId: topicId || null,
      contentType: contentType || 'application/pdf',
      sizeBytes: sizeBytes || null,
      sortOrder: Number(sortOrder) || 0,
      isPublished: isPublished === undefined ? true : (isPublished === 'true' || isPublished === '1' || isPublished === 'on'),
    });
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      successMessage: 'Course resource attached successfully.',
    });
  } catch (err) {
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      errorMessage: err.message,
      statusCode: err.statusCode || 400,
    });
  }
}

// POST /admin/courses/:courseId/curriculum/resources/:resourceId/edit
async function updateResource(req, res) {
  const courseId = Number(req.params.courseId);
  const resourceId = Number(req.params.resourceId);
  try {
    const { title, objectKey, topicId, contentType, sizeBytes, sortOrder, isPublished } = req.body;
    await curriculumService.updateResource(resourceId, {
      title,
      objectKey,
      topicId: topicId || null,
      contentType,
      sizeBytes,
      sortOrder,
      isPublished: isPublished !== undefined ? (isPublished === 'true' || isPublished === '1' || isPublished === 'on') : undefined,
    });
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      successMessage: 'Course resource updated.',
    });
  } catch (err) {
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      errorMessage: err.message,
      statusCode: err.statusCode || 400,
    });
  }
}

// POST /admin/courses/:courseId/curriculum/resources/:resourceId/delete
async function deleteResource(req, res) {
  const courseId = Number(req.params.courseId);
  const resourceId = Number(req.params.resourceId);
  try {
    await curriculumService.deleteResource(resourceId);
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      successMessage: 'Course resource removed.',
    });
  } catch (err) {
    return sendResponse(req, res, {
      redirectUrl: `/admin/courses/${courseId}/curriculum`,
      errorMessage: err.message,
      statusCode: err.statusCode || 400,
    });
  }
}

// GET /admin/courses/:courseId/curriculum/resources/:resourceId/download
async function adminDownloadResource(req, res, next) {
  const resourceId = Number(req.params.resourceId);
  try {
    const signed = await curriculumService.getSignedResourceDownloadUrl(req.session.userId, resourceId, 'ADMIN');
    return res.redirect(signed.url);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getCurriculumBuilder,
  createModule,
  updateModule,
  deleteModule,
  reorderModules,
  createTopic,
  updateTopic,
  deleteTopic,
  moveTopic,
  reorderTopics,
  moveLesson,
  reorderLessons,
  createResource,
  updateResource,
  deleteResource,
  adminDownloadResource,
};
