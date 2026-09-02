const { prisma } = require('../config/db');
const { generateUniqueSlug } = require('../lib/slug');

class LessonError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LessonError';
  }
}

async function listLessonsForCourseAdmin(courseId) {
  return prisma.lesson.findMany({
    where: { courseId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
}

async function getLessonByIdAdmin(id) {
  return prisma.lesson.findUnique({ where: { id }, include: { course: true } });
}

async function slugTakenInCourse(courseId, slug, excludeId) {
  const existing = await prisma.lesson.findUnique({
    where: { courseId_slug: { courseId, slug } },
  });
  return Boolean(existing && existing.id !== excludeId);
}

async function createLesson(courseId, values) {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) {
    throw new LessonError('Course not found.');
  }

  const slug = values.slugInput
    ? (await slugTakenInCourse(courseId, values.slugInput, null))
      ? await generateUniqueSlug(values.slugInput, (s) => slugTakenInCourse(courseId, s, null))
      : values.slugInput
    : await generateUniqueSlug(values.title, (s) => slugTakenInCourse(courseId, s, null));

  return prisma.lesson.create({
    data: {
      courseId,
      title: values.title,
      slug,
      description: values.description || null,
      videoUrl: values.videoUrl || null,
      duration: values.duration || null,
      sortOrder: values.sortOrder,
      preview: values.preview,
      status: values.status,
    },
  });
}

async function updateLesson(id, values) {
  const existing = await prisma.lesson.findUnique({ where: { id } });
  if (!existing) {
    throw new LessonError('Lesson not found.');
  }

  let slug = existing.slug;
  if (values.slugInput && values.slugInput !== existing.slug) {
    slug = (await slugTakenInCourse(existing.courseId, values.slugInput, id))
      ? await generateUniqueSlug(values.slugInput, (s) =>
          slugTakenInCourse(existing.courseId, s, id)
        )
      : values.slugInput;
  }

  return prisma.lesson.update({
    where: { id },
    data: {
      title: values.title,
      slug,
      description: values.description || null,
      videoUrl: values.videoUrl || null,
      duration: values.duration || null,
      sortOrder: values.sortOrder,
      preview: values.preview,
      status: values.status,
    },
  });
}

// No financial record ever references a lesson directly, so unlike courses
// there's no "archive instead" requirement — deleting cascades only to that
// lesson's own LessonProgress rows (schema: onDelete: Cascade).
async function deleteLesson(id) {
  const existing = await prisma.lesson.findUnique({ where: { id } });
  if (!existing) {
    throw new LessonError('Lesson not found.');
  }
  await prisma.lesson.delete({ where: { id } });
  return existing.courseId;
}

module.exports = {
  LessonError,
  listLessonsForCourseAdmin,
  getLessonByIdAdmin,
  createLesson,
  updateLesson,
  deleteLesson,
};
