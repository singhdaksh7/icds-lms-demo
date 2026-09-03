// Centralized email service — the only module that should call
// src/lib/mailer.js directly. Owns: which template to use, building
// absolute URLs from APP_BASE_URL, and defending against header injection
// from user-controlled values before they ever reach a `subject`/`to`
// field. Controllers/services call these named functions instead of
// building messages themselves.
const mailer = require('../lib/mailer');
const templates = require('../lib/emailTemplates');
const { absoluteUrl } = require('../lib/seo');

// Strips CR/LF from any value that ends up in a raw SMTP header (subject,
// to, replyTo) — belt-and-suspenders on top of Nodemailer's own header
// sanitization and the contact-form validator's length/shape checks.
function sanitizeHeaderValue(value) {
  return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
}

async function sendPasswordResetEmail(toEmail, resetUrl) {
  const { subject, html, text } = templates.passwordReset({ resetUrl });
  return mailer.sendMail({ to: sanitizeHeaderValue(toEmail), subject: sanitizeHeaderValue(subject), html, text });
}

async function sendEnrollmentApprovedEmail(req, { toEmail, studentName, courseTitle }) {
  const myCoursesUrl = absoluteUrl(req, '/student/dashboard');
  const { subject, html, text } = templates.enrollmentApproved({ studentName, courseTitle, myCoursesUrl });
  return mailer.sendMail({ to: sanitizeHeaderValue(toEmail), subject: sanitizeHeaderValue(subject), html, text });
}

async function sendCertificateIssuedEmail(req, { toEmail, studentName, courseTitle }) {
  const certificatesUrl = absoluteUrl(req, '/student/certificates');
  const { subject, html, text } = templates.certificateIssued({ studentName, courseTitle, certificatesUrl });
  return mailer.sendMail({ to: sanitizeHeaderValue(toEmail), subject: sanitizeHeaderValue(subject), html, text });
}

// `values` is already server-validated (contact.validator.js): trimmed,
// length-capped, email shape-checked. Still sanitized again here — this
// function is the last line of defense before the value reaches an SMTP
// header.
async function sendContactNotification(values) {
  const site = require('../config/site');
  if (!site.contactEmail) return { sent: false, configured: mailer.isConfigured() };

  const { subject, html, text } = templates.contactNotification(values);
  return mailer.sendMail({
    to: site.contactEmail,
    subject: sanitizeHeaderValue(subject),
    html,
    text,
    replyTo: sanitizeHeaderValue(values.email),
  });
}

module.exports = {
  sendPasswordResetEmail,
  sendEnrollmentApprovedEmail,
  sendCertificateIssuedEmail,
  sendContactNotification,
  isConfigured: mailer.isConfigured,
};
