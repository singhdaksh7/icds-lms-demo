const { prisma } = require('../config/db');
const { getSettings } = require('../services/settings.service');
const { parseLegalText, formatLegalDate } = require('../lib/legalText');
const { validateNewsletter } = require('../validators/contact.validator');
const site = require('../config/site');
const { buildSeo, pageSeoText, PUBLIC_ROBOTS, DEFAULT_ROBOTS } = require('../lib/seo');
const emailService = require('../services/email.service');
const sitePages = require('../services/sitePages.service');
const contactEnquiries = require('../services/contactEnquiry.service');
const faqService = require('../services/faq.service');

function contactSeo(res) {
  return pageSeoText(res.locals.settings, 'contact', {
    title: `Contact | ${site.name}`,
    description: `Get in touch with ${site.name} — course enquiries and support.`,
  });
}

// The Contact page is CMS-driven end to end:
//   - on/off switch, eyebrow, heading/description overrides, hero image, closing CTA and SEO
//     come from the SitePage('contact') row (Admin > Pages > Contact);
//   - contact details (email, phone, WhatsApp, address, hours, map link) come from Site Content
//     > Brand & Global; every label, the form copy, reason options and FAQ-preview text come
//     from Site Content > Contact. Cards render only for values that exist.
// A disabled page is a normal 404 (GET and POST).
async function contactView(req, res, { errors = [], values = {}, sent = false } = {}) {
  const data = await sitePages.getPublicPage('contact', res.locals.cms);
  if (!data) return null;
  const cms = res.locals.cms;
  const cp = cms.contactPage;
  const base = contactSeo(res);
  const title = data.page.seoTitle || base.title;
  const description = data.page.metaDescription || base.description;

  const [courses, allFaqs] = await Promise.all([
    contactEnquiries.listPublishedCourses(),
    cp.faqEnabled ? faqService.listActiveFaqs().catch(() => []) : Promise.resolve([]),
  ]);
  const reasons = contactEnquiries.parseReasonOptions(cp.reasonOptions);
  // A submitted (re-rendered) form keeps its own choice; otherwise ?course=<slug> preselects a
  // PUBLISHED course. Drafts / unknown slugs are ignored.
  const selected = values.courseId
    ? courses.find((c) => c.id === values.courseId) || null
    : contactEnquiries.resolveCourseBySlug(courses, req.query && req.query.course);
  const cards = contactEnquiries.buildContactCards(cms, site, selected ? selected.title : '');
  const whatsappHref = contactEnquiries.whatsappLink(site.whatsappNumber, selected ? selected.title : '');

  return {
    pageTitle: title,
    metaDescription: description,
    title,
    description,
    sitePage: data.page,
    errors,
    values,
    sent,
    courses,
    reasons,
    selectedCourseId: selected ? selected.id : '',
    selectedCourseTitle: selected ? selected.title : '',
    cards,
    whatsappHref,
    faqs: (allFaqs || []).slice(0, 5),
  };
}

function renderContact(req, res, view, status = 200) {
  return res.status(status).render('public/contact', {
    ...view,
    seo: buildSeo(req, { title: view.title, description: view.description, robots: PUBLIC_ROBOTS }),
  });
}

async function contactPage(req, res, next) {
  try {
    // Inline success panel (read-once flash from the POST below); the header alert is suppressed
    // so the visitor sees one clear confirmation next to the form.
    const sent = Boolean(res.locals.flash && res.locals.flash.success);
    if (sent) res.locals.flash = { ...res.locals.flash, success: null };
    const view = await contactView(req, res, { sent });
    if (!view) return res.status(404).render('public/404', { pageTitle: 'Page Not Found' });
    renderContact(req, res, view);
  } catch (err) {
    next(err);
  }
}

