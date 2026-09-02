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

module.exports = {
  NODE_ENV,
  IS_PRODUCTION,
  PORT,
  DATABASE_URL,
  SESSION_SECRET: SESSION_SECRET || 'dev-only-insecure-secret-do-not-use-in-production',
  SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME || 'icds.sid',
  SESSION_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
  DEV_ADMIN_EMAIL: process.env.DEV_ADMIN_EMAIL,
  DEV_ADMIN_PASSWORD: process.env.DEV_ADMIN_PASSWORD,
  APP_BASE_URL: process.env.APP_BASE_URL || '',
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET,
};
