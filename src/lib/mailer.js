// Low-level SMTP transport. Provider-agnostic (Hostinger email, Google
// Workspace, Zoho, Brevo, SendGrid SMTP, Amazon SES SMTP, ...) — everything
// provider-specific lives in env vars, never hardcoded here.
//
// Callers should go through src/services/email.service.js rather than this
// module directly — it owns templates, escaping, and the "SMTP not
// configured" fallback behavior. This file only knows how to hand a
// message to a transport.
const nodemailer = require('nodemailer');
const {
  IS_PRODUCTION,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASSWORD,
  SMTP_FROM_EMAIL,
  SMTP_FROM_NAME,
  SMTP_CONFIGURED,
} = require('../config/env');

let cachedTransport = null;

// In development/test without real SMTP credentials, use Nodemailer's
// built-in jsonTransport: it never opens a network connection or sends
// anything anywhere — it just returns the fully-composed message so callers
// (and tests) can inspect subject/html/text/to. This is what lets the whole
// email path be exercised locally without real credentials — see README
// "SMTP Local Testing".
function buildTransport() {
  if (SMTP_CONFIGURED) {
    return nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER && SMTP_PASSWORD ? { user: SMTP_USER, pass: SMTP_PASSWORD } : undefined,
    });
  }
  return nodemailer.createTransport({ jsonTransport: true });
}

function getTransport() {
  if (!cachedTransport) {
    cachedTransport = buildTransport();
  }
  return cachedTransport;
}

const fromAddress = SMTP_FROM_EMAIL
  ? SMTP_FROM_NAME
    ? `"${SMTP_FROM_NAME.replace(/["\r\n]/g, '')}" <${SMTP_FROM_EMAIL}>`
    : SMTP_FROM_EMAIL
  : 'no-reply@localhost';

// Sends one message. Never throws to a caller that isn't prepared for it —
// email is always a notification, never something that should roll back a
// DB write — but DOES return the result (or a clear error) so callers that
// want to log/inspect it can. Never logs SMTP credentials; in production,
// never logs message bodies (which may contain reset tokens or student PII).
async function sendMail({ to, subject, html, text, replyTo }) {
  const transport = getTransport();

  try {
    const info = await transport.sendMail({
      from: fromAddress,
      to,
      subject,
      html,
      text,
      ...(replyTo ? { replyTo } : {}),
    });

    if (!SMTP_CONFIGURED) {
      // jsonTransport — nothing was actually sent. Useful in local dev to
      // see that the flow ran; safe to log because no real SMTP secrets or
      // production user data path is involved here (dev-only branch).
      if (!IS_PRODUCTION) {
        console.log(`[email:dev] would send "${subject}" to ${to} (SMTP not configured — no email actually sent)`);
      }
      return { sent: false, configured: false, info };
    }

    return { sent: true, configured: true, info };
  } catch (err) {
    // Sanitized: message only, never the raw error object (which can embed
    // connection strings/auth details depending on the SMTP library).
    console.error(`[email] send failed (to=${to.replace(/(?<=.).(?=[^@]*@)/g, '*')}): ${err.message}`);
    return { sent: false, configured: SMTP_CONFIGURED, error: err.message };
  }
}

module.exports = { sendMail, isConfigured: () => SMTP_CONFIGURED };
