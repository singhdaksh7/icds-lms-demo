// Low-level SMTP transport. Provider-agnostic (Gmail/Google Workspace with an
// App Password, Workspace SMTP relay, Hostinger email, Zoho, Brevo, SendGrid
// SMTP, Amazon SES SMTP, ...). Configuration comes from the admin-saved SMTP
// settings, falling back to SMTP_* environment variables — see
// src/services/smtpSettings.service.js.
//
// Callers should go through src/services/email.service.js rather than this
// module directly — it owns templates, escaping, and header sanitising.
//
// TLS: certificate verification is always on (never rejectUnauthorized:false).
// Port 465 / "secure" uses implicit TLS; otherwise STARTTLS is REQUIRED
// (requireTLS) so credentials are never sent over a downgraded plaintext
// connection.
const nodemailer = require('nodemailer');
const { IS_PRODUCTION } = require('../config/env');
const smtpSettings = require('../services/smtpSettings.service');

let cached = null; // { fingerprint, transport }

function buildTransport(cfg) {
  if (cfg.source === 'none') {
    // jsonTransport never opens a network connection; it just composes the
    // message so callers/tests can inspect it.
    return nodemailer.createTransport({ jsonTransport: true });
  }
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: !cfg.secure,
    auth: cfg.user && cfg.password ? { user: cfg.user, pass: cfg.password } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}

function fingerprint(cfg) {
  return JSON.stringify([cfg.source, cfg.host, cfg.port, cfg.secure, cfg.user, cfg.password, cfg.fromEmail, cfg.fromName]);
}

async function resolve() {
  const cfg = await smtpSettings.getEffectiveConfig();
  const fp = fingerprint(cfg);
  if (!cached || cached.fingerprint !== fp) {
    cached = { fingerprint: fp, transport: buildTransport(cfg) };
  }
  return { cfg, transport: cached.transport };
}

function fromAddress(cfg) {
  if (!cfg.fromEmail) return 'no-reply@localhost';
  return cfg.fromName ? `"${cfg.fromName.replace(/["\r\n]/g, '')}" <${cfg.fromEmail}>` : cfg.fromEmail;
}

// Sends one message. Never throws — email is always a notification, never
// something that should roll back a DB write — but DOES return the result
// (or a clear error) so callers can log/inspect it. Never logs credentials;
// never logs message bodies (reset tokens, student PII).
async function sendMail({ to, subject, html, text, replyTo }) {
  const { cfg, transport } = await resolve();
  const configured = cfg.source !== 'none';

  try {
    const info = await transport.sendMail({
      from: fromAddress(cfg),
      to,
      subject,
      html,
      text,
      ...(replyTo ? { replyTo } : {}),
    });

    if (!configured) {
      if (!IS_PRODUCTION) {
        console.log(`[email:dev] would send "${subject}" to ${to} (SMTP not configured — no email actually sent)`);
      }
      return { sent: false, configured: false, info };
    }
    return { sent: true, configured: true, info };
  } catch (err) {
    // Message only — never the raw error object, which can embed auth details.
    console.error(`[email] send failed (to=${String(to).replace(/(?<=.).(?=[^@]*@)/g, '*')}): ${err.message}`);
    return { sent: false, configured, error: err.message };
  }
}

async function isConfigured() {
  return (await smtpSettings.getEffectiveConfig()).source !== 'none';
}

// Drops the cached transport (used when settings change and by tests).
function resetTransport() {
  cached = null;
}

module.exports = { sendMail, isConfigured, resetTransport };
