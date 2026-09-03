const { prisma } = require('../config/db');
const { generateUniqueSlug } = require('../lib/slug');
const { buildPagination } = require('../lib/pagination');

const LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];
const MAX_SEARCH_LENGTH = 100;
const PUBLIC_PAGE_SIZE = 12;

class CourseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CourseError';
  }
}

// ---------------------------------------------------------------------------
// Public catalog
// ---------------------------------------------------------------------------

async function listPublishedCourses({ q, categorySlug, level, page = 1 } = {}) {
  const where = { status: 'PUBLISHED' };

  const query = typeof q === 'string' ? q.trim().slice(0, MAX_SEARCH_LENGTH) : '';
  if (query) {
    where.OR = [
      { title: { contains: query } },
      { shortDescription: { contains: query } },
      { description: { contains: query } },
      { instructor: { name: { contains: query } } },
      { category: { name: { contains: query } } },
    ];
  }

  if (categorySlug) {
    where.category = { ...(where.category || {}), slug: categorySlug };
  }

  if (level && LEVELS.includes(level)) {
    where.level = level;
  }

  const total = await prisma.course.count({ where });
  const pagination = buildPagination(page, PUBLIC_PAGE_SIZE, total);

  const courses = await prisma.course.findMany({
    where,
    include: {
      category: true,
      instructor: true,
      _count: { select: { lessons: { where: { status: 'PUBLISHED' } } } },
      reviews: { where: { status: 'APPROVED' }, select: { rating: true } },
    },
    orderBy: [{ featured: 'desc' }, { publishedAt: 'desc' }],
    skip: pagination.skip,
    take: PUBLIC_PAGE_SIZE,
  });

  return { courses, pagination, query };
}

async function getPublishedCourseBySlug(slug) {
  return prisma.course.findFirst({
    where: { slug, status: 'PUBLISHED' },
    include: {
      category: true,
      instructor: true,
      lessons: {
        where: { status: 'PUBLISHED' },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          title: true,
          slug: true,
          duration: true,
          preview: true,
          sortOrder: true,
        },
      },
    },
  });
}

// A course visible to learners (published) OR to an admin doing QA. Used by
// the /learn routes, which need the full course but must still 404 an
// unpublished course for anyone who isn't an admin.
async function getCourseBySlugForViewer(slug, viewerIsAdmin) {
  const course = await prisma.course.findUnique({
    where: { slug },
    include: {
      category: true,
      instructor: true,
      lessons: {
        where: viewerIsAdmin ? {} : { status: 'PUBLISHED' },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      },
    },
  });

  if (!course) return null;
  if (course.status !== 'PUBLISHED' && !viewerIsAdmin) return null;

  return course;
}

// Lightweight, unpaginated list for sitemap generation — published courses
// only, just the fields a <url> entry needs.
async function listPublishedCourseSlugsForSitemap() {
  return prisma.course.findMany({
    where: { status: 'PUBLISHED' },
    select: { slug: true, updatedAt: true },
    orderBy: { publishedAt: 'desc' },
  });
}

// ---------------------------------------------------------------------------
// Admin catalog management
// ---------------------------------------------------------------------------

async function listCoursesAdmin({ page = 1, pageSize = 20 } = {}) {
  const total = await prisma.course.count();
  const pagination = buildPagination(page, pageSize, total);

  const courses = await prisma.course.findMany({
    include: {
      category: true,
      instructor: true,
      _count: { select: { lessons: true, enrollments: true } },
    },
    orderBy: { createdAt: 'desc' },
    skip: pagination.skip,
    take: pageSize,
  });

  return { courses, pagination };
}

async function getCourseByIdAdmin(id) {
  return prisma.course.findUnique({
    where: { id },
    include: {
      category: true,
      instructor: true,
      lessons: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      _count: { select: { enrollments: true, orderItems: true } },
    },
  });
}

