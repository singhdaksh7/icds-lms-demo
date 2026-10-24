process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

// The Course Edit -> Landing Page CMS is the complete source of truth for the
// public course page:
//  - every landing field the public template reads has an Admin control
//  - every Admin control is persisted (service mapping + Prisma column)
//  - saved values render; empty values hide (no hardcoded marketing fallback)
//  - courses are isolated from each other

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const { prisma } = require('../src/config/db');
const landing = require('../src/services/courseLanding.service');

const root = path.join(__dirname, '..');
const publicView = fs.readFileSync(path.join(root, 'views/public/course-detail-content.ejs'), 'utf8');
const adminView = fs.readFileSync(path.join(root, 'views/admin/courses/landing-page-content.ejs'), 'utf8');
const serviceSrc = fs.readFileSync(path.join(root, 'src/services/courseLanding.service.js'), 'utf8');
const schemaSrc = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');

function swap(obj, key, impl) {
  const orig = obj[key];
  obj[key] = impl;
  return () => { obj[key] = orig; };
}

function adminSettingsFieldNames() {
  const names = new Set();
  for (const f of adminView.matchAll(/<form[^>]*action="[^"]*landing-page\/settings"[\s\S]*?<\/form>/g)) {
    for (const m of f[0].matchAll(/name="(\w+)"/g)) names.add(m[1]);
  }
  names.delete('_csrf');
  names.delete('currentTab');
  return names;
}

// ---------------------------------------------------------------------------
// Field coverage
// ---------------------------------------------------------------------------
test('every landing field the PUBLIC template reads has an Admin control, a service mapping and a column', () => {
  const used = new Set([...publicView.matchAll(/\blc\.(\w+)/g)].map((m) => m[1]));
  const admin = adminSettingsFieldNames();
  const mapped = new Set([...serviceSrc.matchAll(/payload\.(\w+)/g)].map((m) => m[1]));
  const model = schemaSrc.match(/model CourseLandingContent \{([\s\S]*?)\n\}/)[1];
  const columns = new Set([...model.matchAll(/^\s+(\w+)\s+\S+/gm)].map((m) => m[1]));
  assert.ok(used.size > 60);
  assert.deepEqual([...used].filter((f) => !admin.has(f)), [], 'public field with no Admin control');
  assert.deepEqual([...used].filter((f) => !mapped.has(f)), [], 'public field not persisted by the service');
  assert.deepEqual([...used].filter((f) => !columns.has(f)), [], 'public field with no Prisma column');
});

test('every Admin settings input is read by the public template or by service logic (no dead inputs)', () => {
  const used = new Set([...publicView.matchAll(/\blc\.(\w+)/g)].map((m) => m[1]));
  const serviceLogic = new Set(['socialProofMode']); // drives AUTO/MANUAL in getPublicLandingData
  const dead = [...adminSettingsFieldNames()].filter((n) => !used.has(n) && !serviceLogic.has(n));
  assert.deepEqual(dead, [], 'Admin inputs that change nothing on the public page');
});

// ---------------------------------------------------------------------------
// Public rendering: saved values render, empty values hide
// ---------------------------------------------------------------------------
function render(landingData, extra = {}) {
  return ejs.render(publicView, {
    cms: { course: {}, brand: {} },
    course: {
      id: 1, title: 'Some Course', slug: 'some-course', price: 0, salePrice: null, currency: 'INR',
      shortDescription: '', description: '', category: null, thumbnailUrl: null, lessons: [],
      instructor: { name: 'Dr T', photoUrl: null, credentials: [] },
    },
    isFree: true, priceLabel: 'Free', isEnrolled: false, hasPendingRequest: false, paymentsEnabled: false,
    stats: { publishedModuleCount: 1, publishedLessonCount: 3, totalDurationFormatted: '1h', resourceCount: 1, videoCount: 3 },
    curriculum: [], resources: [{ id: 1, title: 'Form', contentType: 'PDF', sizeBytes: 1000 }], faqs: [],
    landing: landingData, csrfToken: 't', cspNonce: 'n',
    ...extra,
  });
}

