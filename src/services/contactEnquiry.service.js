const { prisma } = require('../config/db');
const site = require('../config/site');

// Contact enquiries: validation, storage and the Admin management helpers for the
// public /contact form. Stored in the existing contact_messages table (extended
// with phone / reason / interested course), shown in Admin > Contact Enquiries.
// Everything a visitor submits is plain text: control characters are stripped,
// lengths are capped and nothing is ever rendered as HTML.

const STATUSES = ['NEW', 'READ', 'IN_PROGRESS', 'RESOLVED', 'SPAM'];
const STATUS_LABELS = { NEW: 'New', READ: 'Read', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', SPAM: 'Spam' };
const LIMITS = { name: 120, email: 254, phone: 30, subject: 180, reason: 100, message: 5000, minMessage: 10, maxReasonOptions: 10 };
const PHONE_RE = /^[0-9+()\-.\s]{5,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,199}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const MAX_LINKS = 2;

class ContactEnquiryError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ContactEnquiryError';
    this.statusCode = statusCode;
  }
}

const one = (v) => (Array.isArray(v) ? v[v.length - 1] : v);
const oneLine = (v) => (typeof one(v) === 'string' ? one(v).replace(CONTROL, ' ').replace(/\s+/g, ' ').trim() : '');
const multiLine = (v) => (typeof one(v) === 'string' ? one(v).replace(/\r\n?/g, '\n').replace(CONTROL, '').trim() : '');

// ---- admin-managed reason options (one per line) -----------------------------
function parseReasonOptions(raw) {
  const seen = new Set();
  const out = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const v = line.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.reason);
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
    if (out.length >= LIMITS.maxReasonOptions) break;
  }
  return out;
}

// ---- courses ------------------------------------------------------------------
async function listPublishedCourses() {
  try {
    return await prisma.course.findMany({
      where: { status: 'PUBLISHED' },
      select: { id: true, title: true, slug: true },
      orderBy: { title: 'asc' },
    });
  } catch (_err) {
    return [];
  }
}

// ?course=<slug> => a PUBLISHED course or null (drafts / unknown / malformed are ignored).
function resolveCourseBySlug(courses, slug) {
  const s = typeof one(slug) === 'string' ? one(slug).trim().toLowerCase() : '';
  if (!s || !SLUG_RE.test(s)) return null;
  return (courses || []).find((c) => c.slug === s) || null;
}

