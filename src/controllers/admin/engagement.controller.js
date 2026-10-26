const { prisma } = require('../../config/db');
const contactEnquiries = require('../../services/contactEnquiry.service');

async function certificates(req, res, next) { try { const certificates = await prisma.certificate.findMany({ include: { user: { select: { name: true, email: true } }, course: { select: { title: true } } }, orderBy: { issuedAt: 'desc' } }); res.render('admin/certificates', { pageTitle: 'Certificates | ICDS', metaDescription: 'Issued certificates.', certificates, activeNav: 'certificates' }); } catch (e) { next(e); } }
async function newsletter(req, res, next) { try { const subscribers = await prisma.newsletterSubscriber.findMany({ orderBy: { subscribedAt: 'desc' } }); res.render('admin/newsletter', { pageTitle: 'Newsletter | ICDS', metaDescription: 'Newsletter subscribers.', subscribers, activeNav: 'newsletter' }); } catch (e) { next(e); } }

// Contact -> Enquiries (private: visible to admins only, never rendered publicly).
async function messages(req, res, next) {
  try {
    const data = await contactEnquiries.listEnquiries({ status: req.query.status });
    res.render('admin/messages', {
      pageTitle: 'Contact Enquiries | ICDS',
      metaDescription: 'Contact enquiries.',
      messages: data.rows,
      counts: data.counts,
      filter: data.filter,
      total: data.total,
      statuses: contactEnquiries.STATUSES,
      statusLabels: contactEnquiries.STATUS_LABELS,
      activeNav: 'messages',
    });
  } catch (e) { next(e); }
}

async function messageDetail(req, res, next) {
  try {
    const message = await contactEnquiries.getEnquiry(req.params.id);
    if (!message) return res.status(404).render('public/404', { pageTitle: 'Not Found' });
    res.render('admin/message-detail', {
      pageTitle: 'Enquiry | ICDS',
      metaDescription: 'Contact enquiry.',
      message,
      statuses: contactEnquiries.STATUSES,
      statusLabels: contactEnquiries.STATUS_LABELS,
      activeNav: 'messages',
    });
  } catch (e) { next(e); }
}

async function updateMessage(req, res, next) {
  const id = Number(req.params.id);
  try {
    await contactEnquiries.setStatus(id, req.body.status);
    req.flashSuccess('Enquiry status updated.');
    res.redirect(req.body.back === 'list' ? '/admin/messages' : `/admin/messages/${id}`);
  } catch (e) {
    if (e instanceof contactEnquiries.ContactEnquiryError) {
      req.flashError(e.message);
      return res.redirect(e.statusCode === 404 ? '/admin/messages' : `/admin/messages/${id}`);
    }
    next(e);
  }
}

async function deleteMessage(req, res, next) {
  try {
    await contactEnquiries.deleteEnquiry(req.params.id);
    req.flashSuccess('Enquiry deleted.');
    res.redirect('/admin/messages');
  } catch (e) {
    if (e instanceof contactEnquiries.ContactEnquiryError) {
      req.flashError(e.message);
      return res.redirect('/admin/messages');
    }
    next(e);
  }
}

module.exports = { certificates, newsletter, messages, messageDetail, updateMessage, deleteMessage };