const ALL_KEYS = ['HERO', 'STATS', 'QUESTIONS', 'WHY_REGISTER', 'TAKEAWAYS', 'CURRICULUM', 'HIGHLIGHTS', 'PURCHASE', 'COMPARISON', 'AUDIENCE', 'ACCESS', 'RESOURCES', 'CERTIFICATE', 'MENTOR', 'REVIEWS', 'FAQ', 'SOCIAL_PROOF', 'FINAL_CTA'];
const it = (id, extra) => ({ id, sortOrder: id, isPublished: true, ...extra });

function landingWith(content) {
  return {
    content,
    heroChips: [it(1, { label: 'chip' })],
    stats: [], takeaways: [it(1, { title: 'Outcome', description: 'd' })],
    questions: [it(1, { question: 'A question' })],
    audienceFor: [it(1, { title: 'for' })], audienceNotFor: [it(2, { title: 'not for' })],
    faqs: [it(1, { question: 'FAQ Q', answer: 'FAQ A' })],
    whyRegisterWant: [it(1, { title: 'want' })], whyRegisterGet: [it(2, { title: 'get' })],
    highlights: [it(1, { title: 'High' })], testimonials: [it(1, { quote: 'q', reviewerName: 'Dr R', rating: 5, isDemo: false })],
    accessPlans: [], comparisonColumns: [it(1, { title: 'Col', items: [it(1, { text: 'feat' })] })],
    accessSteps: [it(1, { title: 'step' })], realReviewCount: 2,
    renderList: ALL_KEYS, landingSections: ALL_KEYS,
  };
}

const ENABLED = {
  heroEnabled: true, questionsEnabled: true, whyRegisterEnabled: true, takeawaysEnabled: true, curriculumEnabled: true,
  highlightsEnabled: true, purchaseCardEnabled: true, comparisonEnabled: true, audienceEnabled: true, accessSectionEnabled: true,
  resourcesEnabled: true, certificateSectionEnabled: true, mentorSectionEnabled: true, reviewsEnabled: true, faqEnabled: true,
  socialProofEnabled: true, finalCtaEnabled: true, stickyCtaEnabled: true,
};

test('every saved landing text field renders on the public page', () => {
  const textFields = [...new Set([...publicView.matchAll(/\blc\.(\w+)/g)].map((m) => m[1]))].filter((f) =>
    /(Eyebrow|Heading|Intro|Description|Text|Caption|Body|Note|Line\d|Value|ButtonLabel|CtaLabel|AccentText|TitleOverride|Label)$/.test(f) &&
    !/^(secondaryCtaTarget)$/.test(f));
  const content = { ...ENABLED, heroMediaType: 'THUMBNAIL', socialProofMode: 'MANUAL' };
  for (const f of textFields) content[f] = `MK_${f}`;
  // mentorHeading is rendered with the last word accented, so check its words
  const html = render(landingWith(content));
  const missing = textFields.filter((f) => !html.includes(`MK_${f}`) && !(f === 'mentorHeading' && html.includes('MK_mentorHeading')));
  assert.deepEqual(missing, [], 'saved Admin text that never reaches the public page');
});

test('clearing every editable text field hides it - no hardcoded marketing fallback returns', () => {
  const html = render(landingWith({ ...ENABLED }));
  const banned = [
    'Pre-Recorded Masterclass', 'Watch Preview', 'Clinical Fundamentals', 'Questions This Course Will Answer',
    'Masterclass Learning Outcomes', 'What clinicians will learn', 'Why Register For This Course', 'Master Full Mouth',
    'Detailed Course Curriculum', 'Course Curriculum', 'Full Masterclass Access', 'Enroll in this Masterclass',
    'Gain comprehensive access', 'Dentist Reviews', 'Reviews From Dentists', 'Curriculum Comparison', 'Course Comparison',
    'Candidate Profile', 'Candidate Suitability', 'Who Should Not Take', 'Who Is This Course Ideal For', 'Access Protocol',
    'How Will You Get Access', 'Clinical Documentation', 'Downloadable Clinical Protocols', 'Verified clinical protocols',
    'Meet Your Mentor', 'Questions & Answers', 'Frequently Asked Questions', 'Ready to Master', 'JOIN NOW TO LEARN MORE',
    'Five-Star', '365 Days Access', 'Recognize your progress', 'E-Certificate', 'Course Highlights',
  ];
  const leaked = banned.filter((b) => html.includes(b));
  assert.deepEqual(leaked, [], 'hardcoded marketing copy leaked into the public page');
  // the saved items themselves still render
  for (const t of ['Outcome', 'A question', 'FAQ Q', 'High', 'want', 'get']) assert.ok(html.includes(t), `${t} item should still render`);
});

