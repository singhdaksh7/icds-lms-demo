const { prisma } = require('../config/db');
const site = require('../config/site');
const { validateLinkUrl } = require('../lib/linkUrl');
const { parseFormBool } = require('../lib/formBool');

// Generic CMS-backed standalone pages. SitePage holds the shared hero / CTA /
// SEO fields, SitePageSection the free-form content blocks. A page row that
// exists is the single source of truth: clearing a field hides it publicly and
// no hardcoded copy ever reappears. Starter copy (below) is used only while no
// row exists yet, and is persisted by the targeted initializer
// (scripts/init-site-pages-nav.js) or on the first Admin visit.
const PAGE_META = Object.freeze({
  about: { slug: 'about', label: 'About', path: '/about', hasSections: true, description: 'Who you are, your mission and learning approach.' },
  faq: { slug: 'faq', label: 'FAQ', path: '/faq', hasSections: false, description: 'Questions and answers are managed in Admin > FAQs.' },
  reviews: { slug: 'reviews', label: 'Reviews', path: '/reviews', hasSections: false, description: 'Genuine published testimonials; manage them per course.' },
  contact: { slug: 'contact', label: 'Contact', path: '/contact', hasSections: false, description: 'Hero, closing call-to-action and SEO are edited here. Email, phone, WhatsApp, address, business hours and map link: Site Content > Brand & Global. Cards, form copy, reason options and FAQ preview text: Site Content > Contact. Enquiries: Contact Enquiries.' },
});
const PAGE_SLUGS = Object.keys(PAGE_META);

const LIMITS = { eyebrow: 120, heading: 200, intro: 2000, ctaHeading: 200, ctaText: 500, ctaLabel: 100, seoTitle: 70, metaDescription: 200, heroImageUrl: 500, sectionTitle: 200, sectionBody: 5000 };
const ICON_RE = /^bi-[a-z0-9-]{1,50}$/;

class SitePageError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'SitePageError';
    this.statusCode = statusCode;
  }
}

const str = (v) => (v === undefined || v === null ? '' : String(v));

// Starter copy derived from the site's own admin-editable content (cms), never
// invented claims, phone numbers or addresses.
function starterDefaults(slug, cms = null) {
  const c = cms || {};
  const why = c.why || {};
  const faq = c.faq || {};
  const base = { isEnabled: true, eyebrow: '', heading: '', intro: '', heroImageUrl: '', ctaHeading: '', ctaText: '', ctaLabel: '', ctaUrl: '', seoTitle: '', metaDescription: '' };
  if (slug === 'about') {
    return {
      ...base,
      eyebrow: str(why.eyebrow) || 'About',
      heading: str(why.heading) || `About ${site.name}`,
      intro: str(why.description),
      ctaHeading: 'Ready to start learning?',
      ctaText: '',
      ctaLabel: 'Explore Courses',
      ctaUrl: '/courses',
    };
  }
  if (slug === 'faq') {
    return {
      ...base,
      eyebrow: str(faq.eyebrow) || 'Frequently Asked Questions',
      heading: str(faq.heading) || 'Everything you need to know',
      intro: str(faq.description),
      ctaHeading: 'Still have questions?',
      ctaText: 'Our team is happy to help.',
      ctaLabel: 'Contact us',
      ctaUrl: '/contact',
    };
  }
  if (slug === 'reviews') {
    return { ...base, eyebrow: 'Learner stories', heading: 'What our learners say', ctaLabel: 'Explore Courses', ctaUrl: '/courses', ctaHeading: 'Start your own journey' };
  }
  // contact: heading/intro/labels come from Site Content (cms.contactPage); the hero eyebrow
  // and closing CTA below are just first-render starters (editable, persisted by the initializer).
  return { ...base, eyebrow: 'Get in touch', ctaHeading: 'Still deciding which course is right for you?', ctaText: 'Browse our courses, or talk to the team - we are happy to help you choose.', ctaLabel: 'Explore Courses', ctaUrl: '/courses' };
}

function starterSections(slug, cms = null) {
  if (slug !== 'about') return [];
  const why = (cms && cms.why) || {};
  const out = [];
  [1, 2, 3, 4].forEach((n) => {
    const title = str(why[`feature${n}Title`]);
    const body = str(why[`feature${n}Desc`]);
    if (title) out.push({ title, body, icon: 'bi-check2-circle', sortOrder: n * 10, isPublished: true });
  });
  return out;
}

function assertSlug(slug) {
  if (!PAGE_SLUGS.includes(slug)) throw new SitePageError('Unknown page.', 404);
  return slug;
}

