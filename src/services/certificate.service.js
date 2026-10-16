const { prisma } = require('../config/db');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const crypto = require('crypto');
const { isUniqueConstraintError } = require('../lib/prismaErrors');
const emailService = require('./email.service');
const certificateStorage = require('../lib/certificateStorage');

async function isCertificateEligible(userId, courseId) {
  const enrollment = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } } });
  if (!enrollment || enrollment.status !== 'ACTIVE') return { eligible: false, reason: 'An active enrollment is required.' };
  const lessons = await prisma.lesson.findMany({ where: { courseId, status: 'PUBLISHED' }, select: { id: true } });
  if (!lessons.length) return { eligible: false, reason: 'This course has no published lessons.' };
  const completed = await prisma.lessonProgress.count({ where: { userId, lessonId: { in: lessons.map((lesson) => lesson.id) }, completed: true } });
  return completed === lessons.length ? { eligible: true } : { eligible: false, reason: 'Complete all published lessons first.' };
}

// Single certificate-number generator shared by completion and admin
// issuance: the number is derived from the database-assigned id, so IDs stay
// globally unique and there is only one numbering system.
function createNumberedCertificate(tx, data) {
  return tx.certificate
    .create({ data: { ...data, certificateNumber: `PENDING-${crypto.randomUUID()}` } })
    .then((created) =>
      tx.certificate.update({
        where: { id: created.id },
        data: { certificateNumber: `ICDS-CERT-${new Date().getFullYear()}-${String(created.id).padStart(6, '0')}` },
      })
    );
}

async function issueCertificate(userId, courseId) {
  const existing = await prisma.certificate.findUnique({ where: { userId_courseId: { userId, courseId } } });
  if (existing) {
    if (existing.status === 'REVOKED') {
      const error = new Error('This certificate is no longer valid. Please contact the institute.');
      error.code = 'INELIGIBLE';
      throw error;
    }
    return existing;
  }
  const eligibility = await isCertificateEligible(userId, courseId);
  if (!eligibility.eligible) { const error = new Error(eligibility.reason); error.code = 'INELIGIBLE'; throw error; }
  // The ID is database-assigned; the transaction and unique user/course key make issuance idempotent.
  let issued;
  try {
    issued = await prisma.$transaction((tx) => createNumberedCertificate(tx, { userId, courseId, source: 'COMPLETION' }));
  } catch (error) {
    if (isUniqueConstraintError(error)) return prisma.certificate.findUnique({ where: { userId_courseId: { userId, courseId } } });
    throw error;
  }

  // Notification only, and only on genuine first issuance (not the
  // existing-certificate short-circuit above) — never blocks/rolls back
  // issuance if email fails or SMTP isn't configured.
  Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    prisma.course.findUnique({ where: { id: courseId }, select: { title: true } }),
  ])
    .then(([user, course]) => {
      if (!user || !course) return;
      return emailService.sendCertificateIssuedEmail(null, {
        toEmail: user.email,
        studentName: user.name,
        courseTitle: course.title,
      });
    })
    .catch(() => {});

  return issued;
}

async function certificatePdf(certificate) {
  const doc = await PDFDocument.create(); const page = doc.addPage([842, 595]); const font = await doc.embedFont(StandardFonts.Helvetica); const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 18, y: 18, width: width - 36, height: height - 36, borderColor: rgb(0.34, 0.35, 0.81), borderWidth: 3 });
  const centered = (text, y, size, useBold = false, color = rgb(0.1, 0.12, 0.2)) => { const f = useBold ? bold : font; page.drawText(String(text), { x: (width - f.widthOfTextAtSize(String(text), size)) / 2, y, size, font: f, color }); };
  centered('Institute of Cosmetology & Dental Sciences', 490, 23, true, rgb(0.34, 0.35, 0.81)); centered('CERTIFICATE OF COMPLETION', 430, 28, true); centered('This certifies that', 380, 14); centered(certificate.user.name, 335, 30, true, rgb(0.34, 0.35, 0.81)); centered('has successfully completed', 290, 14); centered(certificate.course.title, 250, 22, true);
  if (certificate.course.instructor) centered(`Instructor: ${certificate.course.instructor.name}`, 210, 12);
  centered(`Issued ${certificate.issuedAt.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}`, 130, 12); centered(certificate.certificateNumber, 95, 12, true); centered('Verify this certificate at the institute website.', 62, 10, false, rgb(0.35, 0.35, 0.35));
  return doc.save();
}

// Explicit administrative override: issues a certificate WITHOUT requiring
// course completion. The issuing admin, the reason and the issue date are
// recorded on the row (the note is internal only). One certificate per
// student + course, so a second issuance is refused with code DUPLICATE.
async function issueAdminCertificate({ userId, courseId, issuedAt, adminNote, issuedByUserId, fileName = null }) {
  const [student, course] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } }),
    prisma.course.findUnique({ where: { id: courseId }, select: { id: true } }),
  ]);
  if (!student || student.role !== 'STUDENT') { const e = new Error('Student not found.'); e.code = 'NOT_FOUND'; throw e; }
  if (!course) { const e = new Error('Course not found.'); e.code = 'NOT_FOUND'; throw e; }

  const duplicate = () => {
    const e = new Error('This student already has a certificate for this course.');
    e.code = 'DUPLICATE';
    return e;
  };
  if (await prisma.certificate.findUnique({ where: { userId_courseId: { userId, courseId } } })) throw duplicate();

  try {
    return await prisma.$transaction((tx) =>
      createNumberedCertificate(tx, {
        userId, courseId, issuedAt, adminNote, issuedByUserId, fileUrl: fileName, source: 'ADMIN_ISSUED',
      })
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) throw duplicate();
    throw error;
  }
}

async function setCertificateStatus(id, status) {
  const result = await prisma.certificate.updateMany({
    where: { id },
    data: { status, revokedAt: status === 'REVOKED' ? new Date() : null },
  });
  return result.count > 0;
}

// The bytes a download should return: the admin-uploaded PDF when there is
// one (and it still exists), otherwise the PDF generated by the existing
// generator. `certificate` must include user and course(+instructor).
async function certificateFile(certificate) {
  if (certificate.fileUrl) {
    const uploaded = await certificateStorage.readStoredFile(certificate.fileUrl);
    if (uploaded) return uploaded;
  }
  return Buffer.from(await certificatePdf(certificate));
}

module.exports = { isCertificateEligible, issueCertificate, issueAdminCertificate, setCertificateStatus, certificateFile, certificatePdf };
