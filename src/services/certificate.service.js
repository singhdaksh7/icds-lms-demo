const { prisma } = require('../config/db');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const crypto = require('crypto');
const { isUniqueConstraintError } = require('../lib/prismaErrors');

async function isCertificateEligible(userId, courseId) {
  const enrollment = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } } });
  if (!enrollment || enrollment.status !== 'ACTIVE') return { eligible: false, reason: 'An active enrollment is required.' };
  const lessons = await prisma.lesson.findMany({ where: { courseId, status: 'PUBLISHED' }, select: { id: true } });
  if (!lessons.length) return { eligible: false, reason: 'This course has no published lessons.' };
  const completed = await prisma.lessonProgress.count({ where: { userId, lessonId: { in: lessons.map((lesson) => lesson.id) }, completed: true } });
  return completed === lessons.length ? { eligible: true } : { eligible: false, reason: 'Complete all published lessons first.' };
}

async function issueCertificate(userId, courseId) {
  const existing = await prisma.certificate.findUnique({ where: { userId_courseId: { userId, courseId } } });
  if (existing) return existing;
  const eligibility = await isCertificateEligible(userId, courseId);
  if (!eligibility.eligible) { const error = new Error(eligibility.reason); error.code = 'INELIGIBLE'; throw error; }
  // The ID is database-assigned; the transaction and unique user/course key make issuance idempotent.
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.certificate.create({ data: { userId, courseId, certificateNumber: `PENDING-${crypto.randomUUID()}` } });
      return tx.certificate.update({ where: { id: created.id }, data: { certificateNumber: `ICDS-CERT-${new Date().getFullYear()}-${String(created.id).padStart(6, '0')}` } });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) return prisma.certificate.findUnique({ where: { userId_courseId: { userId, courseId } } });
    throw error;
  }
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
module.exports = { isCertificateEligible, issueCertificate, certificatePdf };