function shapePage(row, slug) {
  return {
    slug,
    isEnabled: row.isEnabled !== false,
    eyebrow: str(row.eyebrow),
    heading: str(row.heading),
    intro: str(row.intro),
    heroImageUrl: str(row.heroImageUrl),
    ctaHeading: str(row.ctaHeading),
    ctaText: str(row.ctaText),
    ctaLabel: str(row.ctaLabel),
    ctaUrl: str(row.ctaUrl),
    seoTitle: str(row.seoTitle),
    metaDescription: str(row.metaDescription),
  };
}

// Public: null when the page is disabled (route renders the standard 404).
async function getPublicPage(slug, cms = null) {
  assertSlug(slug);
  let row = null;
  try {
    row = await prisma.sitePage.findUnique({
      where: { slug },
      include: { sections: { where: { isPublished: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
    });
  } catch (_err) {
    row = null;
  }
  if (!row) {
    const page = { slug, ...starterDefaults(slug, cms) };
    return { page, sections: starterSections(slug, cms), fromStarter: true };
  }
  if (row.isEnabled === false) return null;
  return { page: shapePage(row, slug), sections: row.sections || [], fromStarter: false };
}

// Cheap enabled check (sitemap, nav). No row => enabled.
async function isPageEnabled(slug) {
  try {
    const row = await prisma.sitePage.findUnique({ where: { slug }, select: { isEnabled: true } });
    return !row || row.isEnabled !== false;
  } catch (_err) {
    return true;
  }
}

async function listPagesAdmin() {
  const rows = await prisma.sitePage.findMany({ include: { _count: { select: { sections: true } } } });
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  return PAGE_SLUGS.map((slug) => {
    const row = bySlug.get(slug);
    return { ...PAGE_META[slug], exists: Boolean(row), isEnabled: row ? row.isEnabled !== false : true, heading: row ? str(row.heading) : '', sectionCount: row ? row._count.sections : 0 };
  });
}

// Creates the row (+ starter sections) when missing; idempotent, never overwrites.
async function ensurePage(slug, cms = null) {
  assertSlug(slug);
  const existing = await prisma.sitePage.findUnique({ where: { slug } });
  if (existing) return { row: existing, created: false };
  const d = starterDefaults(slug, cms);
  try {
    const row = await prisma.sitePage.create({
      data: {
        slug,
        isEnabled: true,
        eyebrow: d.eyebrow || null,
        heading: d.heading || null,
        intro: d.intro || null,
        heroImageUrl: d.heroImageUrl || null,
        ctaHeading: d.ctaHeading || null,
        ctaText: d.ctaText || null,
        ctaLabel: d.ctaLabel || null,
        ctaUrl: d.ctaUrl || null,
        seoTitle: d.seoTitle || null,
        metaDescription: d.metaDescription || null,
        sections: { create: starterSections(slug, cms).map((s) => ({ title: s.title, body: s.body, icon: s.icon, sortOrder: s.sortOrder, isPublished: true })) },
      },
    });
    return { row, created: true };
  } catch (err) {
    if (err && err.code === 'P2002') return { row: await prisma.sitePage.findUnique({ where: { slug } }), created: false };
    throw err;
  }
}

async function getPageAdmin(slug, cms = null) {
  assertSlug(slug);
  await ensurePage(slug, cms);
  const row = await prisma.sitePage.findUnique({
    where: { slug },
    include: { sections: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
  });
  return { meta: PAGE_META[slug], page: shapePage(row, slug), sections: row.sections };
}

function cleanText(value, max, label) {
  if (value === undefined) return undefined;
  const v = str(Array.isArray(value) ? value[value.length - 1] : value).replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim();
  if (v.length > max) throw new SitePageError(`${label} must be ${max} characters or fewer.`);
  return v;
}

function cleanMediaUrl(value) {
  if (value === undefined) return undefined;
  const v = str(Array.isArray(value) ? value[value.length - 1] : value).trim();
  if (!v) return '';
  if (v.length > LIMITS.heroImageUrl) throw new SitePageError('Hero image URL is too long.');
  if (/^\/(uploads|images|assets)\/[A-Za-z0-9._\/-]+$/.test(v) && !v.includes('..')) return v;
  if (/^https:\/\/[^\s"'<>]+$/i.test(v)) return v;
  throw new SitePageError('Hero image must be an uploaded image path or an https:// image URL.');
}

// Patch-style: only fields present in `input` change; unchecked checkboxes are
// posted as a hidden "false", so editing another field never toggles isEnabled.
async function updatePage(slug, input = {}, cms = null) {
  assertSlug(slug);
  await ensurePage(slug, cms);
  const data = {};
  if (input.isEnabled !== undefined) data.isEnabled = parseFormBool(input.isEnabled);
  const text = [['eyebrow', 'Eyebrow'], ['heading', 'Heading'], ['intro', 'Intro'], ['ctaHeading', 'CTA heading'], ['ctaText', 'CTA text'], ['ctaLabel', 'CTA button label'], ['seoTitle', 'SEO title'], ['metaDescription', 'Meta description']];
  for (const [field, label] of text) {
    const v = cleanText(input[field], LIMITS[field], label);
    if (v !== undefined) data[field] = v || null;
  }
  const hero = cleanMediaUrl(input.heroImageUrl);
  if (hero !== undefined) data.heroImageUrl = hero || null;
  if (input.ctaUrl !== undefined) {
    const r = validateLinkUrl(Array.isArray(input.ctaUrl) ? input.ctaUrl[input.ctaUrl.length - 1] : input.ctaUrl, { allowEmpty: true });
    if (!r.ok) throw new SitePageError(`CTA link: ${r.error}`);
    data.ctaUrl = r.value || null;
  }
  const row = await prisma.sitePage.update({ where: { slug }, data });
  require('./navigation.service').invalidateNavCache();
  return row;
}

// ---- sections -------------------------------------------------------------
function cleanIcon(value) {
  if (value === undefined) return undefined;
  const v = str(Array.isArray(value) ? value[value.length - 1] : value).trim();
  if (!v) return '';
  if (!ICON_RE.test(v)) throw new SitePageError('Icon must be a Bootstrap icon class such as bi-star.');
  return v;
}

async function sectionOwned(slug, sectionId) {
  const section = await prisma.sitePageSection.findUnique({ where: { id: sectionId }, include: { page: { select: { slug: true } } } });
  if (!section || section.page.slug !== slug) throw new SitePageError('Section not found.', 404);
  return section;
}

async function addSection(slug, input = {}, cms = null) {
  assertSlug(slug);
  if (!PAGE_META[slug].hasSections) throw new SitePageError('This page does not use content sections.');
  const { row: page } = await ensurePage(slug, cms);
  const title = cleanText(input.title, LIMITS.sectionTitle, 'Title');
  const body = cleanText(input.body, LIMITS.sectionBody, 'Body');
  if (!title && !body) throw new SitePageError('A section needs a title or some text.');
  const icon = cleanIcon(input.icon);
  const max = await prisma.sitePageSection.aggregate({ where: { pageId: page.id }, _max: { sortOrder: true } });
  return prisma.sitePageSection.create({
    data: {
      pageId: page.id,
      title: title || null,
      body: body || null,
      icon: icon || null,
      sortOrder: ((max && max._max && max._max.sortOrder) || 0) + 10,
      isPublished: input.isPublished === undefined ? true : parseFormBool(input.isPublished),
    },
  });
}

async function updateSection(slug, sectionId, input = {}) {
  assertSlug(slug);
  await sectionOwned(slug, sectionId);
  const data = {};
  const title = cleanText(input.title, LIMITS.sectionTitle, 'Title');
  if (title !== undefined) data.title = title || null;
  const body = cleanText(input.body, LIMITS.sectionBody, 'Body');
  if (body !== undefined) data.body = body || null;
  const icon = cleanIcon(input.icon);
  if (icon !== undefined) data.icon = icon || null;
  if (input.isPublished !== undefined) data.isPublished = parseFormBool(input.isPublished);
  return prisma.sitePageSection.update({ where: { id: sectionId }, data });
}

async function deleteSection(slug, sectionId) {
  assertSlug(slug);
  await sectionOwned(slug, sectionId);
  await prisma.sitePageSection.delete({ where: { id: sectionId } });
}

async function moveSection(slug, sectionId, direction) {
  assertSlug(slug);
  const section = await sectionOwned(slug, sectionId);
  const rows = await prisma.sitePageSection.findMany({ where: { pageId: section.pageId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  const idx = rows.findIndex((r) => r.id === sectionId);
  const swap = direction === 'up' ? idx - 1 : direction === 'down' ? idx + 1 : -1;
  if (swap < 0 || swap >= rows.length) return false;
  const order = rows.map((r) => r.id);
  [order[idx], order[swap]] = [order[swap], order[idx]];
  await prisma.$transaction(order.map((id, i) => prisma.sitePageSection.update({ where: { id }, data: { sortOrder: (i + 1) * 10 } })));
  return true;
}

module.exports = {
  PAGE_META,
  PAGE_SLUGS,
  LIMITS,
  SitePageError,
  starterDefaults,
  starterSections,
  getPublicPage,
  isPageEnabled,
  listPagesAdmin,
  ensurePage,
  getPageAdmin,
  updatePage,
  addSection,
  updateSection,
  deleteSection,
  moveSection,
};
