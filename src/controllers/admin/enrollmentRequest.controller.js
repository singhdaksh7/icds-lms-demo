const enrollmentRequestService = require('../../services/enrollmentRequest.service');
const enrollmentService = require('../../services/enrollment.service');

const STATUSES = ['PENDING', 'CONTACTED', 'ENROLLED', 'DECLINED'];

async function listRequests(req, res, next) {
  try {
    const status = STATUSES.includes(req.query.status) ? req.query.status : '';
    const requests = await enrollmentRequestService.listRequestsAdmin({ status: status || undefined });

    res.render('admin/enrollment-requests/list', {
      pageTitle: 'Enrollment Requests | Admin',
      metaDescription: 'Student enrollment requests.',
      requests,
      statuses: STATUSES,
      activeStatus: status,
      activeNav: 'enrollment-requests',
    });
  } catch (err) {
    next(err);
  }
}

// Marks the request ENROLLED and performs the same orderId=null manual
// enrollment used elsewhere in admin — never fabricates payment state.
async function approveRequest(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    await enrollmentRequestService.approveAndEnroll(id);
    req.flashSuccess('Student enrolled and request marked as fulfilled.');
  } catch (err) {
    if (err instanceof enrollmentRequestService.EnrollmentRequestError || err instanceof enrollmentService.EnrollmentError) {
      req.flashError(err.message);
    } else {
      return next(err);
    }
  }
  res.redirect('/admin/enrollment-requests');
}

async function updateStatus(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const status = STATUSES.includes(req.body.status) ? req.body.status : null;
    if (!status) {
      req.flashError('Invalid status.');
      return res.redirect('/admin/enrollment-requests');
    }
    await enrollmentRequestService.setStatus(id, status);
    req.flashSuccess('Request status updated.');
  } catch (err) {
    if (err instanceof enrollmentRequestService.EnrollmentRequestError) {
      req.flashError(err.message);
    } else {
      return next(err);
    }
  }
  res.redirect('/admin/enrollment-requests');
}

module.exports = { listRequests, approveRequest, updateStatus };
