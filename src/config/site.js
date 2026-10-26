const { APP_BASE_URL } = require('./env');

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

const site = {
  name: process.env.SITE_NAME || 'Institute of Cosmetology & Dental Sciences',
  copyrightName: process.env.COPYRIGHT_NAME || process.env.SITE_NAME || 'Institute of Cosmetology & Dental Sciences',
  // No example.com fallback: an unconfigured contact email renders nothing
  // on the public site (see footer/contact views) rather than a fake address.
  supportEmail: process.env.SUPPORT_EMAIL || process.env.CONTACT_EMAIL || '',
  contactEmail: process.env.CONTACT_EMAIL || process.env.SUPPORT_EMAIL || '',
  contactPhone: process.env.CONTACT_PHONE || '',
  whatsappNumber: digits(process.env.WHATSAPP_NUMBER || ''),
  address: process.env.SITE_ADDRESS || '',
  baseUrl: APP_BASE_URL.replace(/\/$/, ''),
  social: {
    facebook: process.env.SOCIAL_FACEBOOK_URL || '',
    instagram: process.env.SOCIAL_INSTAGRAM_URL || '',
    youtube: process.env.SOCIAL_YOUTUBE_URL || '',
    linkedin: process.env.SOCIAL_LINKEDIN_URL || '',
  },
  // Optional, third-party, off by default — only rendered when the env var
  // is actually set (see views/partials/seo-head.ejs). Never fabricate one.
  gaMeasurementId: process.env.GA_MEASUREMENT_ID || '',
  googleSiteVerification: process.env.GOOGLE_SITE_VERIFICATION || '',
};

// Env values stay as the fallback defaults; Admin > Settings can override
// name / contact email / phone / address at runtime (see
// settings.service.js getSettings, which calls applyOverrides). The `site`
// object is a shared singleton read at render time everywhere, so mutating
// it in place makes a change visible site-wide without a redeploy.
const envDefaults = {
  name: site.name,
  copyrightName: site.copyrightName,
  supportEmail: site.supportEmail,
  contactEmail: site.contactEmail,
  contactPhone: site.contactPhone,
  address: site.address,
  whatsappNumber: site.whatsappNumber,
};
const copyrightFromEnv = Boolean(process.env.COPYRIGHT_NAME);

function pick(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

site.envDefaults = envDefaults;

site.applyOverrides = function applyOverrides(overrides = {}) {
  const emailOverride = pick(overrides.email, '');
  site.name = pick(overrides.name, envDefaults.name);
  site.shortName = pick(overrides.shortName, '');
  site.copyrightName =
    pick(overrides.copyrightName, '') ||
    (copyrightFromEnv ? envDefaults.copyrightName : pick(overrides.name, '') || envDefaults.copyrightName);
  site.contactEmail = emailOverride || envDefaults.contactEmail;
  // Support email: its own override, else the contact-email override (kept
  // for backwards compatibility), else the environment value.
  site.supportEmail = pick(overrides.supportEmail, '') || emailOverride || envDefaults.supportEmail;
  site.contactPhone = pick(overrides.phone, envDefaults.contactPhone);
  site.address = pick(overrides.address, envDefaults.address);
  // WhatsApp / business hours / map link are Admin-managed (env WHATSAPP_NUMBER stays the fallback).
  const waDigits = digits(pick(overrides.whatsapp, '') || envDefaults.whatsappNumber);
  site.whatsappNumber = waDigits.length >= 8 && waDigits.length <= 15 ? waDigits : '';
  site.whatsappHref = site.whatsappNumber ? `https://wa.me/${site.whatsappNumber}` : '';
  site.whatsappDisplay = site.whatsappNumber ? (pick(overrides.whatsapp, '') || `+${site.whatsappNumber}`) : '';
  site.businessHours = pick(overrides.hours, '');
  const map = pick(overrides.mapUrl, '');
  site.mapUrl = /^https:\/\/[^\s"'<>]+$/i.test(map) ? map : '';
  site.seoTitle = pick(overrides.seoTitle, '');
  site.seoDescription = pick(overrides.seoDescription, '');
  site.phoneHref = site.contactPhone ? `tel:${digits(site.contactPhone)}` : '';
};

site.businessHours = '';
site.whatsappDisplay = site.whatsappNumber ? `+${site.whatsappNumber}` : '';
site.mapUrl = '';
site.shortName = '';
site.seoTitle = '';
site.seoDescription = '';

site.phoneHref = site.contactPhone ? `tel:${digits(site.contactPhone)}` : '';
site.whatsappHref = site.whatsappNumber ? `https://wa.me/${site.whatsappNumber}` : '';
site.hasSocialLinks = Object.values(site.social).some(Boolean);

module.exports = site;
