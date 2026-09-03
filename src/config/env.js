// Centralized environment access. Everything else in the app should read
// config from here instead of touching process.env directly.
require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

// Hostinger's Node.js hosting assigns and injects its own PORT at runtime.
// 3000 is only a local-dev fallback and must never be hardcoded elsewhere.
const PORT = process.env.PORT || 3000;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  // Fail loudly and early rather than letting Prisma throw an opaque error
  // later on the first query.
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and configure your MySQL connection string.'
  );
}

// ---------------------------------------------------------------------------
// Session secret
// ---------------------------------------------------------------------------
// A short/placeholder secret would let an attacker forge session cookies, so
// production must supply a real one. Development gets a fallback purely so
// `npm run dev` works out of the box before a .env is customized.
// It contains everything which should be visibile and the secrets are only for the auth purpose 

const SESSION_SECRET = process.env.SESSION_SECRET;
const PLACEHOLDER_SECRETS = new Set([
  'change-me',
  'secret',
  'password',
  'your-secret-here',
  'changeme',
]);

if (IS_PRODUCTION) {
  if (!SESSION_SECRET) {
    throw new Error(
      'SESSION_SECRET is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  }
  if (PLACEHOLDER_SECRETS.has(SESSION_SECRET.toLowerCase()) || SESSION_SECRET.length < 32) {
    throw new Error(
      'SESSION_SECRET is missing or too weak for production. It must be a random string of at least 32 characters — see README for how to generate one.'
    );
  }
}

// ---------------------------------------------------------------------------
// Razorpay (Phase 5)
// ---------------------------------------------------------------------------
// Deliberately NOT validated/thrown on at boot: a deployment without
// payments configured yet should still be able to serve the rest of the
// site. Payment routes fail clearly (503) at the moment they're actually
// invoked if these are missing — see src/services/razorpay.service.js.
// RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET must never reach an EJS
// view or any client-side script; only RAZORPAY_KEY_ID is safe to expose.
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

if (IS_PRODUCTION && (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET || !RAZORPAY_WEBHOOK_SECRET)) {
  // Not a hard failure — the rest of the site (auth, courses, admin) must
  // keep working even if payments aren't configured yet. Loud warning only.
  console.warn(
    'WARNING: Razorpay is not fully configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / ' +
      'RAZORPAY_WEBHOOK_SECRET). Checkout and webhook routes will reject requests with a ' +
      'clear 503 until these are set.'
  );
}

// ---------------------------------------------------------------------------
// SMTP (email notifications — Phase 9)
// ---------------------------------------------------------------------------
// Deliberately provider-agnostic: any standard SMTP service works
// (Hostinger email, Google Workspace, Zoho, Brevo, SendGrid SMTP, Amazon
// SES SMTP, ...) — nothing here is specific to one vendor. Like Razorpay
// above, this is NOT validated/thrown on at boot: an app without email
// configured yet must keep working (signup/enrollment/certificates/contact
// all persist to the DB regardless of email). See src/services/email.service.js.
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
const SMTP_SECURE = process.env.SMTP_SECURE === '1' || process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASSWORD = process.env.SMTP_PASSWORD || '';
const SMTP_FROM_EMAIL = process.env.SMTP_FROM_EMAIL || '';
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || '';

const SMTP_CONFIGURED = Boolean(SMTP_HOST && SMTP_FROM_EMAIL);

if (SMTP_HOST && !SMTP_FROM_EMAIL) {
  console.warn(
    'WARNING: SMTP_HOST is set but SMTP_FROM_EMAIL is not — email sending stays disabled until ' +
      'both are configured (a "from" address is required by virtually every SMTP provider).'
  );
}
if (SMTP_HOST && (!SMTP_USER || !SMTP_PASSWORD)) {
  console.warn(
    'WARNING: SMTP_HOST is set without SMTP_USER/SMTP_PASSWORD — most providers require ' +
      'authentication; unauthenticated delivery will likely fail at send time.'
  );
}
if (IS_PRODUCTION && !SMTP_CONFIGURED) {
  console.warn(
    'WARNING: SMTP is not configured. Password reset, enrollment, and certificate emails will ' +
      'not be delivered — the underlying actions (reset token generation, enrollment, ' +
      'certificate issuance) still succeed, only the notification email is skipped.'
  );
}

// Hostinger's Node.js Web App runtime cannot reach raw MySQL TCP (verified
// against both Hostinger's own MySQL and an external TiDB Cloud database),
// so production instead routes Prisma queries through TiDB Cloud's HTTPS
// serverless driver (see src/config/db.js). This flag is separate from
// IS_PRODUCTION so the adapter path can also be exercised locally against
// the real TiDB database (point DATABASE_URL at it and set this to "1") —
// day-to-day local dev keeps using a plain TCP connection to the local
// MySQL container. Prisma Migrate always uses a normal TCP connection
// regardless of this flag; see README "Production Operations".
const USE_TIDB_HTTP_ADAPTER = process.env.USE_TIDB_HTTP_ADAPTER === '1';

// Temporary: gates the /internal/diagnostics/network route (see
// src/routes/internal.routes.js). Deliberately NOT admin-session-gated —
// admin login itself needs a working DB write, so during exactly the
// outage this route exists to diagnose, session-based auth would be
// unreachable. Unset/empty disables the route entirely. Remove this and
// the route together once the Hostinger DB connectivity issue is resolved
// (see README "Production Operations — Temporary Network Diagnostics").
const DIAGNOSTIC_TOKEN = process.env.DIAGNOSTIC_TOKEN || '';

module.exports = {
  NODE_ENV,
  IS_PRODUCTION,
  PORT,
  DATABASE_URL,
  USE_TIDB_HTTP_ADAPTER,
  DIAGNOSTIC_TOKEN,
  SESSION_SECRET: SESSION_SECRET || 'dev-only-insecure-secret-do-not-use-in-production',
  SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME || 'icds.sid',
  SESSION_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
  DEV_ADMIN_EMAIL: process.env.DEV_ADMIN_EMAIL,
  DEV_ADMIN_PASSWORD: process.env.DEV_ADMIN_PASSWORD,
  APP_BASE_URL: process.env.APP_BASE_URL || '',
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASSWORD,
  SMTP_FROM_EMAIL,
  SMTP_FROM_NAME,
  SMTP_CONFIGURED,
};
