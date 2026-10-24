const { prisma } = require('../config/db');
const { generateUniqueSlug } = require('../lib/slug');
const imageStorage = require('../lib/imageStorage');
const { parseFormBool } = require('../lib/formBool');

class InstructorError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'InstructorError';
    this.statusCode = statusCode;
  }
}

async function listInstructorsAdmin() {
  return prisma.instructor.findMany({
    include: { _count: { select: { courses: true } } },
    orderBy: { name: 'asc' },
  });
}

async function getInstructorByIdAdmin(id) {
  return prisma.instructor.findUnique({
    where: { id },
    include: {
      credentials: { orderBy: { sortOrder: 'asc' } },
      _count: { select: { courses: true } },
    },
  });
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
      designation: values.designation || values.title || null,
      organization: values.organization || null,
      experienceLabel: values.experienceLabel || null,
      shortBio: values.shortBio || null,
      bio: values.bio || values.fullBio || null,
      qualificationSummary: values.qualificationSummary || null,
      practiceName: values.practiceName || null,
      practiceLocation: values.practiceLocation || null,
      mentorQuote: values.mentorQuote || null,
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
      designation: values.designation || values.title || null,
      organization: values.organization || null,
      experienceLabel: values.experienceLabel || null,
      shortBio: values.shortBio || null,
      bio: values.bio || values.fullBio || null,
      qualificationSummary: values.qualificationSummary || null,
      practiceName: values.practiceName || null,
      practiceLocation: values.practiceLocation || null,
      mentorQuote: values.mentorQuote || null,
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
  imageStorage.deleteIfOwned(existing.photoUrl);
  return existing._count.courses;
}

// ---------------------------------------------------------------------------
// Instructor Credentials CRUD
// ---------------------------------------------------------------------------

async function addCredential(instructorId, { title, description, icon, sortOrder = 0, isPublished = true }) {
  if (!title || !String(title).trim()) throw new InstructorError('Credential title is required.');
  const count = await prisma.instructorCredential.count({ where: { instructorId } });
  return prisma.instructorCredential.create({
    data: {
      instructorId,
      title: String(title).trim().slice(0, 300),
      description: description ? String(description).trim() : null,
      icon: icon ? String(icon).trim().slice(0, 50) : null,
      sortOrder: Number(sortOrder) || count * 10 + 10,
      isPublished: parseFormBool(isPublished, true),
    },
  });
}

async function updateCredential(instructorId, credentialId, { title, description, icon, isPublished }) {
  const cred = await prisma.instructorCredential.findUnique({ where: { id: credentialId } });
  if (!cred) throw new InstructorError('Credential not found.', 404);
  if (cred.instructorId !== instructorId) throw new InstructorError('Credential does not belong to this instructor.', 403);
  return prisma.instructorCredential.update({
    where: { id: credentialId },
    data: {
      ...(title !== undefined ? { title: String(title).trim().slice(0, 300) } : {}),
      ...(description !== undefined ? { description: description ? String(description).trim() : null } : {}),
      ...(icon !== undefined ? { icon: icon ? String(icon).trim().slice(0, 50) : null } : {}),
      ...(isPublished !== undefined ? { isPublished: parseFormBool(isPublished) } : {}),
    },
  });
}

async function deleteCredential(instructorId, credentialId) {
  const cred = await prisma.instructorCredential.findUnique({ where: { id: credentialId } });
  if (!cred) throw new InstructorError('Credential not found.', 404);
  if (cred.instructorId !== instructorId) throw new InstructorError('Credential does not belong to this instructor.', 403);
  return prisma.instructorCredential.delete({ where: { id: credentialId } });
}

async function moveCredential(instructorId, credentialId, direction) {
  const items = await prisma.instructorCredential.findMany({
    where: { instructorId },
    orderBy: { sortOrder: 'asc' },
  });
  const currentIndex = items.findIndex((i) => i.id === credentialId);
  if (currentIndex === -1) throw new InstructorError('Credential not found.');
  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= items.length) return items;

  const currentItem = items[currentIndex];
  const targetItem = items[targetIndex];

  await prisma.instructorCredential.update({ where: { id: currentItem.id }, data: { sortOrder: targetItem.sortOrder } });
  await prisma.instructorCredential.update({ where: { id: targetItem.id }, data: { sortOrder: currentItem.sortOrder } });

  return prisma.instructorCredential.findMany({
    where: { instructorId },
    orderBy: { sortOrder: 'asc' },
  });
}

module.exports = {
  InstructorError,
  listInstructorsAdmin,
  getInstructorByIdAdmin,
  createInstructor,
  updateInstructor,
  setInstructorPhoto,
  deleteInstructor,
  addCredential,
  updateCredential,
  deleteCredential,
  moveCredential,
};
