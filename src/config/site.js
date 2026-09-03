const { APP_BASE_URL } = require('./env');

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

const site = {
  name: process.env.SITE_NAME || 'Institute of Cosmetology & Dental Sciences',
  copyrightName: process.env.COPYRIGHT_NAME || process.env.SITE_NAME || 'Institute of Cosmetology & Dental Sciences',
  supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
  contactEmail: process.env.CONTACT_EMAIL || 'info@example.com',
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
};

site.phoneHref = site.contactPhone ? `tel:${digits(site.contactPhone)}` : '';
site.whatsappHref = site.whatsappNumber ? `https://wa.me/${site.whatsappNumber}` : '';
site.hasSocialLinks = Object.values(site.social).some(Boolean);

module.exports = site;
