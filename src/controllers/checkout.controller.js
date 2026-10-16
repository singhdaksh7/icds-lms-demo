const courseService = require('../services/course.service');
const enrollmentService = require('../services/enrollment.service');
const enrollmentRequestService = require('../services/enrollmentRequest.service');
const orderService = require('../services/order.service');
const razorpayService = require('../services/razorpay.service');
const taxSettings = require('../services/taxSettings.service');
const { getCoursePurchasePrice } = require('../lib/pricing');
const { toPaise } = require('../lib/money');
const { safeRedirectPath } = require('../lib/safeRedirect');

async function getCheckoutPage(req, res, next) {
  try {
    const course = await courseService.getPublishedCourseBySlug(req.params.courseSlug);
    if (!course) {
      return res.status(404).render('public/404', { pageTitle: 'Course Not Found' });
    }

    if (!req.currentUser) {
      const returnTo = safeRedirectPath(`/checkout/${course.slug}`, '/');
      return res.redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    }

    if (req.currentUser.role !== 'STUDENT') {
      req.flashError('Only student accounts can purchase courses.');
      return res.redirect(`/courses/${course.slug}`);
    }

    const alreadyEnrolled = await enrollmentService.isUserEnrolled(req.currentUser.id, course.id);
    if (alreadyEnrolled) {
      req.flashSuccess('You are already enrolled in this course.');
      return res.redirect(`/learn/${course.slug}`);
    }

    const listPrice = getCoursePurchasePrice(course);
    const isFree = Number(listPrice) === 0;
    const pricing = await taxSettings.getPricing(course, listPrice);
    const amount = pricing.total;

    res.render('public/checkout', {
      pageTitle: `Checkout: ${course.title} | ICDS`,
      metaDescription: `Complete your purchase of ${course.title}.`,
      course,
      amount,
      pricing,
      isFree,
      razorpayConfigured: await razorpayService.isConfigured(),
      razorpayKeyId: await razorpayService.getPublicKeyId(),
    });
  } catch (err) {
    next(err);
  }
}

async function createOrder(req, res, next) {
  try {
    const course = await courseService.getPublishedCourseBySlug(req.params.courseSlug);
    if (!course) {
      return res.status(404).json({ success: false, error: 'Course not found.' });
    }

    if (req.currentUser.role !== 'STUDENT') {
      return res.status(403).json({ success: false, error: 'Only student accounts can purchase courses.' });
    }

    // Re-check ownership at order-creation time too, not just on the
    // checkout page render — closes the window for a duplicate purchase
    // from a stale page / double-submitted request.
    const alreadyEnrolled = await enrollmentService.isUserEnrolled(req.currentUser.id, course.id);
    if (alreadyEnrolled) {
      return res.status(409).json({ success: false, error: 'You are already enrolled in this course.' });
    }

    // Server calculates the amount — the client never gets a say.
    const listPrice = getCoursePurchasePrice(course);
    if (Number(listPrice) === 0) {
      return res
        .status(400)
        .json({ success: false, error: 'This course is free — use the free enrollment option instead.' });
    }

    if (!(await razorpayService.isConfigured())) {
      return res.status(503).json({ success: false, error: 'Payments are not available right now.' });
    }

    // Reuse a recent still-PENDING order (double-click / reopened popup)
    // rather than creating another local + Razorpay order.
    // GST breakdown is computed here from the DB price + admin tax settings;
    // the client never supplies any amount.
    const pricing = await taxSettings.getPricing(course, listPrice);
    const amount = pricing.total;

    const reusable = await orderService.findReusablePendingOrder(req.currentUser.id, course, pricing);

    let order = reusable;
    let providerOrder;

    if (reusable) {
      providerOrder = { id: reusable.providerOrderId, amount: toPaise(amount), currency: reusable.currency };
    } else {
      order = await orderService.createPendingOrder(req.currentUser.id, course, pricing);

      try {
        providerOrder = await razorpayService.createProviderOrder({
          amountPaise: toPaise(amount),
          currency: course.currency,
          receipt: `rcpt_${order.id}`,
        });
      } catch (err) {
        const reason = razorpayService.describeError(err);
        await orderService.markOrderFailed(order.id, `Razorpay order creation failed: ${reason}`);
        console.error(`[payment] Razorpay order creation failed for local order ${order.id}: ${reason}`);
        return res.status(502).json({ success: false, error: 'Could not start payment. Please try again.' });
      }

      await orderService.attachProviderOrder(order.id, providerOrder.id);
    }

    console.log(
      `[payment] order ${reusable ? 'reused' : 'created'} localOrderId=${order.id} providerOrderId=${providerOrder.id} amountPaise=${providerOrder.amount}`
    );

    res.json({
      success: true,
      orderId: order.id,
      providerOrderId: providerOrder.id,
      amount: providerOrder.amount,
      currency: providerOrder.currency,
      keyId: await razorpayService.getPublicKeyId(),
      courseName: course.title,
      studentName: req.currentUser.name,
      studentEmail: req.currentUser.email,
      siteName: require('../config/site').name,
    });
  } catch (err) {
    if (err instanceof razorpayService.PaymentConfigError) {
      return res.status(503).json({ success: false, error: 'Payments are not available right now.' });
    }
    next(err);
  }
}

