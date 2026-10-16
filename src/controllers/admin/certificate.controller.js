const { prisma } = require('../../config/db');
const certificateService = require('../../services/certificate.service');
const certificateStorage = require('../../lib/certificateStorage');
const { validateAdminCertificate } = require('../../validators/certificate.validator');

async function loadPage(res, { status = 200, errors = [], values = {} } = {}) {
  const [certificates, students, courses] = await Promise.all([
    prisma.certificate.findMany({
      include: {
        user: { select: { name: true, email: true } },
        course: { select: { title: true } },
        issuedBy: { select: { name: true } },
      },
      orderBy: { issuedAt: 'desc' },
    }),
    prisma.user.findMany({ where: { role: 'STUDENT', status: 'ACTIVE' }, select: { name: true, email: true }, orderBy: { name: 'asc' } }),
    prisma.course.findMany({ select: { id: true, title: true }, orderBy: { title: 'asc' } }),
  ]);
  res.status(status).render('admin/certificates', {
    pageTitle: 'Certificates | Admin',
    metaDescription: 'Issued certificates.',
    certificates,
    students,
    courses,
    errors,
    values,
    activeNav: 'certificates',
  });
}

async function listCertificates(req, res, next) {
  try {
    await loadPage(res);
  } catch (err) {
    next(err);
  }
}

function discardUpload(req) {
  if (req.file) certificateStorage.deleteStoredFile(req.file.filename);
}

async function issueCertificate(req, res, next) {
  try {
    const { errors, values } = validateAdminCertificate(req.body);
    if (errors.length) {
      discardUpload(req);
      return await loadPage(res, { status: 400, errors, values: req.body });
    }

    const student = await prisma.user.findFirst({ where: { email: values.studentEmail, role: 'STUDENT' }, select: { id: true } });
    if (!student) {
      discardUpload(req);
      return await loadPage(res, { status: 400, errors: ['Choose a student from the list.'], values: req.body });
    }

    try {
      const certificate = await certificateService.issueAdminCertificate({
        userId: student.id,
        courseId: values.courseId,
        issuedAt: values.issuedAt,
        adminNote: values.adminNote,
        issuedByUserId: req.currentUser.id,
        fileName: req.file ? req.file.filename : null,
      });
      req.certificateFileAdopted = true;
      req.flashSuccess(`Certificate ${certificate.certificateNumber} issued.`);
      return res.redirect('/admin/certificates');
    } catch (err) {
      if (err.code === 'DUPLICATE' || err.code === 'NOT_FOUND') {
        discardUpload(req);
        return await loadPage(res, { status: err.code === 'DUPLICATE' ? 409 : 400, errors: [err.message], values: req.body });
      }
      throw err;
    }
  } catch (err) {
    return next(err);
  }
}

function setStatus(status, message) {
  return async (req, res, next) => {
    try {
      const ok = await certificateService.setCertificateStatus(Number(req.params.id), status);
      if (!ok) req.flashError('Certificate not found.');
      else req.flashSuccess(message);
      res.redirect('/admin/certificates');
    } catch (err) {
      next(err);
    }
  };
}

async function downloadCertificate(req, res, next) {
  try {
    const certificate = await prisma.certificate.findUnique({
      where: { id: Number(req.params.id) },
      include: { user: { select: { name: true } }, course: { include: { instructor: true } } },
    });
    if (!certificate) return res.status(404).render('public/404', { pageTitle: 'Not Found' });
    const pdf = await certificateService.certificateFile(certificate);
    return res
      .type('application/pdf')
      .set('Content-Disposition', `attachment; filename="${certificate.certificateNumber}.pdf"`)
      .send(pdf);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listCertificates,
  issueCertificate,
  revokeCertificate: setStatus('REVOKED', 'Certificate revoked. It no longer verifies as valid.'),
  restoreCertificate: setStatus('ACTIVE', 'Certificate restored.'),
  downloadCertificate,
};
