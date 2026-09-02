const { listEnrollmentsForUser } = require('../services/enrollment.service');
const { markLessonComplete, ProgressError } = require('../services/progress.service');
const orderService = require('../services/order.service');
const { parsePage } = require('../lib/pagination');
const { prisma } = require('../config/db');
const { validateProfile, validatePasswordChange } = require('../validators/profile.validator');
const { verifyPassword, hashPassword } = require('../lib/password');
const certificateService = require('../services/certificate.service');

async function getDashboard(req, res, next) {
  try {
    const enrollments = await listEnrollmentsForUser(req.currentUser.id);
    const [ordersCount, certificatesCount] = await Promise.all([prisma.order.count({ where: { userId: req.currentUser.id } }), prisma.certificate.count({ where: { userId: req.currentUser.id } })]);
    const completionChecks = await Promise.all(enrollments.map((enrollment) => certificateService.isCertificateEligible(req.currentUser.id, enrollment.courseId)));
    const certificateRows = await prisma.certificate.findMany({ where: { userId: req.currentUser.id }, select: { courseId: true, id: true } });
    const certificateByCourse = Object.fromEntries(certificateRows.map((row) => [row.courseId, row]));
    enrollments.forEach((enrollment, index) => { enrollment.certificateEligible = completionChecks[index].eligible; enrollment.certificate = certificateByCourse[enrollment.courseId] || null; });

    res.render('student/dashboard', {
      pageTitle: 'My Courses | ICDS',
      metaDescription: 'Your enrolled courses and learning progress.',
      enrollments,
      dashboardCounts: { enrolledCourses: enrollments.length, completedCourses: completionChecks.filter((result) => result.eligible).length, certificates: certificatesCount, orders: ordersCount },
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

module.exports = { getDashboard, completeLesson, listMyOrders, getMyOrderDetail, profilePage, updateProfile, securityPage, changePassword, listCertificates, issueCertificate, downloadCertificate };
