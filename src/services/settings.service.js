const { prisma } = require('../config/db');
const site = require('../config/site');

// A single, small key/value "Site Settings" store — deliberately not a
// bespoke model per homepage section, so this stays reusable rather than
// growing into a large CMS framework. Every key has a hard-coded default
// here, so a missing/partial DB row is always safe: the public site never
// renders "undefined" or an empty section by accident.
const PRIVACY_BODY = `## Overview
This Privacy Policy explains what information this website collects and how it is used. By creating an account or using the website you acknowledge this policy.

## Information we collect
- Account details you provide, such as your name and email address.
- Learning activity, such as course enrollments, lesson progress and certificates.
- Messages you send through the contact form and, if you subscribe, your email address for course updates.
- Order details when you purchase a course. Card and bank details are handled by the payment provider and are not stored on this website.
- Technical information, such as cookies that keep you signed in and protect forms.

## How we use information
- To provide access to your courses and record your progress.
- To respond to enquiries and send account or course messages.
- To keep the website secure and working properly.

## Cookies
We use essential cookies to keep you signed in and to protect forms against misuse.

## Sharing
Information is shared only with service providers needed to run the platform, such as hosting, email delivery and payment processing, or where required by law.

## Your choices
You can contact us to ask about, correct or delete your account information using the contact details shown on this website.

## Updates
This policy may be updated from time to time. The date of the latest update is shown on this page.`;

const TERMS_BODY = `## Using this website
By creating an account or using this website you agree to these terms.

## Your account
You are responsible for keeping your login details confidential and for activity under your account. Please provide accurate information when you register.

## Course access
Access to a course is granted to the enrolled student for personal learning only. Accounts and course access may not be shared or transferred.

## Course content
Course videos, materials and certificates belong to the institute or its instructors. You may not copy, record, download, redistribute or resell them without written permission.

## Acceptable use
Do not attempt to gain unauthorised access to the website, interfere with its operation, or submit false progress or completion information.

## Certificates
Certificates are issued to students who complete all lessons of a course, as recorded by the platform.

## Payments and enrollment
Course prices and enrollment arrangements are shown on each course page. For questions about payments or enrollment, please contact us.

## Availability and changes
We aim to keep the website available but do not guarantee uninterrupted access. Courses, these terms and the website may be updated from time to time.

## Contact
Questions about these terms can be sent through the contact page.`;

const DEFAULTS = {
  'brand.tagline': 'Learn. Practice. Grow. Build Your Professional Future.',
  'brand.footerDescription':
    'A professional learning platform for cosmetology, aesthetics, dental sciences, skin, hair and beauty education.',

  'why.enabled': 'true',
  'why.eyebrow': 'Why ICDS',
  'why.heading': 'Education that goes beyond watching videos.',
  'why.description':
    'Our online learning experience combines structured lessons, practical demonstrations and expert guidance to help students turn knowledge into professional skills.',
  'why.ctaLabel': 'Start Learning',
  'why.ctaTarget': '#courses',
  // Relative path only (e.g. "site/<uuid>.webp"), never an absolute path —
  // resolved against the shared thumbnail storage root and served via the
  // existing /uploads/thumbnails static mount. Empty string means "use the
  // bundled fallback image" (see views/partials/about.ejs).
  'why.imagePath': '',
  'why.feature1Title': 'Expert-led video lessons',
  'why.feature1Desc': 'Learn from experienced educators and industry professionals.',
  'why.feature2Title': 'Learn at your own pace',
  'why.feature2Desc': 'Access your enrolled courses whenever and wherever you want.',
  'why.feature3Title': 'Practical demonstrations',
  'why.feature3Desc': 'Watch real-world techniques explained step-by-step.',
  'why.feature4Title': 'Certificates of completion',
  'why.feature4Desc': 'Complete eligible courses and receive your certificate.',

  'process.enabled': 'true',
  'process.eyebrow': 'Simple Learning Process',
  'process.heading': 'Start learning in four simple steps',
  'process.description':
    'From selecting your course to completing your lessons, everything is designed to be simple and convenient.',
  'process.step1Title': 'Choose a Course',
  'process.step1Desc': 'Browse categories and select the course that matches your learning goals.',
  'process.step2Title': 'Create Account',
  'process.step2Desc': 'Register your student account using your email address.',
  'process.step3Title': 'Request Enrollment',
  'process.step3Desc': "Submit your enrollment request for the course you'd like to join.",
  'process.step4Title': 'Start Learning',
  'process.step4Desc': 'Once your enrollment is confirmed, access your lessons from your student dashboard.',

  'instructors.enabled': 'true',
  'instructors.eyebrow': 'Meet Your Mentors',
  'instructors.heading': 'Learn from experienced professionals',
  'instructors.description': 'Our instructors bring practical knowledge and professional experience into every lesson.',
  'instructors.emptyStateText': 'Instructor profiles are being updated.',

  'newsletter.enabled': 'true',
  'newsletter.eyebrow': 'Stay Updated',
  'newsletter.heading': 'Get new course updates in your inbox.',
  'newsletter.description':
    'Subscribe for new course announcements, educational resources, special offers and upcoming learning programs.',

  'nav.showAbout': 'true',
  'nav.showInstructors': 'true',
  'nav.showReviews': 'true',
  'nav.showFaq': 'true',

  // Institute / contact details. An empty value means "use the environment
  // default" (see src/config/site.js), so these can stay blank.
  'site.name': '',
  'contact.email': '',
  'contact.phone': '',
  'contact.address': '',

  // Legal pages: plain text only. Blank lines separate paragraphs, a line
  // starting with "## " is a heading, lines starting with "- " are list
  // items. Always HTML-escaped on render (see src/lib/legalText.js). The
  // default copy is neutral provisional wording; the admin settings page
  // flags it until it is replaced.
  'legal.privacy.heading': 'Privacy Policy',
  'legal.privacy.body': PRIVACY_BODY,
  'legal.privacy.updated': '',
  'legal.terms.heading': 'Terms & Conditions',
  'legal.terms.body': TERMS_BODY,
  'legal.terms.updated': '',
};

