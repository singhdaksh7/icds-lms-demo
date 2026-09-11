/*
 * One-time, idempotent provisioning script for the minimal course-access +
 * video-resume demo:
 *   - 2 published courses (Professional Cosmetology Foundations,
 *     Introduction to Aesthetic Practice), each with 1 published, protected
 *     video lesson
 *   - locally-stored, generated placeholder thumbnails for both courses
 *   - 1 demo student account (credentials read from the environment only —
 *     never hardcoded, never logged)
 *   - 1 ACTIVE enrollment: demo student -> Course 1 only. Course 2 stays
 *     unenrolled so it is visible in the catalog but locked for this
 *     student, exercising the existing server-side authorization checks in
 *     src/services/enrollment.service.js and src/controllers/media.controller.js.
 *
 * This does NOT create the actual lesson video files — those are large
 * binaries that must never be committed to git. It wires up the DB rows to
 * reference course-1-demo.mp4 / course-2-demo.mp4 (see VIDEO_STORAGE_ROOT)
 * and warns clearly if those files aren't present yet.
 *
 * Safe to re-run: every write is an upsert/lookup keyed on a unique field
 * (course slug, lesson (courseId, slug), student email, enrollment
 * (userId, courseId)) — running this twice never creates duplicates.
 *
 * Usage:
 *   STUDENT_EMAIL=student@icds-demo.local \
 *   STUDENT_PASSWORD='a-secure-random-12-plus-char-password' \
 *   STUDENT_NAME='Demo Student' \
 *   node scripts/setup-minimal-demo.js
 *
 * Not run automatically on app startup — invoke manually, once, whenever
 * the demo needs (re)provisioning.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../src/lib/password');
const imageStorage = require('../src/lib/imageStorage');
const videoStorage = require('../src/lib/videoStorage');

const prisma = new PrismaClient();

const MIN_PASSWORD_LENGTH = 12;
const PLACEHOLDER_PASSWORDS = new Set([
  'password',
  'student',
  'student123',
  'change-me',
  'changeme',
  '12345678',
]);

const COURSE_1_VIDEO_FILENAME = 'course-1-demo.mp4';
const COURSE_2_VIDEO_FILENAME = 'course-2-demo.mp4';
const COURSE_1_THUMB_FILENAME = 'course-1.svg';
const COURSE_2_THUMB_FILENAME = 'course-2.svg';

function fail(message) {
  console.error(`\nsetup-minimal-demo: ${message}\n`);
  process.exit(1);
}

// A clean, generated (not photographic) placeholder thumbnail — no stock
// photography, no fabricated instructor identity, no third-party branding.
// SVG renders fine via a plain <img src>, needs no image library, and is
// trivially reasoned about (no binary asset to vet).
function placeholderThumbnailSvg({ titleLines, category, accent }) {
  const textLines = titleLines
    .map((line, i) => `<tspan x="80" dy="${i === 0 ? 0 : 62}">${line}</tspan>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${accent[0]}"/>
      <stop offset="100%" stop-color="${accent[1]}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="675" fill="url(#g)"/>
  <circle cx="1040" cy="120" r="140" fill="rgba(255,255,255,0.08)"/>
  <circle cx="140" cy="580" r="180" fill="rgba(255,255,255,0.06)"/>
  <text x="80" y="90" font-family="Arial, sans-serif" font-size="26" fill="rgba(255,255,255,0.85)" letter-spacing="2">${category.toUpperCase()}</text>
  <text x="80" y="420" font-family="Arial, sans-serif" font-size="54" font-weight="700" fill="#ffffff">${textLines}</text>
</svg>`;
}

function ensureThumbnail(filename, options) {
  const dir = imageStorage.STORAGE_ROOT;
  fs.mkdirSync(dir, { recursive: true });
  const fullPath = path.join(dir, filename);
  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, placeholderThumbnailSvg(options), 'utf8');
    console.log(`  Created placeholder thumbnail: ${fullPath}`);
  }
  return imageStorage.publicUrlFor(filename);
}

function checkVideoPresence(filename) {
  const absolute = videoStorage.resolveVideoPath(filename);
  return { absolute, exists: Boolean(absolute && fs.existsSync(absolute)) };
}

async function upsertEnrollment(userId, courseId, status) {
  const existing = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } },
  });
  if (existing) {
    if (existing.status !== status) {
      await prisma.enrollment.update({ where: { id: existing.id }, data: { status, accessExpiresAt: null } });
    }
    return;
  }
  if (status === 'ACTIVE') {
    await prisma.enrollment.create({ data: { userId, courseId, status: 'ACTIVE', orderId: null } });
  }
}

async function main() {
  const studentEmail = process.env.STUDENT_EMAIL;
  const studentPassword = process.env.STUDENT_PASSWORD;
  const studentName = process.env.STUDENT_NAME || 'Demo Student';

  if (!studentEmail || !studentPassword) {
    fail('STUDENT_EMAIL and STUDENT_PASSWORD env vars are required (STUDENT_NAME is optional).');
  }
  if (
    studentPassword.length < MIN_PASSWORD_LENGTH ||
    PLACEHOLDER_PASSWORDS.has(studentPassword.toLowerCase())
  ) {
    fail(`STUDENT_PASSWORD is too weak or a known placeholder. Use a random password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  // -----------------------------------------------------------------------
  // Categories (reuses the same slugs seeded by scripts/seed-categories.js)
  // -----------------------------------------------------------------------
  const cosmetology = await prisma.category.upsert({
    where: { slug: 'cosmetology' },
    update: {},
    create: { name: 'Cosmetology', slug: 'cosmetology', status: 'ACTIVE' },
  });
  const aesthetics = await prisma.category.upsert({
    where: { slug: 'aesthetics' },
    update: {},
    create: { name: 'Aesthetics', slug: 'aesthetics', status: 'ACTIVE' },
  });

  // -----------------------------------------------------------------------
  // Course 1: Professional Cosmetology Foundations (student IS enrolled)
  // -----------------------------------------------------------------------
  const course1ThumbUrl = ensureThumbnail(COURSE_1_THUMB_FILENAME, {
    titleLines: ['Cosmetology', 'Foundations'],
    category: 'Cosmetology',
    accent: ['#6d28d9', '#db2777'],
  });

  const course1 = await prisma.course.upsert({
    where: { slug: 'professional-cosmetology-foundations' },
    update: {
      title: 'Professional Cosmetology Foundations',
      status: 'PUBLISHED',
      featured: true,
      categoryId: cosmetology.id,
    },
    create: {
      title: 'Professional Cosmetology Foundations',
      slug: 'professional-cosmetology-foundations',
      shortDescription:
        'A structured introductory program covering the foundations of professional cosmetology, hygiene, client preparation and practical workflow.',
      description:
        'This introductory program lays the groundwork for a career in professional cosmetology. Students are guided through core hygiene and sanitation standards, client consultation and preparation, workstation setup, and the practical workflow expected in a professional salon or clinical setting. The course combines orientation material with structured practical guidance suitable for beginners, building safe, confident, industry-ready habits from day one.',
      thumbnailUrl: course1ThumbUrl,
      categoryId: cosmetology.id,
      price: 4999,
      currency: 'INR',
      level: 'BEGINNER',
      status: 'PUBLISHED',
      featured: true,
      duration: '1h 30m',
      publishedAt: new Date(),
    },
  });

  const course1VideoCheck = checkVideoPresence(COURSE_1_VIDEO_FILENAME);
  await prisma.lesson.upsert({
    where: { courseId_slug: { courseId: course1.id, slug: 'course-orientation-cosmetology-foundations' } },
    update: {
      title: 'Course Orientation & Cosmetology Foundations',
      videoType: 'LOCAL',
      videoPath: COURSE_1_VIDEO_FILENAME,
      status: 'PUBLISHED',
      preview: false,
      sortOrder: 1,
    },
    create: {
      courseId: course1.id,
      title: 'Course Orientation & Cosmetology Foundations',
      slug: 'course-orientation-cosmetology-foundations',
      description:
        'An orientation to the course structure, hygiene standards, and the foundational skills covered throughout the program.',
      videoType: 'LOCAL',
      videoPath: COURSE_1_VIDEO_FILENAME,
      sortOrder: 1,
      preview: false,
      status: 'PUBLISHED',
    },
  });

  // -----------------------------------------------------------------------
  // Course 2: Introduction to Aesthetic Practice (student is NOT enrolled)
  // -----------------------------------------------------------------------
  const course2ThumbUrl = ensureThumbnail(COURSE_2_THUMB_FILENAME, {
    titleLines: ['Aesthetic', 'Practice'],
    category: 'Aesthetics',
    accent: ['#0891b2', '#4f46e5'],
  });

  const course2 = await prisma.course.upsert({
    where: { slug: 'introduction-to-aesthetic-practice' },
    update: {
      title: 'Introduction to Aesthetic Practice',
      status: 'PUBLISHED',
      featured: true,
      categoryId: aesthetics.id,
    },
    create: {
      title: 'Introduction to Aesthetic Practice',
      slug: 'introduction-to-aesthetic-practice',
      shortDescription:
        'An introductory program exploring professional practice, hygiene, client interaction and foundational aesthetic concepts.',
      description:
        'This program introduces the foundations of aesthetic practice, covering professional conduct, hygiene and safety standards, client interaction, and the core concepts that underpin day-to-day aesthetic work. It is intended as a starting point for students exploring this field before progressing to more advanced, hands-on coursework.',
      thumbnailUrl: course2ThumbUrl,
      categoryId: aesthetics.id,
      price: 4999,
      currency: 'INR',
      level: 'BEGINNER',
      status: 'PUBLISHED',
      featured: true,
      duration: '1h 15m',
      publishedAt: new Date(),
    },
  });

  const course2VideoCheck = checkVideoPresence(COURSE_2_VIDEO_FILENAME);
  await prisma.lesson.upsert({
    where: { courseId_slug: { courseId: course2.id, slug: 'introduction-to-aesthetic-practice' } },
    update: {
      title: 'Introduction to Aesthetic Practice',
      videoType: 'LOCAL',
      videoPath: COURSE_2_VIDEO_FILENAME,
      status: 'PUBLISHED',
      preview: false,
      sortOrder: 1,
    },
    create: {
      courseId: course2.id,
      title: 'Introduction to Aesthetic Practice',
      slug: 'introduction-to-aesthetic-practice',
      description:
        'An introduction to professional aesthetic practice, hygiene standards, and client interaction fundamentals.',
      videoType: 'LOCAL',
      videoPath: COURSE_2_VIDEO_FILENAME,
      sortOrder: 1,
      preview: false,
      status: 'PUBLISHED',
    },
  });

  // -----------------------------------------------------------------------
  // Demo student
  // -----------------------------------------------------------------------
  const passwordHash = await hashPassword(studentPassword);
  const student = await prisma.user.upsert({
    where: { email: studentEmail },
    update: { passwordHash, name: studentName, role: 'STUDENT', status: 'ACTIVE' },
    create: { email: studentEmail, name: studentName, passwordHash, role: 'STUDENT', status: 'ACTIVE' },
  });

  // -----------------------------------------------------------------------
  // Enrollment: Course 1 only. Any stray Course 2 enrollment from a prior
  // run is defensively cancelled (never deleted, to preserve history) so
  // re-running this script always converges to the required demo state.
  // -----------------------------------------------------------------------
  await upsertEnrollment(student.id, course1.id, 'ACTIVE');
  await upsertEnrollment(student.id, course2.id, 'CANCELLED');

  console.log('\nsetup-minimal-demo: done.');
  console.log(`  Course 1: ${course1.title} (/courses/${course1.slug}) — student ENROLLED`);
  console.log(`  Course 2: ${course2.title} (/courses/${course2.slug}) — student NOT enrolled`);
  console.log(`  Student:  ${student.email} (password not printed)`);

  if (!course1VideoCheck.exists) {
    console.warn(`\n  WARNING: Course 1 video file not found. Place it at:\n    ${course1VideoCheck.absolute}`);
  }
  if (!course2VideoCheck.exists) {
    console.warn(`\n  WARNING: Course 2 video file not found. Place it at:\n    ${course2VideoCheck.absolute}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
