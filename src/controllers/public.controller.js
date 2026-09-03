const { prisma } = require('../config/db');
const { validateContact, validateNewsletter } = require('../validators/contact.validator');
const site = require('../config/site');
const { buildSeo, PUBLIC_ROBOTS, DEFAULT_ROBOTS } = require('../lib/seo');
const emailService = require('../services/email.service');

async function contactPage(req, res) {
  const title = `Contact | ${site.name}`;
  const description = `Get in touch with ${site.name} — course enquiries and support.`;
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
    const title = `Contact | ${site.name}`;
    const description = `Get in touch with ${site.name} — course enquiries and support.`;
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
    req.flashSuccess('Your message has been received.');
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
    req.flashSuccess('You are subscribed.');
    res.redirect(req.get('referer') || '/');
  } catch (e) {
    next(e);
  }
}

async function verifyCertificate(req, res, next) {
  try {
    const certificate = await prisma.certificate.findUnique({
      where: { certificateNumber: req.params.certificateNumber },
      include: { user: { select: { name: true } }, course: { select: { title: true } } },
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

function legal(page) {
  return (req, res) => {
    const title = `${page} | ${site.name}`;
    const description = `${page} for ${site.name}.`;
    res.render('public/legal', {
      pageTitle: title,
      metaDescription: description,
      seo: buildSeo(req, { title, description, robots: PUBLIC_ROBOTS }),
      heading: page,
    });
  };
}

module.exports = {
  contactPage,
  postContact,
  subscribe,
  verifyCertificate,
  privacy: legal('Privacy Policy'),
  terms: legal('Terms & Conditions'),
};