async function postContact(req, res, next) {
  try {
    if (!(await sitePages.isPageEnabled('contact'))) return res.status(404).render('public/404', { pageTitle: 'Page Not Found' });

    const [courses] = await Promise.all([contactEnquiries.listPublishedCourses()]);
    const reasons = contactEnquiries.parseReasonOptions(res.locals.cms.contactPage.reasonOptions);
    const { errors, values, spam } = contactEnquiries.validateEnquiry(req.body, { reasons, courses });

    // Spam (honeypot filled, link floods, markup) is never stored and never claimed as sent.
    if (spam || errors.length) {
      const shown = spam ? ['We could not send your message. Please check what you entered and try again.'] : errors;
      const view = await contactView(req, res, { errors: shown, values });
      if (!view) return res.status(404).render('public/404', { pageTitle: 'Page Not Found' });
      return renderContact(req, res, view, 400);
    }

    let saved;
    try {
      saved = await contactEnquiries.createEnquiry(values);
    } catch (_err) {
      // Never fake success: if the enquiry could not be stored, say so.
      const view = await contactView(req, res, { errors: ['Sorry, we could not save your message right now. Please try again in a moment or use the contact details on this page.'], values });
      if (!view) return res.status(404).render('public/404', { pageTitle: 'Page Not Found' });
      return renderContact(req, res, view, 503);
    }

    req.flashSuccess(res.locals.cms.contactPage.successMessage);
    res.redirect('/contact#contact-form');
    // Fire-and-forget: the stored enquiry is the source of truth, so a failed or unconfigured
    // notification email must never affect the response already sent to the visitor.
    const course = courses.find((c) => c.id === saved.courseId);
    emailService.sendContactNotification({ ...values, courseTitle: course ? course.title : '' }).catch(() => {});
  } catch (err) {
    next(err);
  }
}

async function subscribe(req, res, next) {
  const { errors, values } = validateNewsletter(req.body);
  if (errors.length) {
    req.flashError(errors[0]);
    return res.redirect(req.get('referer') || '/');
  }
  try {
    await prisma.newsletterSubscriber.upsert({
      where: { email: values.email },
      update: {},
      create: { email: values.email },
    });
    req.flashSuccess(res.locals.cms.newsletter.successMessage);
    res.redirect(req.get('referer') || '/');
  } catch (e) {
    next(e);
  }
}

async function verifyCertificate(req, res, next) {
  try {
    const certificate = await prisma.certificate.findUnique({
      where: { certificateNumber: req.params.certificateNumber },
      select: { certificateNumber: true, issuedAt: true, status: true, user: { select: { name: true } }, course: { select: { title: true } } },
    });

    const title = certificate
      ? `Verify Certificate | ${site.name}`
      : `Certificate Not Found | ${site.name}`;
    const description = 'Verify the authenticity of an ICDS course completion certificate.';
    // Certificate numbers are unguessable but this still names a specific
    // student — keep these out of search results either way (see README
    // "SEO Configuration").
    const seo = buildSeo(req, { title, description, robots: DEFAULT_ROBOTS });

    if (!certificate) {
      return res.status(404).render('public/certificate-verify', {
        pageTitle: title,
        metaDescription: description,
        seo,
        certificate: null,
      });
    }

    res.render('public/certificate-verify', {
      pageTitle: title,
      metaDescription: description,
      seo,
      certificate,
    });
  } catch (e) {
    next(e);
  }
}

function legal(page, keyPrefix) {
  return async (req, res, next) => {
    try {
      const settings = await getSettings();
      const heading = settings[`${keyPrefix}.heading`] || page;
      const seoKey = keyPrefix === 'legal.privacy' ? 'privacy' : 'terms';
      const { title, description } = pageSeoText(settings, seoKey, {
        title: `${heading} | ${site.name}`,
        description: `${heading} for ${site.name}.`,
      });
      res.render('public/legal', {
        pageTitle: title,
        metaDescription: description,
        seo: buildSeo(req, { title, description, robots: PUBLIC_ROBOTS }),
        heading,
        blocks: parseLegalText(settings[`${keyPrefix}.body`]),
        updatedLabel: formatLegalDate(settings[`${keyPrefix}.updated`]),
      });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  contactPage,
  postContact,
  subscribe,
  verifyCertificate,
  privacy: legal('Privacy Policy', 'legal.privacy'),
  terms: legal('Terms & Conditions', 'legal.terms'),
};