test('a course with no landing row renders no invented marketing copy', () => {
  const html = render({ ...landingWith({}), content: {} });
  for (const b of ['Masterclass Learning Outcomes', 'Master Full Mouth', 'Why Register For This Course', 'JOIN NOW TO LEARN MORE']) {
    assert.ok(!html.includes(b), b);
  }
});

test('landing defaults for a new course contain structural flags only (no marketing copy)', () => {
  const d = landing.getDefaultLandingSettings({ id: 9, title: 'New', category: { name: 'X' }, shortDescription: 'Some', description: 'Desc' });
  const texty = Object.entries(d).filter(([k, v]) => typeof v === 'string' && v !== '' && !['secondaryCtaTarget', 'heroMediaType', 'accessMediaType', 'socialProofMode'].includes(k));
  assert.deepEqual(texty, []);
  assert.equal(d.certificateSectionEnabled, false);
  assert.equal(d.reviewsEnabled, false);
});

test('manual Quick Stats configured in Admin reach the public template', async () => {
  const empty = async () => [];
  const restores = [
    swap(prisma.courseLandingContent, 'findUnique', async () => ({})),
    swap(prisma.courseHeroChip, 'findMany', empty), swap(prisma.courseTakeaway, 'findMany', empty),
    swap(prisma.courseQuestion, 'findMany', empty), swap(prisma.courseAudienceItem, 'findMany', empty),
    swap(prisma.courseFaq, 'findMany', empty), swap(prisma.courseWhyRegisterItem, 'findMany', empty),
    swap(prisma.courseHighlight, 'findMany', empty), swap(prisma.courseTestimonial, 'findMany', empty),
    swap(prisma.courseAccessPlan, 'findMany', empty),
    swap(prisma.courseStat, 'findMany', async () => [{ id: 1, statType: 'MANUAL', value: '15+', label: 'Manual Stat', icon: null }]),
    swap(prisma.courseComparisonColumn, 'findMany', empty), swap(prisma.courseAccessStep, 'findMany', empty),
    swap(prisma.courseLandingSection, 'findMany', empty),
    swap(prisma.courseTestimonial, 'aggregate', async () => ({ _count: { id: 0 }, _avg: { rating: null } })),
  ];
  try {
    const data = await landing.getPublicLandingData(5);
    assert.equal(data.stats.length, 1, 'public data must expose Admin stats as landing.stats');
    const html = render({ ...landingWith({}), ...data, content: {}, renderList: ['STATS'], landingSections: ['STATS'] });
    assert.ok(html.includes('Manual Stat') && html.includes('15+'));
  } finally {
    restores.reverse().forEach((r) => r());
  }
});

// ---------------------------------------------------------------------------
// Settings isolation + new fields
// ---------------------------------------------------------------------------
test('faqIntro and questionsDescription persist; saving one tab never touches another', async () => {
  let captured;
  const restore = swap(prisma.courseLandingContent, 'upsert', async ({ where, update }) => { captured = { where, update }; return {}; });
  try {
    await landing.upsertLandingSettings(5, { faqIntro: ' QA faq intro ', questionsDescription: 'QA q desc' });
    assert.deepEqual(captured.update, { faqIntro: 'QA faq intro', questionsDescription: 'QA q desc' });
    assert.equal(captured.where.courseId, 5);
    // clearing really clears (null), it is not replaced by a default
    await landing.upsertLandingSettings(5, { faqIntro: '', audienceForHeading: '', highlightsHeading: '', whyRegisterWantHeading: '' });
    assert.deepEqual(captured.update, { faqIntro: null, audienceForHeading: null, highlightsHeading: null, whyRegisterWantHeading: null });
  } finally {
    restore();
  }
});

