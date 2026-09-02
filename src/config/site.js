const { APP_BASE_URL } = require('./env');

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

const site = {
  name: process.env.SITE_NAME || 'Institute of Cosmetology & Dental Sciences',
  supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
  contactEmail: process.env.CONTACT_EMAIL || 'info@example.com',
  contactPhone: process.env.CONTACT_PHONE || '',
  whatsappNumber: digits(process.env.WHATSAPP_NUMBER || ''),
  baseUrl: APP_BASE_URL.replace(/\/$/, ''),
};

site.phoneHref = site.contactPhone ? `tel:${digits(site.contactPhone)}` : '';
site.whatsappHref = site.whatsappNumber ? `https://wa.me/${site.whatsappNumber}` : '';

module.exports = site;
