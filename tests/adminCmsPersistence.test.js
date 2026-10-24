process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

// Regression suite for the Admin CMS -> public page source-of-truth bugs:
//  - credential/item publish state must survive an edit ("on" / ["false","on"])
//  - per-tab settings forms must not wipe fields owned by other tabs
//  - every Edit button in the landing editor must have a matching modal/form
//  - production seed scripts must not overwrite owner-edited content

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

const { prisma } = require('../src/config/db');
const { parseFormBool } = require('../src/lib/formBool');
const instructorService = require('../src/services/instructor.service');
const landing = require('../src/services/courseLanding.service');

// ---------------------------------------------------------------------------
// Minimal in-memory Prisma delegate (create/update/findUnique/findMany/count/delete)
// ---------------------------------------------------------------------------
function memoryDelegate(seed = []) {
  const rows = seed.map((r) => ({ ...r }));
  let nextId = rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  const matches = (row, where = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
  return {
    rows,
    async create({ data }) { const row = { id: nextId++, ...data }; rows.push(row); return { ...row }; },
    async findUnique({ where }) { const r = rows.find((x) => x.id === where.id); return r ? { ...r } : null; },
    async findMany({ where, orderBy } = {}) {
      const out = rows.filter((r) => matches(r, where)).map((r) => ({ ...r }));
      if (orderBy && orderBy.sortOrder) out.sort((a, b) => a.sortOrder - b.sortOrder);
      return out;
    },
    async count({ where } = {}) { return rows.filter((r) => matches(r, where)).length; },
    async update({ where, data }) {
      const r = rows.find((x) => x.id === where.id);
      Object.assign(r, data);
      return { ...r };
    },
    async delete({ where }) { rows.splice(rows.findIndex((x) => x.id === where.id), 1); },
  };
}

function swap(obj, key, impl) {
  const orig = obj[key];
  obj[key] = impl;
  return () => { obj[key] = orig; };
}

// ---------------------------------------------------------------------------
// Boolean parsing
// ---------------------------------------------------------------------------
test('parseFormBool: checkbox "on", hidden-false pair, and absent field', () => {
  assert.equal(parseFormBool('on'), true);
  assert.equal(parseFormBool('true'), true);
  assert.equal(parseFormBool('1'), true);
  assert.equal(parseFormBool('false'), false);
  assert.equal(parseFormBool(['false', 'on']), true, 'ticked checkbox beside hidden false');
  assert.equal(parseFormBool(['false']), false, 'unticked checkbox: only hidden false');
  assert.equal(parseFormBool(undefined, true), true, 'absent -> caller fallback');
  assert.equal(parseFormBool(undefined), false);
});

// ---------------------------------------------------------------------------
// InstructorCredential
// ---------------------------------------------------------------------------
test('credentials: create published, edit title stays published, hide, republish, reorder', async () => {
  const creds = memoryDelegate();
  const restore = swap(prisma, 'instructorCredential', creds);
  try {
    const a = await instructorService.addCredential(1, { title: 'BDS', isPublished: ['false', 'on'] });
    const b = await instructorService.addCredential(1, { title: '11+ Years in Private Clinical Practice', isPublished: ['false', 'on'] });
    assert.equal(a.isPublished, true);
    assert.equal(b.isPublished, true);

    // Edit-modal submit: title changed, checkbox ticked -> body.isPublished === ['false','on']
    await instructorService.updateCredential(1, b.id, { title: '11+ Years in Private Clinical Practice & Dental Research', description: '', icon: 'bi-briefcase-fill', isPublished: ['false', 'on'] });
    let row = await creds.findUnique({ where: { id: b.id } });
    assert.equal(row.title, '11+ Years in Private Clinical Practice & Dental Research');
    assert.equal(row.isPublished, true, 'editing the title must not hide the credential');

    // Plain checkbox value "on" (single value) must also mean published
    await instructorService.updateCredential(1, b.id, { title: row.title, isPublished: 'on' });
    assert.equal((await creds.findUnique({ where: { id: b.id } })).isPublished, true);

    // Hide: unticked -> only the hidden "false"
    await instructorService.updateCredential(1, b.id, { title: row.title, isPublished: 'false' });
    assert.equal((await creds.findUnique({ where: { id: b.id } })).isPublished, false);

    // Title-only update (no isPublished submitted) preserves the stored state
    await instructorService.updateCredential(1, b.id, { title: 'Hidden but renamed' });
    assert.equal((await creds.findUnique({ where: { id: b.id } })).isPublished, false);

    // Republish
    await instructorService.updateCredential(1, b.id, { isPublished: ['false', 'on'] });
    assert.equal((await creds.findUnique({ where: { id: b.id } })).isPublished, true);

    // Unticked on create is honoured too
    const c = await instructorService.addCredential(1, { title: 'Draft item', isPublished: ['false'] });
    assert.equal(c.isPublished, false);

    // Reorder
    await instructorService.moveCredential(1, b.id, 'up');
    const ordered = await creds.findMany({ where: { instructorId: 1 }, orderBy: { sortOrder: 'asc' } });
    assert.equal(ordered[0].id, b.id);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Landing settings: per-tab forms must not clobber other tabs
// ---------------------------------------------------------------------------
test('upsertLandingSettings writes ONLY the submitted fields', async () => {
  let captured;
  const restore = swap(prisma.courseLandingContent, 'upsert', async ({ create, update }) => {
    captured = { create, update };
    return {};
  });
  try {
    // Why Register tab submit
    await landing.upsertLandingSettings(7, {
      currentTab: 'why-register',
      whyRegisterEnabled: ['false', 'on'],
      whyRegisterHeading: 'Why Register QA Test',
      whyRegisterIntro: 'Intro text',
    });
    assert.deepEqual(Object.keys(captured.update).sort(), ['whyRegisterEnabled', 'whyRegisterHeading', 'whyRegisterIntro']);
    assert.equal(captured.update.whyRegisterHeading, 'Why Register QA Test');
    assert.equal(captured.update.whyRegisterEnabled, true);
    assert.ok(!('takeawaysHeading' in captured.update), 'takeaways fields must be left untouched');
    assert.ok(!('highlightsEnabled' in captured.update), 'other tabs\' toggles must be left untouched');

    // Section disabled explicitly
    await landing.upsertLandingSettings(7, { whyRegisterEnabled: 'false' });
    assert.equal(captured.update.whyRegisterEnabled, false);

    // Learning outcomes tab
    await landing.upsertLandingSettings(7, { takeawaysEnabled: ['false', 'on'], takeawaysHeading: 'Edited outcomes heading' });
    assert.equal(captured.update.takeawaysHeading, 'Edited outcomes heading');
    assert.equal(captured.update.takeawaysEnabled, true);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Repeatable items: takeaways / why-register
// ---------------------------------------------------------------------------
test('takeaways: edit title+description, hide, publish, reorder', async () => {
  const store = memoryDelegate([
    { id: 1, courseId: 5, title: 'Foundational Occlusal Philosophy', description: 'd1', icon: '01', sortOrder: 10, isPublished: true },
    { id: 2, courseId: 5, title: 'Tooth Wear & Bite Collapse', description: 'd2', icon: '02', sortOrder: 20, isPublished: true },
  ]);
  const restore = swap(prisma, 'courseTakeaway', store);
  try {
    await landing.updateTakeaway(5, 1, { title: 'Foundational Occlusal Philosophy [QA]', description: 'new desc', icon: '01', isPublished: ['false', 'on'] });
    let row = await store.findUnique({ where: { id: 1 } });
    assert.equal(row.title, 'Foundational Occlusal Philosophy [QA]');
    assert.equal(row.description, 'new desc');
    assert.equal(row.isPublished, true);

    await landing.updateTakeaway(5, 1, { title: row.title, description: row.description, isPublished: 'false' });
    assert.equal((await store.findUnique({ where: { id: 1 } })).isPublished, false);
    await landing.updateTakeaway(5, 1, { isPublished: ['false', 'on'] });
    assert.equal((await store.findUnique({ where: { id: 1 } })).isPublished, true);

    await landing.moveTakeaway(5, 2, 'up');
    const ordered = await store.findMany({ where: { courseId: 5 }, orderBy: { sortOrder: 'asc' } });
    assert.equal(ordered[0].id, 2);
  } finally {
    restore();
  }
});

test('why-register: edit keeps WANT/GET, hide, publish, reorder', async () => {
  const store = memoryDelegate([
    { id: 1, courseId: 5, type: 'WANT', title: 'W1', description: null, icon: null, sortOrder: 10, isPublished: true },
    { id: 2, courseId: 5, type: 'WANT', title: 'W2', description: null, icon: null, sortOrder: 20, isPublished: true },
    { id: 3, courseId: 5, type: 'GET', title: 'G1', description: null, icon: null, sortOrder: 10, isPublished: true },
  ]);
  const restore = swap(prisma, 'courseWhyRegisterItem', store);
  try {
    // Edit-modal submit includes the select (type) + title + description + published pair
    await landing.updateWhyRegisterItem(5, 1, { type: 'WANT', title: 'QA WANT ITEM', description: 'x', isPublished: ['false', 'on'] });
    let row = await store.findUnique({ where: { id: 1 } });
    assert.equal(row.type, 'WANT');
    assert.equal(row.title, 'QA WANT ITEM');
    assert.equal(row.isPublished, true);

    await landing.updateWhyRegisterItem(5, 3, { title: 'G1 edited' });
    row = await store.findUnique({ where: { id: 3 } });
    assert.equal(row.type, 'GET', 'type preserved when not submitted');
    assert.equal(row.isPublished, true, 'publish state preserved when not submitted');

    await landing.updateWhyRegisterItem(5, 1, { isPublished: 'false' });
    assert.equal((await store.findUnique({ where: { id: 1 } })).isPublished, false);
    await landing.updateWhyRegisterItem(5, 1, { isPublished: ['false', 'on'] });
    assert.equal((await store.findUnique({ where: { id: 1 } })).isPublished, true);

    await landing.moveWhyRegisterItem(5, 2, 'up');
    const wants = (await store.findMany({ where: { courseId: 5, type: 'WANT' }, orderBy: { sortOrder: 'asc' } }));
    assert.equal(wants[0].id, 2);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Public data uses the DB value
// ---------------------------------------------------------------------------
test('getPublicLandingData returns saved CMS values and only published items', async () => {
  const empty = async () => [];
  const restores = [
    swap(prisma.courseLandingContent, 'findUnique', async () => ({ whyRegisterHeading: 'Saved heading', takeawaysHeading: 'Saved outcomes heading' })),
    swap(prisma.courseHeroChip, 'findMany', empty),
    swap(prisma.courseTakeaway, 'findMany', async ({ where }) => {
      assert.equal(where.isPublished, true, 'public query must filter on isPublished');
      return [{ id: 1, title: 'Edited outcome' }];
    }),
    swap(prisma.courseQuestion, 'findMany', empty),
    swap(prisma.courseAudienceItem, 'findMany', empty),
    swap(prisma.courseFaq, 'findMany', empty),
    swap(prisma.courseWhyRegisterItem, 'findMany', async () => [
      { id: 1, type: 'WANT', title: 'QA WANT ITEM' },
      { id: 2, type: 'GET', title: 'A get item' },
    ]),
    swap(prisma.courseHighlight, 'findMany', empty),
    swap(prisma.courseTestimonial, 'findMany', empty),
    swap(prisma.courseAccessPlan, 'findMany', empty),
    swap(prisma.courseStat, 'findMany', empty),
    swap(prisma.courseComparisonColumn, 'findMany', empty),
    swap(prisma.courseAccessStep, 'findMany', empty),
    swap(prisma.courseLandingSection, 'findMany', empty),
    swap(prisma.courseTestimonial, 'aggregate', async () => ({ _count: { id: 0 }, _avg: { rating: null } })),
  ];
  try {
    const data = await landing.getPublicLandingData(5);
    assert.equal(data.content.whyRegisterHeading, 'Saved heading');
    assert.equal(data.content.takeawaysHeading, 'Saved outcomes heading');
    assert.equal(data.takeaways[0].title, 'Edited outcome');
    assert.equal(data.whyRegisterWant[0].title, 'QA WANT ITEM');
    assert.equal(data.whyRegisterGet[0].title, 'A get item');
  } finally {
    restores.reverse().forEach((r) => r());
  }
});

// ---------------------------------------------------------------------------
// Admin landing editor: every Edit button has a matching form
// ---------------------------------------------------------------------------
test('landing editor renders a Learning Outcomes tab and an edit modal for every repeatable item', async () => {
  const item = (id, extra = {}) => ({ id, courseId: 5, sortOrder: id * 10, isPublished: id % 2 === 1, ...extra });
  const locals = {
    csrfToken: 'tok',
    activeTab: 'takeaways',
    course: { id: 5, title: 'Advanced FMR Master Class', slug: 'advanced-fmr-master-class', status: 'PUBLISHED', instructor: null },
    landingContent: {},
    heroChips: [item(1, { label: 'Chip' })],
    takeaways: [item(1, { title: 'T1', description: 'D1', icon: '01' }), item(2, { title: 'T2', description: 'D2' })],
    questions: [item(1, { question: 'Q?' })],
    audienceItems: [item(1, { type: 'FOR', title: 'A' })],
    faqs: [item(1, { question: 'Q', answer: 'A' })],
    whyRegisterItems: [item(1, { type: 'WANT', title: 'W' }), item(2, { type: 'GET', title: 'G' })],
    highlights: [item(1, { title: 'H' })],
    testimonials: [],
    accessPlans: [item(1, { label: 'Plan', durationDays: 365, price: 10, salePrice: null, isDefault: true })],
    courseStats: [item(1, { statType: 'MANUAL', value: '15+', label: 'Videos', icon: 'bi-x' })],
    comparisonColumns: [],
    accessSteps: [],
    landingSections: [],
    resources: [],
  };
  const file = path.join(__dirname, '..', 'views', 'admin', 'courses', 'landing-page-content.ejs');
  const html = await ejs.renderFile(file, locals);

  assert.match(html, /id="tab-takeaways"/);
  for (const [prefix, ids] of [
    ['editChipModal', [1]], ['editTakeawayModal', [1, 2]], ['editQuestionModal', [1]],
    ['editAudienceModal', [1]], ['editFaqModal', [1]], ['editWhyItemModal', [1, 2]],
    ['editHighlightModal', [1]], ['editAccessPlanModal', [1]], ['editStatModal', [1]],
  ]) {
    for (const id of ids) {
      assert.ok(html.includes(`id="${prefix}-${id}"`), `${prefix}-${id} modal must exist`);
    }
  }
  assert.match(html, /landing-page\/takeaways\/1\/edit/);
  assert.match(html, /landing-page\/why-register\/2\/edit/);
  // The Published state is always submitted explicitly (hidden false + checkbox)
  assert.match(html, /<input type="hidden" name="isPublished" value="false">/);
  // Every Edit button target resolves to a modal in the page
  const targets = [...html.matchAll(/data-bs-target="#(edit\w+Modal-\d+)"/g)].map((m) => m[1]);
  assert.ok(targets.length > 0);
  for (const t of targets) assert.ok(html.includes(`id="${t}"`), `dangling edit target ${t}`);
});

test('instructor credential forms send an explicit Published state', async () => {
  const file = path.join(__dirname, '..', 'views', 'admin', 'instructors', 'form-content.ejs');
  const html = await ejs.renderFile(file, {
    csrfToken: 'tok',
    errors: [],
    statuses: ['ACTIVE', 'INACTIVE'],
    values: { id: 1, name: 'Dr. T' },
    cms: { brand: {} },
    instructor: {
      id: 1, name: 'Dr. T', photoUrl: null,
      credentials: [{ id: 9, title: 'BDS', description: null, icon: null, sortOrder: 10, isPublished: true }],
    },
  });
  const occurrences = html.match(/<input type="hidden" name="isPublished" value="false">/g) || [];
  assert.equal(occurrences.length, 2, 'edit + create credential forms each pair the checkbox with hidden false');
});

// ---------------------------------------------------------------------------
// Seed scripts must be bootstrap-only without --force
// ---------------------------------------------------------------------------
test('seed-fmr-landing-content does not overwrite or delete existing CMS content without --force', async () => {
  const { seedFmrLandingContent } = require('../scripts/seed-fmr-landing-content');
  const calls = [];
  const trap = (name) => async () => { calls.push(name); return {}; };
  const populated = { count: async () => 3, deleteMany: trap('deleteMany'), create: trap('create') };
  const restores = [
    swap(prisma.course, 'findFirst', async () => ({ id: 5, title: 'Advanced FMR Master Class' })),
    swap(prisma.courseLandingContent, 'upsert', async ({ update }) => {
      calls.push(`upsert-update:${JSON.stringify(update)}`);
      return { courseId: 5 };
    }),
    swap(prisma, 'courseHeroChip', populated),
    swap(prisma, 'courseTakeaway', populated),
    swap(prisma, 'courseQuestion', populated),
    swap(prisma, 'courseAudienceItem', populated),
    swap(prisma, 'courseFaq', populated),
  ];
  try {
    await seedFmrLandingContent();
    assert.deepEqual(calls, ['upsert-update:{}'], `unexpected writes: ${calls.join(', ')}`);
  } finally {
    restores.reverse().forEach((r) => r());
  }
});