test('each Admin settings tab form only posts its own fields (no cross-tab field names)', () => {
  const seen = new Map();
  for (const f of adminView.matchAll(/<form[^>]*action="[^"]*landing-page\/settings"[\s\S]*?<\/form>/g)) {
    const tab = (f[0].match(/name="currentTab" value="([\w-]+)"/) || [])[1];
    for (const m of f[0].matchAll(/name="(\w+)"/g)) {
      if (['_csrf', 'currentTab'].includes(m[1])) continue;
      if (seen.has(m[1]) && seen.get(m[1]) !== tab) assert.fail(`${m[1]} is posted by two tabs: ${seen.get(m[1])} and ${tab}`);
      seen.set(m[1], tab);
    }
  }
  assert.ok(seen.size > 60);
});

// ---------------------------------------------------------------------------
// Cross-course isolation
// ---------------------------------------------------------------------------
test('items of one course cannot be changed, hidden, moved or deleted through another course', async () => {
  const OTHER = 99;
  const row = { id: 1, courseId: 5, columnId: 1, sortOrder: 10, isPublished: true, label: 'x', title: 'x', question: 'x', answer: 'x', text: 'x', reviewerName: 'x', quote: 'x', statType: 'MANUAL' };
  const models = {
    courseHeroChip: ['updateHeroChip', 'deleteHeroChip', 'moveHeroChip'],
    courseTakeaway: ['updateTakeaway', 'deleteTakeaway', 'moveTakeaway'],
    courseQuestion: ['updateQuestion', 'deleteQuestion', 'moveQuestion'],
    courseAudienceItem: ['updateAudienceItem', 'deleteAudienceItem', 'moveAudienceItem'],
    courseFaq: ['updateCourseFaq', 'deleteCourseFaq', 'moveCourseFaq'],
    courseWhyRegisterItem: ['updateWhyRegisterItem', 'deleteWhyRegisterItem', 'moveWhyRegisterItem'],
    courseHighlight: ['updateHighlight', 'deleteHighlight', 'moveHighlight'],
    courseTestimonial: ['updateTestimonial', 'deleteTestimonial', 'moveTestimonial'],
    courseAccessPlan: ['updateAccessPlan', 'deleteAccessPlan', 'moveAccessPlan'],
    courseStat: ['updateCourseStat', 'deleteCourseStat', 'moveCourseStat'],
    courseAccessStep: ['updateAccessStep', 'deleteAccessStep', 'moveAccessStep'],
    courseComparisonColumn: ['updateComparisonColumn', 'deleteComparisonColumn', 'moveComparisonColumn'],
  };
  const restores = [];
  let writes = 0;
  try {
    for (const [model, fns] of Object.entries(models)) {
      restores.push(swap(prisma, model, {
        findUnique: async () => ({ ...row }),
        findMany: async () => [{ ...row }],
        update: async () => { writes += 1; return {}; },
        delete: async () => { writes += 1; return {}; },
      }));
      for (const fn of fns) {
        assert.equal(typeof landing[fn], 'function', `${fn} must exist`);
        const args = fn.startsWith('update') ? [OTHER, 1, { isPublished: 'false', title: 'hijack' }]
          : fn.startsWith('move') ? [OTHER, 1, 'up'] : [OTHER, 1];
        await assert.rejects(() => landing[fn](...args), (e) => e.statusCode === 403, `${fn} must reject a foreign course`);
      }
    }
    // comparison items check ownership through their column
    restores.push(swap(prisma, 'courseComparisonItem', {
      findUnique: async () => ({ id: 1, columnId: 1, column: { courseId: 5 } }),
      update: async () => { writes += 1; return {}; },
      delete: async () => { writes += 1; return {}; },
      findMany: async () => [],
    }));
    await assert.rejects(() => landing.updateComparisonItem(OTHER, 1, 1, { text: 'hijack' }), (e) => e.statusCode === 403);
    await assert.rejects(() => landing.deleteComparisonItem(OTHER, 1, 1), (e) => e.statusCode === 403);
    await assert.rejects(() => landing.moveComparisonItem(OTHER, 1, 1, 'up'), (e) => e.statusCode === 403);
    assert.equal(writes, 0, 'no foreign write may reach the database');
  } finally {
    restores.reverse().forEach((r) => r());
  }
});

