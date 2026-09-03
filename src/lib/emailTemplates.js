// Lightweight HTML + plain-text email templates. No template engine
// dependency — these are small enough that plain string-building is
// clearer than adding a rendering layer for it.
const site = require('../config/site');

// Every user-controlled value (name, course title, message body, ...) MUST
// go through this before landing in an HTML template — these values come
// from signup forms, contact forms, and admin-entered course titles, none
// of which are trusted input.
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Wraps body HTML in a minimal, consistent shell. Deliberately plain
// (table-free, no external images/fonts) — this is a transactional
// notification email, not a marketing template, and needs to render
// reliably across clients without a design pass.
function shell(bodyHtml) {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f7f7fc;font-family:Arial,Helvetica,sans-serif;color:#15162b;">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
    <div style="font-size:18px;font-weight:700;color:#565acf;margin-bottom:24px;">${escapeHtml(site.name)}</div>
    <div style="background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e8e8f2;">
      ${bodyHtml}
    </div>
    <div style="margin-top:20px;font-size:12px;color:#8c8da0;">
      This is an automated message from ${escapeHtml(site.name)}.
      ${site.contactEmail ? `Questions? Contact us at ${escapeHtml(site.contactEmail)}.` : ''}
    </div>
  </div>
</body>
</html>`;
}

function button(label, url) {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;background:#565acf;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px;margin-top:16px;">${escapeHtml(label)}</a>`;
}

function passwordReset({ resetUrl }) {
  const html = shell(`
    <h1 style="font-size:20px;margin:0 0 12px;">Reset your password</h1>
    <p style="font-size:14px;line-height:1.6;color:#57596c;">
      We received a request to reset the password for your ${escapeHtml(site.name)} account.
      If you didn't request this, you can safely ignore this email.
    </p>
    ${button('Reset Password', resetUrl)}
    <p style="font-size:12px;color:#8c8da0;margin-top:20px;">
      This link expires soon for your security. If the button doesn't work, copy and paste this URL:<br>
      <span style="word-break:break-all;">${escapeHtml(resetUrl)}</span>
    </p>
  `);
  const text = `Reset your ${site.name} password: ${resetUrl}\n\nIf you didn't request this, you can ignore this email.`;
  return { subject: `Reset your ${site.name} password`, html, text };
}

function enrollmentApproved({ studentName, courseTitle, myCoursesUrl }) {
  const html = shell(`
    <h1 style="font-size:20px;margin:0 0 12px;">You're enrolled!</h1>
    <p style="font-size:14px;line-height:1.6;color:#57596c;">
      Hi ${escapeHtml(studentName)}, your enrollment in <strong>${escapeHtml(courseTitle)}</strong> is confirmed.
      You can start learning right away.
    </p>
    ${button('Go to My Courses', myCoursesUrl)}
  `);
  const text = `Hi ${studentName}, your enrollment in ${courseTitle} is confirmed. Start learning: ${myCoursesUrl}`;
  return { subject: `Enrolled: ${courseTitle}`, html, text };
}

function certificateIssued({ studentName, courseTitle, certificatesUrl }) {
  const html = shell(`
    <h1 style="font-size:20px;margin:0 0 12px;">Your certificate is ready</h1>
    <p style="font-size:14px;line-height:1.6;color:#57596c;">
      Congratulations ${escapeHtml(studentName)}! You've completed <strong>${escapeHtml(courseTitle)}</strong>
      and your certificate is now available to download.
    </p>
    ${button('View My Certificates', certificatesUrl)}
  `);
  const text = `Congratulations ${studentName}! Your certificate for ${courseTitle} is ready: ${certificatesUrl}`;
  return { subject: `Certificate ready: ${courseTitle}`, html, text };
}

function contactNotification({ name, email, subject, message }) {
  const html = shell(`
    <h1 style="font-size:20px;margin:0 0 12px;">New contact message</h1>
    <p style="font-size:14px;color:#57596c;margin:0 0 4px;"><strong>From:</strong> ${escapeHtml(name)} (${escapeHtml(email)})</p>
    <p style="font-size:14px;color:#57596c;margin:0 0 12px;"><strong>Subject:</strong> ${escapeHtml(subject)}</p>
    <p style="font-size:14px;line-height:1.6;color:#15162b;white-space:pre-line;border-top:1px solid #e8e8f2;padding-top:12px;">${escapeHtml(message)}</p>
  `);
  const text = `New contact message\nFrom: ${name} (${email})\nSubject: ${subject}\n\n${message}`;
  return { subject: `New contact message: ${subject}`, html, text };
}

module.exports = { escapeHtml, passwordReset, enrollmentApproved, certificateIssued, contactNotification };
