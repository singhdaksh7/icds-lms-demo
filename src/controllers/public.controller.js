const { prisma } = require('../config/db');
const { getSettings } = require('../services/settings.service');
const { parseLegalText, formatLegalDate } = require('../lib/legalText');
const { validateContact, validateNewsletter } = require('../validators/contact.validator');
const site = require('../config/site');
const { buildSeo, pageSeoText, PUBLIC_ROBOTS, DEFAULT_ROBOTS } = require('../lib/seo');
const emailService = require('../services/email.service');

function contactSeo(res) {
  return pageSeoText(res.locals.settings, 'contact', {
    title: `Contact | ${site.name}`,
    description: `Get in touch with ${site.name} — course enquiries and support.`,
  });
}

async function contactPage(req, res) {
  const { title, description } = contactSeo(res);
  res.render('public/contact', {
    pageTitle: title,
    metaDescription: description,
    seo: buildSeo(req, { title, description, robots: PUBLIC_ROBOTS }),
    errors: [],
    values: {},
  });
}

async function postContact(req, res, next) {
  const { errors, values } = validateContact(req.body);
  if (errors.length) {
    const { title, description } = contactSeo(res);
    return res.status(400).render('public/contact', {
      pageTitle: title,
      metaDescription: description,
      seo: buildSeo(req, { title, description, robots: PUBLIC_ROBOTS }),
      errors,
      values,
    });
  }
  try {
    await prisma.contactMessage.create({ data: values });
    req.flashSuccess(res.locals.cms.contactPage.successMessage);
    res.redirect('/contact');
    // Fire-and-forget: DB persistence above is the source of truth, so a
    // failed/unconfigured notification email must never affect the
    // response already sent to the visitor.
    emailService.sendContactNotification(values).catch(() => {});
  } catch (e) {
    next(e);
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
