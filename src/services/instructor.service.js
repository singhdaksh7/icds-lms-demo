const { prisma } = require('../config/db');
const { generateUniqueSlug } = require('../lib/slug');

class InstructorError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InstructorError';
  }
}

async function listInstructorsAdmin() {
  return prisma.instructor.findMany({
    include: { _count: { select: { courses: true } } },
    orderBy: { name: 'asc' },
  });
}

async function getInstructorByIdAdmin(id) {
  return prisma.instructor.findUnique({ where: { id } });
}

async function slugTaken(slug, excludeId) {
  const existing = await prisma.instructor.findUnique({ where: { slug } });
  return Boolean(existing && existing.id !== excludeId);
}

async function createInstructor(values) {
  const slug = values.slugInput
    ? (await slugTaken(values.slugInput, null))
      ? await generateUniqueSlug(values.slugInput, (s) => slugTaken(s, null))
      : values.slugInput
    : await generateUniqueSlug(values.name, (s) => slugTaken(s, null));

  return prisma.instructor.create({
    data: {
      name: values.name,
      slug,
      title: values.title || null,
      bio: values.bio || null,
      photoUrl: values.photoUrl || null,
      email: values.email || null,
      linkedinUrl: values.linkedinUrl || null,
      instagramUrl: values.instagramUrl || null,
      status: values.status,
    },
  });
}

async function updateInstructor(id, values) {
  const existing = await prisma.instructor.findUnique({ where: { id } });
  if (!existing) {
    throw new InstructorError('Instructor not found.');
  }

  let slug = existing.slug;
  if (values.slugInput && values.slugInput !== existing.slug) {
    slug = (await slugTaken(values.slugInput, id))
      ? await generateUniqueSlug(values.slugInput, (s) => slugTaken(s, id))
      : values.slugInput;
  }

  return prisma.instructor.update({
    where: { id },
    data: {
      name: values.name,
      slug,
      title: values.title || null,
      bio: values.bio || null,
      photoUrl: values.photoUrl || null,
      email: values.email || null,
      linkedinUrl: values.linkedinUrl || null,
      instagramUrl: values.instagramUrl || null,
      status: values.status,
    },
  });
}

async function setInstructorPhoto(id, photoUrl) {
  const existing = await prisma.instructor.findUnique({ where: { id } });
  if (!existing) {
    throw new InstructorError('Instructor not found.');
  }
  await prisma.instructor.update({ where: { id }, data: { photoUrl } });
  return existing.photoUrl;
}

// Courses reference instructors via onDelete: SetNull — deleting an
// instructor never deletes a course, only clears course.instructorId.
async function deleteInstructor(id) {
  const existing = await prisma.instructor.findUnique({
    where: { id },
    include: { _count: { select: { courses: true } } },
  });
  if (!existing) {
    throw new InstructorError('Instructor not found.');
  }

  await prisma.instructor.delete({ where: { id } });
  return existing._count.courses;
}

module.exports = {
  InstructorError,
  listInstructorsAdmin,
  getInstructorByIdAdmin,
  createInstructor,
  updateInstructor,
  setInstructorPhoto,
  deleteInstructor,
};
