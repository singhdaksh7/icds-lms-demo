const courseLandingService = require('../../services/courseLanding.service');
const { prisma } = require('../../config/db');
const curriculumService = require('../../services/curriculum.service');

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
// Builds the service payload from the (multipart) review form. Checkbox pairs arrive as
// ["false","on"] / "false" and are parsed explicitly; uploaded media becomes safe references.
function testimonialPayload(req) {
  const { parseFormBool } = require('../../lib/formBool');
  const imageStorage = require('../../lib/imageStorage');
  const payload = { ...req.body };
  if (payload.formSubmitted) {
    payload.isPublished = parseFormBool(payload.isPublished, false);
    payload.isDemo = parseFormBool(payload.isDemo, false);
  }
  const files = req.files || {};
  if (files.video && files.video[0] && files.video[0].r2Key) payload.videoObjectKey = files.video[0].r2Key;
  if (files.thumbnail && files.thumbnail[0]) payload.videoThumbnailUrl = imageStorage.publicUrlFor(files.thumbnail[0].filename);
  return payload;
}

function adoptTestimonialMedia(req) {
  if (req.testimonialMediaAdopted) req.testimonialMediaAdopted = { video: true, thumbnail: true };
}

async function cleanupOrphans(row) {
  if (!row) return;
  const imageStorage = require('../../lib/imageStorage');
  if (row.orphanedVideoKey) await require('../../lib/testimonialVideo').deleteHostedVideo(row.orphanedVideoKey);
  if (row.orphanedThumbnailUrl) imageStorage.deleteIfOwned(row.orphanedThumbnailUrl);
}

