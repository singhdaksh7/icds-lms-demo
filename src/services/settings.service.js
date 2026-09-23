const { prisma } = require('../config/db');

// A single, small key/value "Site Settings" store — deliberately not a
// bespoke model per homepage section, so this stays reusable rather than
// growing into a large CMS framework. Every key has a hard-coded default
// here, so a missing/partial DB row is always safe: the public site never
// renders "undefined" or an empty section by accident.
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