async function slugTaken(slug, excludeId) {
  const existing = await prisma.course.findUnique({ where: { slug } });
  return Boolean(existing && existing.id !== excludeId);
}

async function createCourse(values) {
  const slug = values.slugInput
    ? (await slugTaken(values.slugInput, null))
      ? await generateUniqueSlug(values.slugInput, (s) => slugTaken(s, null))
      : values.slugInput
    : await generateUniqueSlug(values.title, (s) => slugTaken(s, null));

  return prisma.course.create({
    data: {
      title: values.title,
      slug,
      shortDescription: values.shortDescription || null,
      description: values.description || null,
      thumbnailUrl: values.thumbnailUrl || null,
      categoryId: values.categoryId || null,
      instructorId: values.instructorId || null,
      price: values.price,
      salePrice: values.salePrice,
      currency: values.currency,
      level: values.level,
      status: values.status,
      featured: values.featured,
      duration: values.duration || null,
      publishedAt: values.status === 'PUBLISHED' ? new Date() : null,
    },
  });
}

async function updateCourse(id, values) {
  const existing = await prisma.course.findUnique({ where: { id } });
  if (!existing) {
    throw new CourseError('Course not found.');
  }

  let slug = existing.slug;
  if (values.slugInput && values.slugInput !== existing.slug) {
    slug = (await slugTaken(values.slugInput, id))
      ? await generateUniqueSlug(values.slugInput, (s) => slugTaken(s, id))
      : values.slugInput;
  }

  const wasPublished = existing.status === 'PUBLISHED';
  const willBePublished = values.status === 'PUBLISHED';

  return prisma.course.update({
    where: { id },
    data: {
      title: values.title,
      slug,
      shortDescription: values.shortDescription || null,
      description: values.description || null,
      thumbnailUrl: values.thumbnailUrl || null,
      categoryId: values.categoryId || null,
      instructorId: values.instructorId || null,
      price: values.price,
      salePrice: values.salePrice,
      currency: values.currency,
      level: values.level,
      status: values.status,
      featured: values.featured,
      duration: values.duration || null,
      publishedAt: !wasPublished && willBePublished ? new Date() : existing.publishedAt,
    },
  });
}

async function setCourseThumbnail(id, thumbnailUrl) {
  const existing = await prisma.course.findUnique({ where: { id } });
  if (!existing) {
    throw new CourseError('Course not found.');
  }
  await prisma.course.update({ where: { id }, data: { thumbnailUrl } });
  return existing.thumbnailUrl;
}

async function setCourseStatus(id, status) {
  const existing = await prisma.course.findUnique({ where: { id } });
  if (!existing) {
    throw new CourseError('Course not found.');
  }

  return prisma.course.update({
    where: { id },
    data: {
      status,
      publishedAt: status === 'PUBLISHED' && !existing.publishedAt ? new Date() : existing.publishedAt,
    },
  });
}

// Deletion is blocked whenever a course carries financial/history records
// (enrollments or order items) — archiving is the safe alternative so we
// never cascade-delete that data.
async function deleteCourseIfSafe(id) {
  const [enrollmentCount, orderItemCount] = await Promise.all([
    prisma.enrollment.count({ where: { courseId: id } }),
    prisma.orderItem.count({ where: { courseId: id } }),
  ]);

  if (enrollmentCount > 0 || orderItemCount > 0) {
    throw new CourseError(
      'This course cannot be deleted because it has enrollment or order history. Archive it instead.'
    );
  }

  await prisma.course.delete({ where: { id } });
}

module.exports = {
  CourseError,
  listPublishedCourses,
  listPublishedCourseSlugsForSitemap,
  getPublishedCourseBySlug,
  getCourseBySlugForViewer,
  listCoursesAdmin,
  getCourseByIdAdmin,
  createCourse,
  updateCourse,
  setCourseThumbnail,
  setCourseStatus,
  deleteCourseIfSafe,
};