async function createTestimonial(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    await courseLandingService.addTestimonial(courseId, testimonialPayload(req));
    adoptTestimonialMedia(req);
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
    const row = await courseLandingService.updateTestimonial(courseId, testimonialId, testimonialPayload(req));
    adoptTestimonialMedia(req);
    await cleanupOrphans(row);
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
    const row = await courseLandingService.deleteTestimonial(courseId, testimonialId);
    await cleanupOrphans(row);
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

// 9. Access Plans
async function createAccessPlan(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    await courseLandingService.addAccessPlan(courseId, req.body);
    req.flashSuccess('Course access plan added.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=access-plans`);
  } catch (err) {
    req.flashError(err.message || 'Failed to add access plan.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=access-plans`);
  }
}

async function updateAccessPlan(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const planId = parseInt(req.params.planId, 10);
    await courseLandingService.updateAccessPlan(courseId, planId, req.body);
    req.flashSuccess('Course access plan updated.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=access-plans`);
  } catch (err) {
    req.flashError(err.message || 'Failed to update access plan.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=access-plans`);
  }
}

async function deleteAccessPlan(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const planId = parseInt(req.params.planId, 10);
    await courseLandingService.deleteAccessPlan(courseId, planId);
    req.flashSuccess('Course access plan deleted.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=access-plans`);
  } catch (err) {
    req.flashError(err.message || 'Failed to delete access plan.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=access-plans`);
  }
}

async function moveAccessPlan(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const planId = parseInt(req.params.planId, 10);
    const direction = req.body.direction === 'down' ? 'down' : 'up';
    await courseLandingService.moveAccessPlan(courseId, planId, direction);
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=access-plans`);
  } catch (err) {
    req.flashError(err.message || 'Failed to reorder access plan.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=access-plans`);
  }
}

// 10. Course Stats
async function createStat(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    await courseLandingService.addCourseStat(courseId, req.body);
    req.flashSuccess('Quick stat added.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=stats`);
  } catch (err) {
    req.flashError(err.message || 'Failed to add quick stat.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=stats`);
  }
}

async function updateStat(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const statId = parseInt(req.params.statId, 10);
    await courseLandingService.updateCourseStat(courseId, statId, req.body);
    req.flashSuccess('Quick stat updated.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=stats`);
  } catch (err) {
    req.flashError(err.message || 'Failed to update quick stat.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=stats`);
  }
}

async function deleteStat(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const statId = parseInt(req.params.statId, 10);
    await courseLandingService.deleteCourseStat(courseId, statId);
    req.flashSuccess('Quick stat deleted.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=stats`);
  } catch (err) {
    req.flashError(err.message || 'Failed to delete quick stat.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=stats`);
  }
}

async function moveStat(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const statId = parseInt(req.params.statId, 10);
    const direction = req.body.direction === 'down' ? 'down' : 'up';
    await courseLandingService.moveCourseStat(courseId, statId, direction);
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=stats`);
  } catch (err) {
    req.flashError(err.message || 'Failed to reorder quick stat.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=stats`);
  }
}

// 11. Comparison Columns & Items
async function createComparisonColumn(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    await courseLandingService.addComparisonColumn(courseId, req.body);
    req.flashSuccess('Comparison column added.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=comparison`);
  } catch (err) {
    req.flashError(err.message || 'Failed to add comparison column.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=comparison`);
  }
}

async function updateComparisonColumn(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const columnId = parseInt(req.params.columnId, 10);
    await courseLandingService.updateComparisonColumn(courseId, columnId, req.body);
    req.flashSuccess('Comparison column updated.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=comparison`);
  } catch (err) {
    req.flashError(err.message || 'Failed to update comparison column.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=comparison`);
  }
}

async function deleteComparisonColumn(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const columnId = parseInt(req.params.columnId, 10);
    await courseLandingService.deleteComparisonColumn(courseId, columnId);
    req.flashSuccess('Comparison column deleted.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=comparison`);
  } catch (err) {
    req.flashError(err.message || 'Failed to delete comparison column.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=comparison`);
  }
}

async function moveComparisonColumn(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const columnId = parseInt(req.params.columnId, 10);
    const direction = req.body.direction === 'down' ? 'down' : 'up';
    await courseLandingService.moveComparisonColumn(courseId, columnId, direction);
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=comparison`);
  } catch (err) {
    req.flashError(err.message || 'Failed to reorder comparison column.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=comparison`);
  }
}

// Comparison item routes only carry the item id; resolve its column so the
// service can verify course ownership (item -> column -> course).
async function comparisonItemColumnId(itemId) {
  const item = await prisma.courseComparisonItem.findUnique({ where: { id: itemId }, select: { columnId: true } });
  if (!item) throw new courseLandingService.CourseLandingError('Comparison item not found', 404);
  return item.columnId;
}

async function createComparisonItem(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const columnId = parseInt(req.params.columnId, 10);
    await courseLandingService.addComparisonItem(courseId, columnId, req.body);
    req.flashSuccess('Comparison item added.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=comparison`);
  } catch (err) {
    req.flashError(err.message || 'Failed to add comparison item.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=comparison`);
  }
}

async function updateComparisonItem(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    await courseLandingService.updateComparisonItem(courseId, await comparisonItemColumnId(itemId), itemId, req.body);
    req.flashSuccess('Comparison item updated.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=comparison`);
  } catch (err) {
    req.flashError(err.message || 'Failed to update comparison item.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=comparison`);
  }
}

async function deleteComparisonItem(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    await courseLandingService.deleteComparisonItem(courseId, await comparisonItemColumnId(itemId), itemId);
    req.flashSuccess('Comparison item deleted.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=comparison`);
  } catch (err) {
    req.flashError(err.message || 'Failed to delete comparison item.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=comparison`);
  }
}

async function moveComparisonItem(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const itemId = parseInt(req.params.itemId, 10);
    const direction = req.body.direction === 'down' ? 'down' : 'up';
    await courseLandingService.moveComparisonItem(courseId, await comparisonItemColumnId(itemId), itemId, direction);
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=comparison`);
  } catch (err) {
    req.flashError(err.message || 'Failed to reorder comparison item.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=comparison`);
  }
}

// 12. Access Steps
async function createAccessStep(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    await courseLandingService.addAccessStep(courseId, req.body);
    req.flashSuccess('Access step added.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=access-steps`);
  } catch (err) {
    req.flashError(err.message || 'Failed to add access step.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=access-steps`);
  }
}

async function updateAccessStep(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const stepId = parseInt(req.params.stepId, 10);
    await courseLandingService.updateAccessStep(courseId, stepId, req.body);
    req.flashSuccess('Access step updated.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=access-steps`);
  } catch (err) {
    req.flashError(err.message || 'Failed to update access step.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=access-steps`);
  }
}

async function deleteAccessStep(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const stepId = parseInt(req.params.stepId, 10);
    await courseLandingService.deleteAccessStep(courseId, stepId);
    req.flashSuccess('Access step deleted.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=access-steps`);
  } catch (err) {
    req.flashError(err.message || 'Failed to delete access step.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=access-steps`);
  }
}

async function moveAccessStep(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const stepId = parseInt(req.params.stepId, 10);
    const direction = req.body.direction === 'down' ? 'down' : 'up';
    await courseLandingService.moveAccessStep(courseId, stepId, direction);
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=access-steps`);
  } catch (err) {
    req.flashError(err.message || 'Failed to reorder access step.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=access-steps`);
  }
}

// 13. Dynamic Section Order & Toggle
// The route param is the section KEY (HERO, FAQ, ...), never a row id: a course with no saved
// section rows would otherwise be shown made-up ids.
function sectionKeyFrom(req) {
  const key = String(req.params.sectionId || '').toUpperCase();
  if (!courseLandingService.DEFAULT_SECTION_ORDER.includes(key)) throw new courseLandingService.CourseLandingError('Unknown section.', 404);
  return key;
}

async function toggleSection(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const key = sectionKeyFrom(req);
    const sections = await courseLandingService.ensureCourseLandingSections(courseId);
    const current = sections.find((s) => s.sectionKey === key);
    await courseLandingService.toggleCourseSection(courseId, key, !(current && current.isEnabled));
    req.flashSuccess('Section visibility toggled.');
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=section-order`);
  } catch (err) {
    req.flashError(err.message || 'Failed to toggle section.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=section-order`);
  }
}

async function moveSection(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const key = sectionKeyFrom(req);
    const direction = req.body.direction === 'down' ? 'down' : 'up';
    await courseLandingService.moveCourseSection(courseId, key, direction);
    res.redirect(`/admin/courses/${courseId}/landing-page?tab=section-order`);
  } catch (err) {
    req.flashError(err.message || 'Failed to reorder section.');
    res.redirect(`/admin/courses/${req.params.courseId}/landing-page?tab=section-order`);
  }
}

// 14. Admin Preview
async function previewLanding(req, res, next) {
  try {
    const courseId = parseInt(req.params.courseId, 10);
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        instructor: {
          include: {
            credentials: { orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    });

    if (!course) {
      req.flashError('Course not found.');
      return res.redirect('/admin/courses');
    }

    // Admin preview shows everything an Admin can see: unpublished curriculum/resources and demo reviews.
    const [curriculum, stats, resources] = await Promise.all([
      curriculumService.getCourseCurriculum(course.id, { publishedOnly: false }),
      curriculumService.getPublicCourseStats(course.id),
      curriculumService.listResourcesForCourse(course.id, { publishedOnly: false }),
    ]);
    const landing = await courseLandingService.getPublicLandingData(course.id, stats, { includeDemo: true });

    const price = Number(course.price) || 0;
    const isFree = price === 0;

    res.render('public/course-detail', {
      pageTitle: `[Preview] ${landing?.content?.heroTitleOverride || course.title}`,
      metaDescription: course.shortDescription || course.description || '',
      seo: {
        title: `[Preview] ${course.title}`,
        description: course.shortDescription || course.description || '',
        robots: 'noindex, nofollow',
        canonical: '',
        ogType: 'website',
        ogImage: course.thumbnailUrl || '',
        jsonLd: null,
      },
      course,
      lessonCount: stats.lessonCount,
      curriculum,
      stats,
      resources,
      faqs: (landing && landing.faqs) ? landing.faqs : [],
      landing,
      isEnrolled: false,
      hasPendingRequest: false,
      isFree,
      paymentsEnabled: true,
      priceLabel: isFree ? 'Free' : `₹${price.toLocaleString('en-IN')}`,
      gstNote: 'Incl. applicable taxes',
      isPreview: true,
      isPreviewMode: true,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getLandingEditor,
  saveSettings,
  previewLanding,

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

  createAccessPlan,
  updateAccessPlan,
  deleteAccessPlan,
  moveAccessPlan,

  createStat,
  updateStat,
  deleteStat,
  moveStat,

  createComparisonColumn,
  updateComparisonColumn,
  deleteComparisonColumn,
  moveComparisonColumn,
  createComparisonItem,
  updateComparisonItem,
  deleteComparisonItem,
  moveComparisonItem,

  createAccessStep,
  updateAccessStep,
  deleteAccessStep,
  moveAccessStep,

  toggleSection,
  moveSection,
};
