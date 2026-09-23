const faqService = require('../../services/faq.service');
const { validateFaq } = require('../../validators/faq.validator');

async function listFaqs(req, res, next) {
  try {
    const faqs = await faqService.listFaqsAdmin();
    res.render('admin/faqs/list', {
      pageTitle: 'Manage FAQs | Admin',
      metaDescription: 'Admin FAQ management.',
      faqs,
      errors: [],
      values: {},
    });
  } catch (err) {
    next(err);
  }
}

async function createFaq(req, res, next) {
  try {
    const { errors, values } = validateFaq(req.body);

    if (errors.length > 0) {
      const faqs = await faqService.listFaqsAdmin();
      return res.status(400).render('admin/faqs/list', {
        pageTitle: 'Manage FAQs | Admin',
        metaDescription: 'Admin FAQ management.',
        faqs,
        errors,
        values: req.body,
      });
    }

    await faqService.createFaq(values);
    req.flashSuccess('FAQ entry created successfully.');
    res.redirect('/admin/faqs');
  } catch (err) {
    next(err);
  }
}

async function updateFaq(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const { errors, values } = validateFaq(req.body);

    if (errors.length > 0) {
      req.flashError(errors.join(' '));
      return res.redirect('/admin/faqs');
    }

    await faqService.updateFaq(id, values);
    req.flashSuccess('FAQ entry updated successfully.');
    res.redirect('/admin/faqs');
  } catch (err) {
    if (err instanceof faqService.FaqError) {
      req.flashError(err.message);
      return res.redirect('/admin/faqs');
    }
    next(err);
  }
}

async function deleteFaq(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    await faqService.deleteFaq(id);
    req.flashSuccess('FAQ entry deleted.');
  } catch (err) {
    if (err instanceof faqService.FaqError) {
      req.flashError(err.message);
    } else {
      return next(err);
    }
  }
  res.redirect('/admin/faqs');
}

module.exports = { listFaqs, createFaq, updateFaq, deleteFaq };