test('landing settings are keyed per course (editing course A never targets course B)', async () => {
  const wheres = [];
  const restore = swap(prisma.courseLandingContent, 'upsert', async ({ where, create }) => { wheres.push([where.courseId, create.courseId]); return {}; });
  try {
    await landing.upsertLandingSettings(5, { faqIntro: 'a' });
    await landing.upsertLandingSettings(6, { faqIntro: 'b' });
    assert.deepEqual(wheres, [[5, 5], [6, 6]]);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Comparison / access-step admin controllers pass the right arguments
// ---------------------------------------------------------------------------
test('comparison item controllers resolve the column and call the service correctly', async () => {
  const controller = require('../src/controllers/admin/courseLanding.controller');
  const items = [{ id: 7, columnId: 3, text: 'old', isPublished: true, sortOrder: 10 }];
  const restores = [
    swap(prisma, 'courseComparisonItem', {
      findUnique: async ({ where }) => { const i = items.find((x) => x.id === where.id); return i ? { ...i, column: { courseId: 5 } } : null; },
      update: async ({ where, data }) => { Object.assign(items.find((x) => x.id === where.id), data); return {}; },
      delete: async ({ where }) => { items.splice(items.findIndex((x) => x.id === where.id), 1); return {}; },
      findMany: async () => items.map((i) => ({ ...i })),
      count: async () => items.length,
      create: async ({ data }) => { items.push({ id: 8, ...data }); return {}; },
    }),
    swap(prisma, 'courseComparisonColumn', { findUnique: async () => ({ id: 3, courseId: 5 }) }),
  ];
  const mkRes = () => { const r = { redirected: null, redirect(u) { r.redirected = u; } }; return r; };
  const mkReq = (params, body) => ({ params, body, flash: [], flashSuccess() {}, flashError(m) { this.flash.push(m); } });
  try {
    let req = mkReq({ courseId: '5', itemId: '7' }, { text: 'new text', isPublished: ['false', 'on'] });
    await controller.updateComparisonItem(req, mkRes());
    assert.deepEqual(req.flash, []);
    assert.equal(items[0].text, 'new text');
    assert.equal(items[0].isPublished, true);

    req = mkReq({ courseId: '5', itemId: '7' }, { isPublished: 'false' });
    await controller.updateComparisonItem(req, mkRes());
    assert.equal(items[0].isPublished, false);

    req = mkReq({ courseId: '5', columnId: '3' }, { text: 'second feature', isPublished: ['false', 'on'] });
    await controller.createComparisonItem(req, mkRes());
    assert.deepEqual(req.flash, [], 'adding a feature item must work');
    assert.equal(items.length, 2);

    req = mkReq({ courseId: '5', itemId: '7' }, {});
    await controller.deleteComparisonItem(req, mkRes());
    assert.deepEqual(req.flash, []);
    assert.equal(items.length, 1);
  } finally {
    restores.reverse().forEach((r) => r());
  }
});

test('landing editor has an edit modal for access steps and comparison columns/items', async () => {
  const it2 = (id, e) => ({ id, courseId: 5, sortOrder: id, isPublished: true, ...e });
  const html = await ejs.renderFile(path.join(root, 'views/admin/courses/landing-page-content.ejs'), {
    csrfToken: 't', activeTab: 'comparison',
    course: { id: 5, title: 'C', slug: 'c', status: 'PUBLISHED', instructor: null }, landingContent: {},
    heroChips: [], takeaways: [], questions: [], audienceItems: [], faqs: [], whyRegisterItems: [], highlights: [], testimonials: [],
    accessPlans: [], courseStats: [], landingSections: [], resources: [],
    accessSteps: [it2(1, { title: 'Step' })],
    comparisonColumns: [it2(1, { title: 'Col', items: [it2(1, { text: 'feat' })] })],
  });
  for (const id of ['editAccessStepModal-1', 'editComparisonColumnModal-1', 'editComparisonItemModal-1']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /landing-page\/comparison-items\/1\/edit/);
  assert.match(html, /landing-page\/access-steps\/1\/edit/);
  assert.match(html, /id="tab-certificate"/);
  for (const t of [...html.matchAll(/data-bs-target="#(edit\w+Modal-\d+)"/g)].map((m) => m[1])) assert.ok(html.includes(`id="${t}"`), `dangling ${t}`);
});