// ---- spam / abuse heuristics -----------------------------------------------------
function countLinks(text) {
  return (String(text || '').match(/(?:https?:\/\/|www\.)\S+/gi) || []).length;
}
function looksLikeMarkupSpam(text) {
  return /<\s*(a|script|iframe|img|link|style)\b|\[\s*url\s*=|\[\s*link\s*=/i.test(String(text || ''));
}

/**
 * @param body        req.body
 * @param ctx.reasons allowed reason options (admin managed)
 * @param ctx.courses published courses [{ id, title, slug }]
 * @returns { errors: string[], values, spam: boolean }
 */
function validateEnquiry(body = {}, ctx = {}) {
  const reasons = ctx.reasons || [];
  const courses = ctx.courses || [];
  const errors = [];
  const values = {
    name: oneLine(body.name),
    email: oneLine(body.email).toLowerCase(),
    phone: oneLine(body.phone),
    subject: oneLine(body.subject),
    reason: oneLine(body.reason),
    courseId: null,
    message: multiLine(body.message),
  };

  // Honeypot: real visitors never see or fill the hidden "website" field.
  const spam = Boolean(oneLine(body.website))
    || countLinks(`${values.message} ${values.subject} ${values.name}`) > MAX_LINKS
    || looksLikeMarkupSpam(`${values.message} ${values.subject} ${values.name}`);

  if (values.name.length < 2 || values.name.length > LIMITS.name) errors.push(`Full name must be between 2 and ${LIMITS.name} characters.`);
  if (!EMAIL_RE.test(values.email) || values.email.length > LIMITS.email) errors.push('Enter a valid email address.');
  if (values.phone && !PHONE_RE.test(values.phone)) errors.push('Phone may contain only digits, spaces and + ( ) - . (5 to 30 characters).');
  if (values.subject && (values.subject.length < 3 || values.subject.length > LIMITS.subject)) errors.push(`Subject must be between 3 and ${LIMITS.subject} characters.`);

  if (reasons.length) {
    if (!values.reason) errors.push('Please choose how we can help.');
    else if (!reasons.includes(values.reason)) errors.push('Please choose one of the listed reasons.');
  } else {
    values.reason = '';
  }

  const rawCourse = oneLine(body.courseId);
  if (rawCourse) {
    const id = /^\d{1,10}$/.test(rawCourse) ? parseInt(rawCourse, 10) : NaN;
    const course = courses.find((c) => c.id === id);
    if (!course) errors.push('Please choose a valid course.');
    else values.courseId = course.id;
  }

  if (values.message.length < LIMITS.minMessage || values.message.length > LIMITS.message) {
    errors.push(`Message must be between ${LIMITS.minMessage} and ${LIMITS.message.toLocaleString('en-US')} characters.`);
  }

  // The stored subject is always meaningful: explicit subject, else reason (+ course).
  if (!values.subject) {
    const course = courses.find((c) => c.id === values.courseId);
    values.subject = [values.reason || 'Website enquiry', course ? course.title : ''].filter(Boolean).join(' - ').slice(0, LIMITS.subject);
  }
  return { errors, values, spam };
}

async function createEnquiry(values) {
  return prisma.contactMessage.create({
    data: {
      name: values.name,
      email: values.email,
      phone: values.phone || null,
      subject: values.subject,
      reason: values.reason || null,
      courseId: values.courseId || null,
      message: values.message,
      status: 'NEW',
    },
  });
}

// ---- public presentation helpers ----------------------------------------------------
function whatsappLink(number, courseTitle) {
  const digits = String(number || '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  const subject = courseTitle ? String(courseTitle).replace(CONTROL, ' ').trim().slice(0, 120) : String(site.name || '').slice(0, 120);
  const text = subject ? `Hi, I have a question about ${subject}` : 'Hi, I have a question';
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function mapsLink(s = site) {
  if (s.mapUrl) return s.mapUrl;
  const address = String(s.address || '').replace(/\s+/g, ' ').trim();
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '';
}

// Cards only for values the Admin actually configured. Nothing is invented.
function buildContactCards(cms = {}, s = site, courseTitle = '') {
  const cp = cms.contactPage || {};
  const cards = [];
  if (s.contactEmail) cards.push({ key: 'email', icon: 'bi-envelope', label: cp.emailCardLabel, value: s.contactEmail, href: `mailto:${s.contactEmail}`, note: cp.emailCardNote });
  if (s.contactPhone) cards.push({ key: 'phone', icon: 'bi-telephone', label: cp.phoneCardLabel, value: s.contactPhone, href: s.phoneHref || '', note: cp.phoneCardNote });
  const wa = whatsappLink(s.whatsappNumber, courseTitle);
  if (wa) cards.push({ key: 'whatsapp', icon: 'bi-whatsapp', label: cp.whatsappCardLabel, value: s.whatsappDisplay || `+${s.whatsappNumber}`, href: wa, note: cp.whatsappCardNote, external: true });
  if (s.address) {
    cards.push({ key: 'address', icon: 'bi-geo-alt', label: cp.addressCardLabel, value: s.address, href: '', note: cp.addressCardNote, mapHref: mapsLink(s), mapLabel: cp.mapButtonLabel, multiline: true });
  }
  if (s.businessHours) cards.push({ key: 'hours', icon: 'bi-clock', label: cp.hoursCardLabel, value: s.businessHours, href: '', note: '', multiline: true });
  return cards;
}

// ---- Admin ----------------------------------------------------------------------------
function normalizeStatusFilter(value) {
  const v = String(one(value) || '').toUpperCase();
  return STATUSES.includes(v) ? v : '';
}

async function listEnquiries({ status = '' } = {}) {
  const filter = normalizeStatusFilter(status);
  const where = filter ? { status: filter } : {};
  const [rows, grouped] = await Promise.all([
    prisma.contactMessage.findMany({
      where,
      include: { course: { select: { id: true, title: true, slug: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.contactMessage.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const g of grouped) counts[g.status] = g._count._all;
  return { rows, counts, filter, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

async function getEnquiry(id) {
  const n = parseInt(id, 10);
  if (!Number.isInteger(n) || n < 1) return null;
  return prisma.contactMessage.findUnique({ where: { id: n }, include: { course: { select: { id: true, title: true, slug: true } } } });
}

async function setStatus(id, status) {
  const n = parseInt(id, 10);
  const s = String(one(status) || '').toUpperCase();
  if (!STATUSES.includes(s)) throw new ContactEnquiryError('Invalid enquiry status.');
  const existing = await prisma.contactMessage.findUnique({ where: { id: n }, select: { id: true } });
  if (!existing) throw new ContactEnquiryError('Enquiry not found.', 404);
  return prisma.contactMessage.update({ where: { id: n }, data: { status: s } });
}

async function deleteEnquiry(id) {
  const n = parseInt(id, 10);
  const existing = await prisma.contactMessage.findUnique({ where: { id: n }, select: { id: true } });
  if (!existing) throw new ContactEnquiryError('Enquiry not found.', 404);
  await prisma.contactMessage.delete({ where: { id: n } });
}

module.exports = {
  STATUSES,
  STATUS_LABELS,
  LIMITS,
  ContactEnquiryError,
  parseReasonOptions,
  listPublishedCourses,
  resolveCourseBySlug,
  validateEnquiry,
  createEnquiry,
  whatsappLink,
  mapsLink,
  buildContactCards,
  normalizeStatusFilter,
  listEnquiries,
  getEnquiry,
  setStatus,
  deleteEnquiry,
};
