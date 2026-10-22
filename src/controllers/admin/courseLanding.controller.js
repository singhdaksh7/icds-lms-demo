const courseLandingService = require('../../services/courseLanding.service');

async function getLandingEditor(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const data = await courseLandingService.getAdminLandingData(courseId);

    res.render('admin/courses/landing-page', {
      pageTitle: `Landing Page: ${data.course.title} | Admin`,
      metaDescription: `Manage dynamic marketing and landing content for ${data.course.title}`,
      activeNav: 'courses',
      ...data,
      activeTab: req.query.tab || 'hero',
    });
  } catch (err) {
    if (err.statusCode === 404) {
      req.flashError('Course not found.');
      return res.redirect('/admin/courses');
    }
    next(err);
  }
}

async function saveSettings(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    await courseLandingService.upsertLandingSettings(courseId, req.body);
    req.flashSuccess('Landing page settings updated successfully.');
    const tab = req.body.currentTab ? `?tab=${encodeURIComponent(req.body.currentTab)}` : '';
    res.redirect(`/admin/courses/${courseId}/landing-page${tab}`);
  } catch (err) {
    req.flashError(err.message || 'Failed to update landing page settings.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page`);
  }
}

// 1. Hero Chips
async function createChip(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    await courseLandingService.addHeroChip(courseId, req.body);
    req.flashSuccess('Highlight chip added.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=hero`);
  } catch (err) {
    req.flashError(err.message || 'Failed to add highlight chip.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=hero`);
  }
}

async function updateChip(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const chipId = parseInt(req.params.chipId, 10);
    await courseLandingService.updateHeroChip(courseId, chipId, req.body);
    req.flashSuccess('Highlight chip updated.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=hero`);
  } catch (err) {
    req.flashError(err.message || 'Failed to update highlight chip.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=hero`);
  }
}

async function deleteChip(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const chipId = parseInt(req.params.chipId, 10);
    await courseLandingService.deleteHeroChip(courseId, chipId);
    req.flashSuccess('Highlight chip deleted.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=hero`);
  } catch (err) {
    req.flashError(err.message || 'Failed to delete highlight chip.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=hero`);
  }
}

async function moveChip(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const chipId = parseInt(req.params.chipId, 10);
    const direction = req.body.direction === 'down' ? 'down' : 'up';
    await courseLandingService.moveHeroChip(courseId, chipId, direction);
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=hero`);
  } catch (err) {
    req.flashError(err.message || 'Failed to reorder chip.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=hero`);
  }
}

// 2. Takeaways
async function createTakeaway(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    await courseLandingService.addTakeaway(courseId, req.body);
    req.flashSuccess('Takeaway card added.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=takeaways`);
  } catch (err) {
    req.flashError(err.message || 'Failed to add takeaway card.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=takeaways`);
  }
}

async function updateTakeaway(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const takeawayId = parseInt(req.params.takeawayId, 10);
    await courseLandingService.updateTakeaway(courseId, takeawayId, req.body);
    req.flashSuccess('Takeaway card updated.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=takeaways`);
  } catch (err) {
    req.flashError(err.message || 'Failed to update takeaway card.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=takeaways`);
  }
}

async function deleteTakeaway(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const takeawayId = parseInt(req.params.takeawayId, 10);
    await courseLandingService.deleteTakeaway(courseId, takeawayId);
    req.flashSuccess('Takeaway card deleted.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=takeaways`);
  } catch (err) {
    req.flashError(err.message || 'Failed to delete takeaway card.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=takeaways`);
  }
}

async function moveTakeaway(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const takeawayId = parseInt(req.params.takeawayId, 10);
    const direction = req.body.direction === 'down' ? 'down' : 'up';
    await courseLandingService.moveTakeaway(courseId, takeawayId, direction);
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=takeaways`);
  } catch (err) {
    req.flashError(err.message || 'Failed to reorder takeaway.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=takeaways`);
  }
}

// 3. Questions
async function createQuestion(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    await courseLandingService.addQuestion(courseId, req.body);
    req.flashSuccess('Question card added.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=questions`);
  } catch (err) {
    req.flashError(err.message || 'Failed to add question card.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=questions`);
  }
}

async function updateQuestion(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const questionId = parseInt(req.params.questionId, 10);
    await courseLandingService.updateQuestion(courseId, questionId, req.body);
    req.flashSuccess('Question card updated.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=questions`);
  } catch (err) {
    req.flashError(err.message || 'Failed to update question card.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=questions`);
  }
}

async function deleteQuestion(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const questionId = parseInt(req.params.questionId, 10);
    await courseLandingService.deleteQuestion(courseId, questionId);
    req.flashSuccess('Question card deleted.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=questions`);
  } catch (err) {
    req.flashError(err.message || 'Failed to delete question card.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=questions`);
  }
}

async function moveQuestion(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const questionId = parseInt(req.params.questionId, 10);
    const direction = req.body.direction === 'down' ? 'down' : 'up';
    await courseLandingService.moveQuestion(courseId, questionId, direction);
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=questions`);
  } catch (err) {
    req.flashError(err.message || 'Failed to reorder question.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=questions`);
  }
}

// 4. Audience Items
async function createAudienceItem(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    await courseLandingService.addAudienceItem(courseId, req.body);
    req.flashSuccess('Audience item added.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=audience`);
  } catch (err) {
    req.flashError(err.message || 'Failed to add audience item.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=audience`);
  }
}

async function updateAudienceItem(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    await courseLandingService.updateAudienceItem(courseId, itemId, req.body);
    req.flashSuccess('Audience item updated.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=audience`);
  } catch (err) {
    req.flashError(err.message || 'Failed to update audience item.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=audience`);
  }
}

async function deleteAudienceItem(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    await courseLandingService.deleteAudienceItem(courseId, itemId);
    req.flashSuccess('Audience item deleted.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=audience`);
  } catch (err) {
    req.flashError(err.message || 'Failed to delete audience item.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=audience`);
  }
}

async function moveAudienceItem(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    const direction = req.body.direction === 'down' ? 'down' : 'up';
    await courseLandingService.moveAudienceItem(courseId, itemId, direction);
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=audience`);
  } catch (err) {
    req.flashError(err.message || 'Failed to reorder audience item.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=audience`);
  }
}

// 5. Course FAQs
async function createFaq(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    await courseLandingService.addCourseFaq(courseId, req.body);
    req.flashSuccess('Course FAQ added.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=faq`);
  } catch (err) {
    req.flashError(err.message || 'Failed to add FAQ.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=faq`);
  }
}

async function updateFaq(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const faqId = parseInt(req.params.faqId, 10);
    await courseLandingService.updateCourseFaq(courseId, faqId, req.body);
    req.flashSuccess('Course FAQ updated.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=faq`);
  } catch (err) {
    req.flashError(err.message || 'Failed to update FAQ.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=faq`);
  }
}

async function deleteFaq(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const faqId = parseInt(req.params.faqId, 10);
    await courseLandingService.deleteCourseFaq(courseId, faqId);
    req.flashSuccess('Course FAQ deleted.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=faq`);
  } catch (err) {
    req.flashError(err.message || 'Failed to delete FAQ.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=faq`);
  }
}

async function moveFaq(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const faqId = parseInt(req.params.faqId, 10);
    const direction = req.body.direction === 'down' ? 'down' : 'up';
    await courseLandingService.moveCourseFaq(courseId, faqId, direction);
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=faq`);
  } catch (err) {
    req.flashError(err.message || 'Failed to reorder FAQ.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=faq`);
  }
}

// 6. Why Register Items
async function createWhyRegisterItem(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    await courseLandingService.addWhyRegisterItem(courseId, req.body);
    req.flashSuccess('Why Register item added.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=why-register`);
  } catch (err) {
    req.flashError(err.message || 'Failed to add Why Register item.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=why-register`);
  }
}

async function updateWhyRegisterItem(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    await courseLandingService.updateWhyRegisterItem(courseId, itemId, req.body);
    req.flashSuccess('Why Register item updated.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=why-register`);
  } catch (err) {
    req.flashError(err.message || 'Failed to update Why Register item.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=why-register`);
  }
}

async function deleteWhyRegisterItem(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    await courseLandingService.deleteWhyRegisterItem(courseId, itemId);
    req.flashSuccess('Why Register item deleted.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=why-register`);
  } catch (err) {
    req.flashError(err.message || 'Failed to delete Why Register item.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=why-register`);
  }
}

async function moveWhyRegisterItem(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    const direction = req.body.direction === 'down' ? 'down' : 'up';
    await courseLandingService.moveWhyRegisterItem(courseId, itemId, direction);
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=why-register`);
  } catch (err) {
    req.flashError(err.message || 'Failed to reorder item.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=why-register`);
  }
}

// 7. Highlights
async function createHighlight(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    await courseLandingService.addHighlight(courseId, req.body);
    req.flashSuccess('Course highlight added.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=highlights`);
  } catch (err) {
    req.flashError(err.message || 'Failed to add highlight.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=highlights`);
  }
}

async function updateHighlight(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const highlightId = parseInt(req.params.highlightId, 10);
    await courseLandingService.updateHighlight(courseId, highlightId, req.body);
    req.flashSuccess('Course highlight updated.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=highlights`);
  } catch (err) {
    req.flashError(err.message || 'Failed to update highlight.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=highlights`);
  }
}

async function deleteHighlight(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const highlightId = parseInt(req.params.highlightId, 10);
    await courseLandingService.deleteHighlight(courseId, highlightId);
    req.flashSuccess('Course highlight deleted.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=highlights`);
  } catch (err) {
    req.flashError(err.message || 'Failed to delete highlight.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=highlights`);
  }
}

async function moveHighlight(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const highlightId = parseInt(req.params.highlightId, 10);
    const direction = req.body.direction === 'down' ? 'down' : 'up';
    await courseLandingService.moveHighlight(courseId, highlightId, direction);
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=highlights`);
  } catch (err) {
    req.flashError(err.message || 'Failed to reorder highlight.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=highlights`);
  }
}

// 8. Testimonials / Reviews
async function createTestimonial(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    await courseLandingService.addTestimonial(courseId, req.body);
    req.flashSuccess('Review / Testimonial added.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=reviews`);
  } catch (err) {
    req.flashError(err.message || 'Failed to add testimonial.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=reviews`);
  }
}

async function updateTestimonial(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const testimonialId = parseInt(req.params.testimonialId, 10);
    await courseLandingService.updateTestimonial(courseId, testimonialId, req.body);
    req.flashSuccess('Review / Testimonial updated.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=reviews`);
  } catch (err) {
    req.flashError(err.message || 'Failed to update testimonial.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=reviews`);
  }
}

async function deleteTestimonial(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const testimonialId = parseInt(req.params.testimonialId, 10);
    await courseLandingService.deleteTestimonial(courseId, testimonialId);
    req.flashSuccess('Review / Testimonial deleted.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=reviews`);
  } catch (err) {
    req.flashError(err.message || 'Failed to delete testimonial.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=reviews`);
  }
}

async function moveTestimonial(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const testimonialId = parseInt(req.params.testimonialId, 10);
    const direction = req.body.direction === 'down' ? 'down' : 'up';
    await courseLandingService.moveTestimonial(courseId, testimonialId, direction);
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=reviews`);
  } catch (err) {
    req.flashError(err.message || 'Failed to reorder testimonial.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=reviews`);
  }
}

module.exports = {
  getLandingEditor,
  saveSettings,

  createChip,
  updateChip,
  deleteChip,
  moveChip,

  createTakeaway,
  updateTakeaway,
  deleteTakeaway,
  moveTakeaway,

  createQuestion,
  updateQuestion,
  deleteQuestion,
  moveQuestion,

  createAudienceItem,
  updateAudienceItem,
  deleteAudienceItem,
  moveAudienceItem,

  createFaq,
  updateFaq,
  deleteFaq,
  moveFaq,

  createWhyRegisterItem,
  updateWhyRegisterItem,
  deleteWhyRegisterItem,
  moveWhyRegisterItem,

  createHighlight,
  updateHighlight,
  deleteHighlight,
  moveHighlight,

  createTestimonial,
  updateTestimonial,
  deleteTestimonial,
  moveTestimonial,
};
