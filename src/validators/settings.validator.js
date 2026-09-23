const { SAFE_CTA_TARGETS } = require('../services/settings.service');

const SHORT_MAX = 150;
const DESC_MAX = 600;

function text(body, key, max) {
  const value = typeof body[key] === 'string' ? body[key].trim().slice(0, max) : '';
  return value;
}

function bool(body, key) {
  return body[key] === 'true' || body[key] === 'on' || body[key] === true ? 'true' : 'false';
}

// Validates and whitelists the full settings form submission. Every field
// is length-capped and coerced to a safe type — nothing here ever accepts
// raw HTML/script, and CTA targets are restricted to a fixed whitelist so
// an admin account can never turn this into an XSS or open-redirect
// vector. Returns { errors, values } like the other validators in this
// codebase (see category.validator.js).
function validateSettings(body) {
  const errors = [];

  const ctaTarget = typeof body['why.ctaTarget'] === 'string' ? body['why.ctaTarget'].trim() : '';
  if (ctaTarget && !SAFE_CTA_TARGETS.includes(ctaTarget)) {
    errors.push('Why ICDS CTA target must be one of the predefined page sections.');
  }

  const values = {
    'brand.tagline': text(body, 'brand.tagline', SHORT_MAX),
    'brand.footerDescription': text(body, 'brand.footerDescription', DESC_MAX),

    'why.enabled': bool(body, 'why.enabled'),
    'why.eyebrow': text(body, 'why.eyebrow', SHORT_MAX),
    'why.heading': text(body, 'why.heading', SHORT_MAX),
    'why.description': text(body, 'why.description', DESC_MAX),
    'why.ctaLabel': text(body, 'why.ctaLabel', SHORT_MAX),
    'why.ctaTarget': SAFE_CTA_TARGETS.includes(ctaTarget) ? ctaTarget : '#courses',
    'why.feature1Title': text(body, 'why.feature1Title', SHORT_MAX),
    'why.feature1Desc': text(body, 'why.feature1Desc', DESC_MAX),
    'why.feature2Title': text(body, 'why.feature2Title', SHORT_MAX),
    'why.feature2Desc': text(body, 'why.feature2Desc', DESC_MAX),
    'why.feature3Title': text(body, 'why.feature3Title', SHORT_MAX),
    'why.feature3Desc': text(body, 'why.feature3Desc', DESC_MAX),
    'why.feature4Title': text(body, 'why.feature4Title', SHORT_MAX),
    'why.feature4Desc': text(body, 'why.feature4Desc', DESC_MAX),

    'process.enabled': bool(body, 'process.enabled'),
    'process.eyebrow': text(body, 'process.eyebrow', SHORT_MAX),
    'process.heading': text(body, 'process.heading', SHORT_MAX),
    'process.description': text(body, 'process.description', DESC_MAX),
    'process.step1Title': text(body, 'process.step1Title', SHORT_MAX),
    'process.step1Desc': text(body, 'process.step1Desc', DESC_MAX),
    'process.step2Title': text(body, 'process.step2Title', SHORT_MAX),
    'process.step2Desc': text(body, 'process.step2Desc', DESC_MAX),
    'process.step3Title': text(body, 'process.step3Title', SHORT_MAX),
    'process.step3Desc': text(body, 'process.step3Desc', DESC_MAX),
    'process.step4Title': text(body, 'process.step4Title', SHORT_MAX),
    'process.step4Desc': text(body, 'process.step4Desc', DESC_MAX),

    'instructors.enabled': bool(body, 'instructors.enabled'),
    'instructors.eyebrow': text(body, 'instructors.eyebrow', SHORT_MAX),
    'instructors.heading': text(body, 'instructors.heading', SHORT_MAX),
    'instructors.description': text(body, 'instructors.description', DESC_MAX),
    'instructors.emptyStateText': text(body, 'instructors.emptyStateText', SHORT_MAX),

    'newsletter.enabled': bool(body, 'newsletter.enabled'),
    'newsletter.eyebrow': text(body, 'newsletter.eyebrow', SHORT_MAX),
    'newsletter.heading': text(body, 'newsletter.heading', SHORT_MAX),
    'newsletter.description': text(body, 'newsletter.description', DESC_MAX),

    'nav.showAbout': bool(body, 'nav.showAbout'),
    'nav.showInstructors': bool(body, 'nav.showInstructors'),
    'nav.showReviews': bool(body, 'nav.showReviews'),
    'nav.showFaq': bool(body, 'nav.showFaq'),
  };

  // Required, non-empty fields — everything else may be blank (falls back
  // to the hard-coded default on next read via settings.service defaults).
  ['why.heading', 'process.heading'].forEach((key) => {
    if (values[key] === '') {
      errors.push(`${key} cannot be empty.`);
    }
  });

  return { errors, values };
}

module.exports = { validateSettings, SAFE_CTA_TARGETS };
