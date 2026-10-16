// Admin-managed GST / invoice settings. Stored as plain rows in the existing
// site_settings table under "tax.*" keys (no secrets here), read through a
// short cache. The site-wide GST rate applies to every paid course unless the
// course sets its own rate (Course.gstRate; 0 = exempt).
const { prisma } = require('../config/db');
const { computeTax } = require('../lib/tax');

const KEYS = {
  enabled: 'tax.enabled',
  rate: 'tax.rate',
  inclusive: 'tax.inclusive',
  gstin: 'tax.gstin',
  legalName: 'tax.legalName',
  address: 'tax.address',
  note: 'tax.invoiceNote',
  invoiceTitle: 'tax.invoiceTitle',
  accent: 'tax.accent',
  invoicePrefix: 'tax.invoicePrefix',
  terms: 'tax.terms',
  signatory: 'tax.signatory',
};
const DEFAULTS = {
  enabled: false,
  rate: 18,
  inclusive: true,
  gstin: '',
  legalName: '',
  address: '',
  note: '',
  invoiceTitle: 'TAX INVOICE',
  accent: '#565acf',
  invoicePrefix: 'INV-',
  terms: '',
  signatory: '',
};
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const PREFIX_RE = /^[A-Za-z0-9/-]{0,10}$/;
const CACHE_MS = 30 * 1000;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

let cache = null;

function invalidate() {
  cache = null;
}

async function get() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let rows = [];
  try {
    rows = await prisma.siteSetting.findMany({ where: { key: { in: Object.values(KEYS) } } });
  } catch {
    return { ...DEFAULTS };
  }
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const rate = Number(map.get(KEYS.rate));
  const value = {
    enabled: map.get(KEYS.enabled) === 'true',
    rate: Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : DEFAULTS.rate,
    inclusive: map.has(KEYS.inclusive) ? map.get(KEYS.inclusive) === 'true' : DEFAULTS.inclusive,
    gstin: map.get(KEYS.gstin) || '',
    legalName: map.get(KEYS.legalName) || '',
    address: map.get(KEYS.address) || '',
    note: map.get(KEYS.note) || '',
    invoiceTitle: map.get(KEYS.invoiceTitle) || DEFAULTS.invoiceTitle,
    accent: HEX_RE.test(map.get(KEYS.accent) || '') ? map.get(KEYS.accent) : DEFAULTS.accent,
    invoicePrefix: map.has(KEYS.invoicePrefix) ? map.get(KEYS.invoicePrefix) : DEFAULTS.invoicePrefix,
    terms: map.get(KEYS.terms) || '',
    signatory: map.get(KEYS.signatory) || '',
  };
  cache = { at: Date.now(), value };
  return value;
}

function validate(body = {}) {
  const errors = [];
  const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const rate = Number(text(body.rate, 6));
  const values = {
    enabled: body.enabled === '1' || body.enabled === 'on' || body.enabled === 'true',
    rate,
    inclusive: body.priceMode !== 'exclusive',
    gstin: text(body.gstin, 15).toUpperCase(),
    legalName: text(body.legalName, 150),
    address: text(body.address, 400),
    note: text(body.note, 400),
    invoiceTitle: text(body.invoiceTitle, 40) || DEFAULTS.invoiceTitle,
    accent: text(body.accent, 7) || DEFAULTS.accent,
    invoicePrefix: text(body.invoicePrefix, 10),
    terms: text(body.terms, 800),
    signatory: text(body.signatory, 100),
  };
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) errors.push('GST rate must be between 0 and 100.');
  if (values.gstin && !GSTIN_RE.test(values.gstin)) errors.push('GSTIN must be a valid 15-character GST number (e.g. 07ABCDE1234F1Z5).');
  if (!HEX_RE.test(values.accent)) errors.push('Accent colour must be a hex colour like #565acf.');
  if (!PREFIX_RE.test(values.invoicePrefix)) errors.push('Invoice prefix may only contain letters, numbers, - and / (max 10 characters).');
  if (values.enabled && !values.legalName) errors.push('Enter the business / legal name that appears on invoices.');
  return { errors, values };
}

async function save(values) {
  const rows = [
    [KEYS.enabled, String(Boolean(values.enabled))],
    [KEYS.rate, String(values.rate)],
    [KEYS.inclusive, String(Boolean(values.inclusive))],
    [KEYS.gstin, values.gstin],
    [KEYS.legalName, values.legalName],
    [KEYS.address, values.address],
    [KEYS.note, values.note],
    [KEYS.invoiceTitle, values.invoiceTitle],
    [KEYS.accent, values.accent],
    [KEYS.invoicePrefix, values.invoicePrefix],
    [KEYS.terms, values.terms],
    [KEYS.signatory, values.signatory],
  ];
  await prisma.$transaction(
    rows.map(([key, value]) =>
      value === ''
        ? prisma.siteSetting.deleteMany({ where: { key } })
        : prisma.siteSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
    )
  );
  invalidate();
}

// Effective GST rate (%) for a course: 0 when GST is off or the price is
// free; the course's own rate when set; otherwise the site default.
function rateFor(course, settings) {
  if (!settings.enabled) return 0;
  if (course.gstRate !== null && course.gstRate !== undefined && course.gstRate !== '') return Number(course.gstRate);
  return settings.rate;
}

// Full server-side price breakdown for one course purchase.
async function getPricing(course, listPrice) {
  const settings = await get();
  const pricing = computeTax({ listPrice, rate: rateFor(course, settings), inclusive: settings.inclusive });
  return { ...pricing, settings };
}

module.exports = { get, validate, save, invalidate, rateFor, getPricing, GSTIN_RE };
