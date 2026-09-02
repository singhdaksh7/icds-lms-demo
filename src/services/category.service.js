const { prisma } = require('../config/db');
const { generateUniqueSlug } = require('../lib/slug');

class CategoryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CategoryError';
  }
}

async function listCategoriesAdmin() {
  return prisma.category.findMany({
    include: { _count: { select: { courses: true } } },
    orderBy: { name: 'asc' },
  });
}

async function slugTaken(slug, excludeId) {
  const existing = await prisma.category.findUnique({ where: { slug } });
  return Boolean(existing && existing.id !== excludeId);
}

async function createCategory(values) {
  const slug = values.slugInput
    ? (await slugTaken(values.slugInput, null))
      ? await generateUniqueSlug(values.slugInput, (s) => slugTaken(s, null))
      : values.slugInput
    : await generateUniqueSlug(values.name, (s) => slugTaken(s, null));

  return prisma.category.create({
    data: {
      name: values.name,
      slug,
      description: values.description || null,
      status: values.status,
    },
  });
}

async function updateCategory(id, values) {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) {
    throw new CategoryError('Category not found.');
  }

  let slug = existing.slug;
  if (values.slugInput && values.slugInput !== existing.slug) {
    slug = (await slugTaken(values.slugInput, id))
      ? await generateUniqueSlug(values.slugInput, (s) => slugTaken(s, id))
      : values.slugInput;
  }

  return prisma.category.update({
    where: { id },
    data: {
      name: values.name,
      slug,
      description: values.description || null,
      status: values.status,
    },
  });
}

// Courses reference categories via onDelete: SetNull, so deleting a category
// never destroys a course — it just clears course.categoryId. The caller
// (controller) still asks for confirmation and reports the affected count.
async function deleteCategory(id) {
  const existing = await prisma.category.findUnique({
    where: { id },
    include: { _count: { select: { courses: true } } },
  });
  if (!existing) {
    throw new CategoryError('Category not found.');
  }

  await prisma.category.delete({ where: { id } });
  return existing._count.courses;
}

module.exports = { CategoryError, listCategoriesAdmin, createCategory, updateCategory, deleteCategory };
