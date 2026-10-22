const { prisma } = require('../config/db');
const { isSafeUrl } = require('./homeBanner.service');

class FounderAdminError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'FounderAdminError';
    this.status = status;
  }
}

const SECTION_KEYS = ['HERO', 'BIOGRAPHY', 'QUALIFICATIONS', 'TIMELINE', 'INITIATIVES', 'RESEARCH', 'IMPACT', 'FAQ', 'CTA'];
const SECTION_ORDER_KEY = 'founder.sections.order';
const SECTION_HIDDEN_KEY = 'founder.sections.hidden';
const RESEARCH_KINDS = ['JOURNAL_NATIONAL', 'JOURNAL_INTERNATIONAL', 'TEACHING', 'TRAINING'];
const ICON_KEY_RE = /^[a-z0-9-]{1,50}$/;

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const isTrue = (v) => Array.isArray(v) ? v.some((x) => x === 'true' || x === 'on') : v === true || v === 'true' || v === 'on' || v === '1';

// Small helper for pure validators.
function makeCtx(input) {
  const errors = [];
  const values = {};
  return {
    errors,
    values,
    req(key, max, label) {
      const v = str(input[key]);
      if (!v) errors.push(`${label} is required.`);
      else if (v.length > max) errors.push(`${label} must be at most ${max} characters.`);
      values[key] = v;
    },
    opt(key, max, label) {
      const v = str(input[key]);
      if (v.length > max) errors.push(`${label} must be at most ${max} characters.`);
      values[key] = v || null;
    },
    url(key, label) {
      const v = str(input[key]);
      if (v && (v.length > 500 || !isSafeUrl(v))) errors.push(`${label} must be a relative path or an http(s) URL.`);
      values[key] = v || null;
    },
    pub() {
      values.isPublished = input.isPublished === undefined ? true : isTrue(input.isPublished);
    },
  };
}

function validateQualificationInput(input = {}) {
  const c = makeCtx(input);
  c.req('title', 300, 'Title'); c.opt('subtitle', 500, 'Subtitle'); c.pub();
  return { errors: c.errors, values: c.values };
}
function validateTimelineInput(input = {}) {
  const c = makeCtx(input);
  c.req('yearLabel', 100, 'Year'); c.req('title', 300, 'Title'); c.opt('description', 5000, 'Description'); c.pub();
  return { errors: c.errors, values: c.values };
}
function validateInitiativeInput(input = {}) {
  const c = makeCtx(input);
  c.req('title', 300, 'Title'); c.req('description', 5000, 'Description');
  c.url('imageUrl', 'Image'); c.opt('ctaLabel', 100, 'Button label'); c.url('ctaUrl', 'Button link');
  c.opt('iconKey', 50, 'Icon key');
  if (c.values.iconKey && !ICON_KEY_RE.test(c.values.iconKey)) c.errors.push('Icon key may only contain lowercase letters, digits and hyphens.');
  if (c.values.ctaUrl && !c.values.ctaLabel) c.errors.push('Button needs a label when a link is set.');
  c.pub();
  return { errors: c.errors, values: c.values };
}
function validateStatInput(input = {}) {
  const c = makeCtx(input);
  c.req('valueText', 50, 'Value'); c.req('label', 200, 'Label'); c.pub();
  return { errors: c.errors, values: c.values };
}
function validateFaqInput(input = {}) {
  const c = makeCtx(input);
  c.req('question', 500, 'Question'); c.req('answer', 5000, 'Answer'); c.pub();
  return { errors: c.errors, values: c.values };
}
function validateResearchInput(input = {}) {
  const c = makeCtx(input);
  c.req('title', 500, 'Title'); c.opt('description', 5000, 'Description'); c.pub();
  const kind = str(input.kind);
  if (!RESEARCH_KINDS.includes(kind)) c.errors.push('Type is invalid.');
  c.values.kind = kind;
  return { errors: c.errors, values: c.values };
}
function validateFounderProfileInput(input = {}) {
  const c = makeCtx(input);
  c.opt('founderIntro', 5000, 'Founder intro'); c.opt('qualificationsLine', 500, 'Qualifications line');
  const id = Number(input.instructorId);
  if (!Number.isInteger(id) || id < 1) c.errors.push('Choose an instructor.');
  c.values.instructorId = id;
  c.values.isFounder = isTrue(input.isFounder);
  return { errors: c.errors, values: c.values };
}

