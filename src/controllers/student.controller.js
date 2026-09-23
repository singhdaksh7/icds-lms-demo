const { listEnrollmentsForUser } = require('../services/enrollment.service');
const { markLessonComplete, saveLessonProgress, ProgressError } = require('../services/progress.service');
const orderService = require('../services/order.service');
const { parsePage } = require('../lib/pagination');
const { prisma } = require('../config/db');
const { validateProfile, validatePasswordChange } = require('../validators/profile.validator');
const { verifyPassword, hashPassword } = require('../lib/password');
const certificateService = require('../services/certificate.service');
const { computeDashboardSummary, pickContinueLearningEnrollment, courseStateLabel, courseButtonLabel } = require('../services/dashboard.service');

async function getDashboard(req, res, next) {
  try {
    // listEnrollmentsForUser returns ALL enrollments (any status) so the
    // "My Courses" grid / continue-learning pick must only ever surface
    // ACTIVE ones — cancelled/expired enrollments stay out of the student's
    // active dashboard view entirely (not just visually de-emphasized).
    const allEnrollments = await listEnrollmentsForUser(req.currentUser.id);
    const enrollments = allEnrollments.filter((enrollment) => enrollment.status === 'ACTIVE');

    const [certificatesCount, completionChecks, certificateRows] = await Promise.all([
      prisma.certificate.count({ where: { userId: req.currentUser.id } }),
      Promise.all(enrollments.map((enrollment) => certificateService.isCertificateEligible(req.currentUser.id, enrollment.courseId))),
      prisma.certificate.findMany({ where: { userId: req.currentUser.id }, select: { courseId: true, id: true } }),
    ]);
    const certificateByCourse = Object.fromEntries(certificateRows.map((row) => [row.courseId, row]));

    // Per-course last-activity timestamp (max LessonProgress.updatedAt among
    // that course's lessons for this user), used only to pick which
    // enrolled course is "Continue Learning" — Enrollment has no such field
    // of its own, and this derives it from existing data with no migration.
    const lastActivityByEnrollmentId = {};
    await Promise.all(enrollments.map(async (enrollment, index) => {
      enrollment.certificateEligible = completionChecks[index].eligible;
      enrollment.certificate = certificateByCourse[enrollment.courseId] || null;
      enrollment.stateLabel = courseStateLabel(enrollment.progressPercent);
      enrollment.buttonLabel = courseButtonLabel(enrollment.progressPercent);

      const lessonCount = await prisma.lesson.count({ where: { courseId: enrollment.courseId, status: 'PUBLISHED' } });
      enrollment.lessonCount = lessonCount;

      const latestProgress = await prisma.lessonProgress.findFirst({
        where: { userId: req.currentUser.id, lesson: { courseId: enrollment.courseId } },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      });
      if (latestProgress) lastActivityByEnrollmentId[enrollment.id] = latestProgress.updatedAt;
    }));

    const continueLearning = pickContinueLearningEnrollment(enrollments, lastActivityByEnrollmentId);
    const dashboardCounts = computeDashboardSummary(enrollments, certificatesCount);
    const latestCertificate = certificateRows.length
      ? await prisma.certificate.findFirst({ where: { userId: req.currentUser.id }, orderBy: { issuedAt: 'desc' }, include: { course: { select: { title: true } } } })
      : null;

    res.render('student/dashboard', {
      pageTitle: 'My Courses | ICDS',
      metaDescription: 'Your enrolled courses and learning progress.',
      enrollments,
      continueLearning,
      dashboardCounts,
      latestCertificate,
    });
  } catch (err) {
    next(err);
  }
}

function profilePage(req, res) { res.render('student/profile', { pageTitle: 'My Profile | ICDS', metaDescription: 'Manage your account.', errors: [], values: req.currentUser }); }
async function updateProfile(req, res, next) { const { errors, values } = validateProfile(req.body); if (errors.length) return res.status(400).render('student/profile', { pageTitle: 'My Profile | ICDS', metaDescription: 'Manage your account.', errors, values }); try { const conflict = await prisma.user.findUnique({ where: { email: values.email } }); if (conflict && conflict.id !== req.currentUser.id) return res.status(409).render('student/profile', { pageTitle: 'My Profile | ICDS', metaDescription: 'Manage your account.', errors: ['That email is already in use.'], values }); await prisma.user.update({ where: { id: req.currentUser.id }, data: values }); req.flashSuccess('Profile updated.'); res.redirect('/student/profile'); } catch (e) { next(e); } }
function securityPage(req, res) { res.render('student/security', { pageTitle: 'Security | ICDS', metaDescription: 'Change your password.', errors: [] }); }
async function changePassword(req, res, next) { const { errors } = validatePasswordChange(req.body); if (errors.length) return res.status(400).render('student/security', { pageTitle: 'Security | ICDS', metaDescription: 'Change your password.', errors }); try { const user = await prisma.user.findUnique({ where: { id: req.currentUser.id } }); if (!user || !(await verifyPassword(req.body.currentPassword, user.passwordHash))) return res.status(400).render('student/security', { pageTitle: 'Security | ICDS', metaDescription: 'Change your password.', errors: ['Current password is incorrect.'] }); await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(req.body.newPassword) } }); req.flashSuccess('Password changed successfully.'); res.redirect('/student/security'); } catch (e) { next(e); } }
async function listCertificates(req, res, next) { try { const certificates = await prisma.certificate.findMany({ where: { userId: req.currentUser.id }, include: { course: true }, orderBy: { issuedAt: 'desc' } }); res.render('student/certificates', { pageTitle: 'My Certificates | ICDS', metaDescription: 'Your issued certificates.', certificates }); } catch (e) { next(e); } }
async function issueCertificate(req, res, next) { const courseId = Number(req.params.courseId); if (!Number.isInteger(courseId)) return res.status(404).render('public/404', { pageTitle: 'Not Found' }); try { const certificate = await certificateService.issueCertificate(req.currentUser.id, courseId); req.flashSuccess(`Certificate ${certificate.certificateNumber} is ready.`); res.redirect('/student/certificates'); } catch (e) { if (e.code === 'INELIGIBLE') { req.flashError(e.message); return res.redirect('/student/dashboard'); } next(e); } }
async function downloadCertificate(req, res, next) { const id = Number(req.params.id); if (!Number.isInteger(id)) return res.status(404).render('public/404', { pageTitle: 'Not Found' }); try { const certificate = await prisma.certificate.findFirst({ where: { id, userId: req.currentUser.id }, include: { user: { select: { name: true } }, course: { include: { instructor: true } } } }); if (!certificate) return res.status(404).render('public/404', { pageTitle: 'Not Found' }); const pdf = await certificateService.certificatePdf(certificate); const filename = `${certificate.course.slug}-certificate.pdf`.replace(/[^a-z0-9.-]/gi, '-'); res.type('application/pdf').set('Content-Disposition', `attachment; filename="${filename}"`).send(Buffer.from(pdf)); } catch (e) { next(e); } }