// Only these values are accepted for CTA-style link settings — never a raw
// admin-supplied URL/JS, so this can never become an XSS or open-redirect
// vector regardless of what an admin account types in.
const SAFE_CTA_TARGETS = ['#courses', '#about', '#instructors', '#testimonials', '#faq', '/courses'];

let cache = { data: null, expiresAt: 0 };
const CACHE_TTL_MS = 30 * 1000;

function toBool(value) {
  return value === 'true' || value === true;
}

// Returns the full effective settings object (defaults overlaid with any
// saved DB rows), cached briefly since this is read on every public page
// render.
async function getSettings() {
  if (cache.data && Date.now() < cache.expiresAt) return cache.data;

  let rows = [];
  try {
    rows = await prisma.siteSetting.findMany();
  } catch (err) {
    // DB unavailable or table not yet migrated: fall back to defaults
    // rather than breaking every page render.
    rows = [];
  }

  const merged = { ...DEFAULTS };
  for (const row of rows) {
    // A blank saved value always means "use the default".
    if (row.value === '') continue;
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, row.key)) {
      merged[row.key] = row.value;
    }
  }

  // Pre-computed booleans, alongside the raw string values, so views don't
  // need to re-parse 'true'/'false' strings themselves.
  merged.whyEnabled = toBool(merged['why.enabled']);
  merged.processEnabled = toBool(merged['process.enabled']);
  merged.instructorsEnabled = toBool(merged['instructors.enabled']);
  merged.newsletterEnabled = toBool(merged['newsletter.enabled']);
  merged.navShowAbout = toBool(merged['nav.showAbout']);
  merged.navShowInstructors = toBool(merged['nav.showInstructors']);
  merged.navShowReviews = toBool(merged['nav.showReviews']);
  merged.navShowFaq = toBool(merged['nav.showFaq']);

  // Admin-managed institute/contact details override the env defaults on
  // the shared `site` config (blank = env fallback).
  site.applyOverrides({
    name: merged['site.name'],
    email: merged['contact.email'],
    phone: merged['contact.phone'],
    address: merged['contact.address'],
  });

  cache = { data: merged, expiresAt: Date.now() + CACHE_TTL_MS };
  return merged;
}

function invalidateCache() {
  cache = { data: null, expiresAt: 0 };
}

// Admin: raw key/value rows only for keys we know about (never persists an
// arbitrary key an admin might submit).
async function listSettingsAdmin() {
  const rows = await prisma.siteSetting.findMany();
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const result = {};
  for (const key of Object.keys(DEFAULTS)) {
    result[key] = byKey.has(key) ? byKey.get(key) : DEFAULTS[key];
  }
  return result;
}

// Bulk upsert of a validated {key: value} map. Unknown keys are silently
// dropped — this can never be used to store an arbitrary settings key.
async function updateSettings(values) {
  const entries = Object.entries(values).filter(([key]) => Object.prototype.hasOwnProperty.call(DEFAULTS, key));
  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.siteSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    )
  );
  invalidateCache();
}

module.exports = {
  DEFAULTS,
  SAFE_CTA_TARGETS,
  getSettings,
  listSettingsAdmin,
  updateSettings,
  invalidateCache,
};