const ENTITIES = {
  qualifications: { model: 'founderQualification', validate: validateQualificationInput, scoped: false, label: 'Qualification', order: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  timeline: { model: 'founderTimelineEntry', validate: validateTimelineInput, scoped: true, label: 'Timeline entry', order: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  initiatives: { model: 'founderInitiative', validate: validateInitiativeInput, scoped: false, label: 'Initiative', order: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  stats: { model: 'founderStat', validate: validateStatInput, scoped: false, label: 'Stat', order: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  faqs: { model: 'founderFaq', validate: validateFaqInput, scoped: false, label: 'FAQ', order: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  research: { model: 'founderResearchItem', validate: validateResearchInput, scoped: true, label: 'Research item', order: [{ kind: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }] },
};

function entity(name) {
  const e = Object.prototype.hasOwnProperty.call(ENTITIES, name) ? ENTITIES[name] : null;
  if (!e) throw new FounderAdminError('Unknown section', 404);
  return e;
}

async function getFounderInstructor() {
  return prisma.instructor.findFirst({ where: { isFounder: true }, orderBy: { id: 'asc' } });
}

async function listInstructorOptions() {
  return prisma.instructor.findMany({ select: { id: true, name: true, isFounder: true }, orderBy: { name: 'asc' } });
}

async function saveFounderProfile(input) {
  const { errors, values } = validateFounderProfileInput(input);
  if (errors.length) throw new FounderAdminError(errors.join(' '));
  const target = await prisma.instructor.findUnique({ where: { id: values.instructorId }, select: { id: true } });
  if (!target) throw new FounderAdminError('Instructor not found', 404);
  await prisma.$transaction(async (tx) => {
    if (values.isFounder) await tx.instructor.updateMany({ where: { isFounder: true, id: { not: values.instructorId } }, data: { isFounder: false } });
    await tx.instructor.update({
      where: { id: values.instructorId },
      data: { isFounder: values.isFounder, founderIntro: values.founderIntro, qualificationsLine: values.qualificationsLine },
    });
  });
}

async function listAll() {
  const founder = await getFounderInstructor();
  const out = { founder };
  for (const [name, e] of Object.entries(ENTITIES)) {
    const where = e.scoped ? (founder ? { instructorId: founder.id } : { id: -1 }) : {};
    out[name] = await prisma[e.model].findMany({ where, orderBy: e.order });
  }
  return out;
}

async function createItem(name, input) {
  const e = entity(name);
  const { errors, values } = e.validate(input);
  if (errors.length) throw new FounderAdminError(errors.join(' '));
  const data = { ...values };
  if (e.scoped) {
    const founder = await getFounderInstructor();
    if (!founder) throw new FounderAdminError('Mark an instructor as the founder first.');
    data.instructorId = founder.id;
  }
  const agg = await prisma[e.model].aggregate({ _max: { sortOrder: true } });
  data.sortOrder = (agg._max.sortOrder == null ? -1 : agg._max.sortOrder) + 1;
  return prisma[e.model].create({ data });
}

async function updateItem(name, id, input) {
  const e = entity(name);
  const { errors, values } = e.validate(input);
  if (errors.length) throw new FounderAdminError(errors.join(' '));
  const row = await prisma[e.model].findUnique({ where: { id } });
  if (!row) throw new FounderAdminError('Item not found', 404);
  return prisma[e.model].update({ where: { id }, data: values });
}

async function deleteItem(name, id) {
  const e = entity(name);
  const row = await prisma[e.model].findUnique({ where: { id } });
  if (!row) throw new FounderAdminError('Item not found', 404);
  await prisma[e.model].delete({ where: { id } });
}

async function togglePublished(name, id) {
  const e = entity(name);
  const row = await prisma[e.model].findUnique({ where: { id } });
  if (!row) throw new FounderAdminError('Item not found', 404);
  return prisma[e.model].update({ where: { id }, data: { isPublished: !row.isPublished } });
}

// Moves within the same list (same instructor / same research kind); ties normalised.
async function moveItem(name, id, direction) {
  if (direction !== 'up' && direction !== 'down') throw new FounderAdminError('Invalid direction');
  const e = entity(name);
  return prisma.$transaction(async (tx) => {
    const row = await tx[e.model].findUnique({ where: { id } });
    if (!row) throw new FounderAdminError('Item not found', 404);
    const where = {};
    if (e.scoped) where.instructorId = row.instructorId;
    if (name === 'research') where.kind = row.kind;
    const all = await tx[e.model].findMany({ where, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, sortOrder: true } });
    const idx = all.findIndex((r) => r.id === id);
    const t = direction === 'up' ? idx - 1 : idx + 1;
    if (t >= 0 && t < all.length) [all[idx], all[t]] = [all[t], all[idx]];
    for (let i = 0; i < all.length; i += 1) {
      if (all[i].sortOrder !== i) await tx[e.model].update({ where: { id: all[i].id }, data: { sortOrder: i } });
    }
  });
}

// --- Section visibility / order (SiteSetting JSON arrays) -------------------
function parseKeyList(raw) {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((k, i) => SECTION_KEYS.includes(k) && arr.indexOf(k) === i);
  } catch (e) {
    return [];
  }
}

// Returns { order: [all keys, custom order first], hidden: [keys] }.
async function getSectionConfig() {
  const rows = await prisma.siteSetting.findMany({ where: { key: { in: [SECTION_ORDER_KEY, SECTION_HIDDEN_KEY] } } });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const custom = parseKeyList(map[SECTION_ORDER_KEY]);
  const order = [...custom, ...SECTION_KEYS.filter((k) => !custom.includes(k))];
  return { order, hidden: parseKeyList(map[SECTION_HIDDEN_KEY]) };
}

async function writeSetting(key, value) {
  await prisma.siteSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

async function saveSectionConfig(order, hidden) {
  const o = parseKeyList(JSON.stringify(order || []));
  const full = [...o, ...SECTION_KEYS.filter((k) => !o.includes(k))];
  const h = parseKeyList(JSON.stringify(hidden || []));
  await writeSetting(SECTION_ORDER_KEY, JSON.stringify(full));
  await writeSetting(SECTION_HIDDEN_KEY, JSON.stringify(h));
}

async function moveSection(key, direction) {
  if (!SECTION_KEYS.includes(key)) throw new FounderAdminError('Unknown section');
  if (direction !== 'up' && direction !== 'down') throw new FounderAdminError('Invalid direction');
  const { order, hidden } = await getSectionConfig();
  const i = order.indexOf(key);
  const t = direction === 'up' ? i - 1 : i + 1;
  if (t >= 0 && t < order.length) [order[i], order[t]] = [order[t], order[i]];
  await saveSectionConfig(order, hidden);
}

async function toggleSection(key) {
  if (!SECTION_KEYS.includes(key)) throw new FounderAdminError('Unknown section');
  const { order, hidden } = await getSectionConfig();
  const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
  await saveSectionConfig(order, next);
}

module.exports = {
  FounderAdminError,
  SECTION_KEYS,
  SECTION_ORDER_KEY,
  SECTION_HIDDEN_KEY,
  RESEARCH_KINDS,
  ENTITIES,
  validateQualificationInput,
  validateTimelineInput,
  validateInitiativeInput,
  validateStatInput,
  validateFaqInput,
  validateResearchInput,
  validateFounderProfileInput,
  getFounderInstructor,
  listInstructorOptions,
  saveFounderProfile,
  listAll,
  createItem,
  updateItem,
  deleteItem,
  togglePublished,
  moveItem,
  getSectionConfig,
  saveSectionConfig,
  moveSection,
  toggleSection,
};