async function completeLesson(req, res, next) {
  try {
    const lessonId = parseInt(req.params.lessonId, 10);
    if (!Number.isInteger(lessonId)) {
      return res.status(404).render('public/404', { pageTitle: 'Not Found' });
    }

    const { lesson } = await markLessonComplete(req.currentUser.id, lessonId);
    const course = await prisma.course.findUnique({ where: { id: lesson.courseId } });

    req.flashSuccess('Lesson marked as complete.');
    res.redirect(`/learn/${course.slug}/${lesson.slug}`);
  } catch (err) {
    if (err instanceof ProgressError) {
      req.flashError(err.message);
      return res.redirect('/student/dashboard');
    }
    next(err);
  }
}

// Called periodically by the lesson video player (see public/js/lesson-progress.js)
// to persist resume position + progress. JSON in, JSON out — never a
// redirect, since this is an XHR/sendBeacon call, not a form submission.
async function saveProgress(req, res, next) {
  try {
    const lessonId = parseInt(req.params.lessonId, 10);
    if (!Number.isInteger(lessonId)) {
      return res.status(404).json({ success: false, error: 'Not found.' });
    }

    const positionSeconds = Number(req.body.positionSeconds);
    const durationSeconds = Number(req.body.durationSeconds);
    // Optional: only present once the client has accumulated genuine
    // playback time since its last save (see public/js/lesson-progress.js).
    // Absent/invalid simply means "no additional watched time to report" —
    // never treated as an error, since a plain resume-position save (e.g.
    // on pagehide right after a seek) legitimately has no delta.
    const watchedDeltaSeconds = Number(req.body.watchedDeltaSeconds) || 0;
    if (!Number.isFinite(positionSeconds) || !Number.isFinite(durationSeconds)) {
      return res.status(400).json({ success: false, error: 'Invalid progress data.' });
    }

    const { lessonProgress, progress } = await saveLessonProgress(req.currentUser.id, lessonId, {
      positionSeconds,
      durationSeconds,
      watchedDeltaSeconds,
    });

    res.json({
      success: true,
      completed: lessonProgress.completed,
      watchedSeconds: lessonProgress.watchedSeconds,
      progressPercent: progress.percent,
    });
  } catch (err) {
    if (err instanceof ProgressError) {
      return res.status(403).json({ success: false, error: err.message });
    }
    next(err);
  }
}

async function listMyOrders(req, res, next) {
  try {
    const page = parsePage(req.query.page);
    const { orders, pagination } = await orderService.listOrdersForUser(req.currentUser.id, { page });

    const pageUrl = (targetPage) => `/student/orders${targetPage > 1 ? `?page=${targetPage}` : ''}`;

    res.render('student/orders/list', {
      pageTitle: 'My Orders | ICDS',
      metaDescription: 'Your order history.',
      orders,
      pagination,
      pageUrl,
    });
  } catch (err) {
    next(err);
  }
}

async function getMyOrderDetail(req, res, next) {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (!Number.isInteger(orderId)) {
      return res.status(404).render('public/404', { pageTitle: 'Order Not Found' });
    }

    // Ownership-scoped lookup — a student can never view another
    // student's order by guessing/incrementing the id in the URL.
    const order = await orderService.getOrderForUser(orderId, req.currentUser.id);
    if (!order) {
      return res.status(404).render('public/404', { pageTitle: 'Order Not Found' });
    }

    res.render('student/orders/detail', {
      pageTitle: `Order #${order.id} | ICDS`,
      metaDescription: 'Order detail.',
      order,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getDashboard, completeLesson, saveProgress, listMyOrders, getMyOrderDetail, profilePage, updateProfile, securityPage, changePassword, listCertificates, issueCertificate, downloadCertificate };
