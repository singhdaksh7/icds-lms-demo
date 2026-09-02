const { listEnrollmentsForUser } = require('../services/enrollment.service');
const { markLessonComplete, ProgressError } = require('../services/progress.service');
const orderService = require('../services/order.service');
const { parsePage } = require('../lib/pagination');
const { prisma } = require('../config/db');

async function getDashboard(req, res, next) {
  try {
    const enrollments = await listEnrollmentsForUser(req.currentUser.id);

    res.render('student/dashboard', {
      pageTitle: 'My Courses | ICDS',
      metaDescription: 'Your enrolled courses and learning progress.',
      enrollments,
    });
  } catch (err) {
    next(err);
  }
}

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

module.exports = { getDashboard, completeLesson, listMyOrders, getMyOrderDetail };