async function enrollFree(req, res, next) {
  try {
    const course = await courseService.getPublishedCourseBySlug(req.params.slug);
    if (!course) {
      req.flashError('Course not found.');
      return res.redirect('/courses');
    }

    if (req.currentUser.role !== 'STUDENT') {
      req.flashError('Only student accounts can enroll.');
      return res.redirect(`/courses/${course.slug}`);
    }

    // Never trust a client-asserted "this is free" — recompute server-side.
    const amount = getCoursePurchasePrice(course);
    if (Number(amount) !== 0) {
      req.flashError('This course is not free.');
      return res.redirect(`/courses/${course.slug}`);
    }

    const alreadyEnrolled = await enrollmentService.isUserEnrolled(req.currentUser.id, course.id);
    if (alreadyEnrolled) {
      req.flashSuccess('You are already enrolled in this course.');
      return res.redirect(`/learn/${course.slug}`);
    }

    await enrollmentService.enrollFree(req.currentUser.id, course.id);
    req.flashSuccess('Enrolled successfully.');
    res.redirect(`/learn/${course.slug}`);
  } catch (err) {
    if (err instanceof enrollmentService.EnrollmentError) {
      req.flashError(err.message);
      return res.redirect(`/courses/${req.params.slug}`);
    }
    next(err);
  }
}

// Primary launch-phase path for paid courses while Razorpay stays disabled
// (see README "Razorpay"): the student expresses interest, and the admin
// finishes the enrollment manually via /admin/enrollment-requests — never a
// working payment, and never a fabricated Order.
async function requestEnrollment(req, res, next) {
  try {
    const course = await courseService.getPublishedCourseBySlug(req.params.slug);
    if (!course) {
      req.flashError('Course not found.');
      return res.redirect('/courses');
    }

    if (req.currentUser.role !== 'STUDENT') {
      req.flashError('Only student accounts can request enrollment.');
      return res.redirect(`/courses/${course.slug}`);
    }

    const alreadyEnrolled = await enrollmentService.isUserEnrolled(req.currentUser.id, course.id);
    if (alreadyEnrolled) {
      req.flashSuccess('You are already enrolled in this course.');
      return res.redirect(`/learn/${course.slug}`);
    }

    await enrollmentRequestService.createRequest(req.currentUser.id, course.id);
    req.flashSuccess('Request received. Our team will contact you to complete enrollment.');
    res.redirect(`/courses/${course.slug}`);
  } catch (err) {
    next(err);
  }
}

module.exports = { getCheckoutPage, createOrder, enrollFree, requestEnrollment };
