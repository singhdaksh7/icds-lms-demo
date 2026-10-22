// Public Founder page data. Pure helpers (resolveSectionOrder,
// buildFounderViewModel) are exported for tests; getFounderPageData hits the DB.
const { prisma } = require('../config/db');

const SECTION_KEYS = ['HERO', 'BIOGRAPHY', 'QUALIFICATIONS', 'TIMELINE', 'INITIATIVES', 'RESEARCH', 'IMPACT', 'FAQ', 'CTA'];
const RESEARCH_KINDS = ['JOURNAL_NATIONAL', 'JOURNAL_INTERNATIONAL', 'TEACHING', 'TRAINING'];
const RESEARCH_KIND_LABELS = {
  JOURNAL_NATIONAL: 'National Journals',
  JOURNAL_INTERNATIONAL: 'International Journals',
  TEACHING: 'Clinical Teaching',
  TRAINING: 'Professional Training',
};

function parseKeyList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// order: JSON array (or array) of keys; unknown/duplicate keys dropped; keys
// missing from the saved order are appended in default order. hidden removed.
function resolveSectionOrder(orderJson, hiddenJson) {
  const hidden = new Set(parseKeyList(hiddenJson).filter((k) => typeof k === 'string'));
  const seen = new Set();
  const result = [];
  const push = (k) => {
    if (typeof k !== 'string' || !SECTION_KEYS.includes(k) || seen.has(k)) return;
    seen.add(k);
    if (!hidden.has(k)) result.push(k);
  };
  parseKeyList(orderJson).forEach(push);
  SECTION_KEYS.forEach(push);
  return result;
}

const has = (v) => typeof v === 'string' && v.trim().length > 0;
const list = (v) => (Array.isArray(v) ? v : []);

function splitParagraphs(text) {
  if (!has(text)) return [];
  return text.split(/\r?\n\s*\r?\n|\r?\n/).map((p) => p.trim()).filter(Boolean);
}

function safeHref(url) {
  if (!has(url)) return null;
  const u = url.trim();
  if (u.startsWith('/') && !u.startsWith('//')) return u;
  if (/^https?:\/\//i.test(u)) return u;
  return null;
}

// Hides any section lacking content: no placeholders or fallback claims.
function buildFounderViewModel(raw = {}) {
  const instructor = raw.instructor || null;
  const qualifications = list(raw.qualifications).filter((q) => q && has(q.title));
  const timeline = list(raw.timeline).filter((t) => t && has(t.yearLabel) && has(t.title));
  const initiatives = list(raw.initiatives)
    .filter((i) => i && has(i.title) && has(i.description))
    .map((i) => ({ ...i, ctaHref: has(i.ctaLabel) ? safeHref(i.ctaUrl) : null }));
  const research = list(raw.research).filter((r) => r && has(r.title));
  const stats = list(raw.stats).filter((s) => s && has(s.valueText) && has(s.label));
  const faqs = list(raw.faqs).filter((f) => f && has(f.question) && has(f.answer));
  const settings = raw.settings || {};

  const researchGroups = RESEARCH_KINDS
    .map((kind) => ({ kind, label: RESEARCH_KIND_LABELS[kind], items: research.filter((r) => r.kind === kind) }))
    .filter((g) => g.items.length);

  const paragraphs = instructor ? splitParagraphs(instructor.bio) : [];
  const hasInstructor = Boolean(instructor && has(instructor.name));

  const content = {
    HERO: hasInstructor,
    BIOGRAPHY: hasInstructor && paragraphs.length > 0,
    QUALIFICATIONS: qualifications.length > 0,
    TIMELINE: timeline.length > 0,
    INITIATIVES: initiatives.length > 0,
    RESEARCH: researchGroups.length > 0,
    IMPACT: stats.length > 0,
    FAQ: faqs.length > 0,
    CTA: hasInstructor,
  };

  const order = Array.isArray(raw.sections)
    ? raw.sections
    : resolveSectionOrder(settings['founder.sections.order'], settings['founder.sections.hidden']);
  const sections = order.filter((k) => content[k]);

  return {
    instructor: hasInstructor
      ? {
          ...instructor,
          bioParagraphs: paragraphs,
          linkedinHref: safeHref(instructor.linkedinUrl),
          instagramHref: safeHref(instructor.instagramUrl),
        }
      : null,
    sections,
    qualifications,
    timeline,
    initiatives,
    researchGroups,
    stats,
    faqs,
  };
}

function buildFaqJsonLd(faqs) {
  const rows = list(faqs).filter((f) => f && has(f.question) && has(f.answer));
  if (!rows.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: rows.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
}

async function findFounderInstructor() {
  const active = { status: 'ACTIVE' };
  const flagged = await prisma.instructor.findFirst({ where: { isFounder: true, ...active }, orderBy: { id: 'asc' } });
  if (flagged) return flagged;
  // Identification fallback only (content still comes from the row's own fields).
  return prisma.instructor.findFirst({
    where: { ...active, OR: [{ slug: 'dr-tanu-raghav' }, { name: { contains: 'Tanu Raghav' } }] },
    orderBy: { id: 'asc' },
  });
}

async function getFounderPageData({ includeUnpublished = false } = {}) {
  const instructor = await findFounderInstructor();
  if (!instructor) return null;
  const pub = includeUnpublished ? {} : { isPublished: true };
  const order = [{ sortOrder: 'asc' }, { id: 'asc' }];
  const [qualifications, timeline, initiatives, research, stats, faqs, settingRows] = await Promise.all([
    prisma.founderQualification.findMany({ where: pub, orderBy: order }),
    prisma.founderTimelineEntry.findMany({ where: { ...pub, instructorId: instructor.id }, orderBy: order }),
    prisma.founderInitiative.findMany({ where: pub, orderBy: order }),
    prisma.founderResearchItem.findMany({ where: { ...pub, instructorId: instructor.id }, orderBy: order }),
    prisma.founderStat.findMany({ where: pub, orderBy: order }),
    prisma.founderFaq.findMany({ where: pub, orderBy: order }),
    prisma.siteSetting.findMany({ where: { key: { in: ['founder.sections.order', 'founder.sections.hidden'] } } }),
  ]);
  const settings = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));
  const sections = resolveSectionOrder(settings['founder.sections.order'], settings['founder.sections.hidden']);
  return { instructor, sections, qualifications, timeline, initiatives, research, stats, faqs, settings };
}

module.exports = {
  SECTION_KEYS,
  RESEARCH_KINDS,
  RESEARCH_KIND_LABELS,
  resolveSectionOrder,
  buildFounderViewModel,
  buildFaqJsonLd,
  getFounderPageData,
};
