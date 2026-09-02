// Clean email-service abstraction. No SMTP provider is wired up yet — this
// phase only needs password-reset delivery, and in development that's
// satisfied by logging the link to the console.
//
// To add a real provider later (Hostinger SMTP, etc.), implement
// `sendMail` here using nodemailer or similar and keep this same call
// signature so callers (auth.service.js) don't need to change.
const { IS_PRODUCTION } = require('../config/env');

async function sendPasswordResetEmail(toEmail, resetUrl) {
  if (IS_PRODUCTION) {
    // No SMTP provider configured in this phase. Fail safe: never expose the
    // reset token/URL to the client, and never silently pretend an email
    // was sent when it wasn't.
    console.error(
      'Password reset requested but no production email provider is configured. ' +
        'Configure SMTP in a later phase before relying on password reset in production.'
    );
    return;
  }

  console.log('=== DEVELOPMENT PASSWORD RESET URL ===');
  console.log(`To: ${toEmail}`);
  console.log(`Reset URL: ${resetUrl}`);
  console.log('=======================================');
}

module.exports = { sendPasswordResetEmail };
