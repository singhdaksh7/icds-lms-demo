process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ejs = require('ejs');

const { prisma } = require('../src/config/db');
const courseLandingService = require('../src/services/courseLanding.service');

// --- 1. Default Landing Settings & Certificate Section Default OFF ---

test('getDefaultLandingSettings sets certificateSectionEnabled to strictly FALSE', () => {
  const dummyCourse = { id: 1, title: 'Dental Mastery', shortDescription: 'Test', description: 'Desc' };
  const defaults = courseLandingService.getDefaultLandingSettings(dummyCourse);

  assert.equal(defaults.certificateSectionEnabled, false, 'Certificate section MUST be OFF by default');
  assert.equal(defaults.curriculumEnabled, true);
  assert.equal(defaults.aboutEnabled, true);
  assert.equal(defaults.priceSubtitle, 'Full Lifetime Access');
});

// --- 2. Landing Settings Upsert & Validation ---

test('upsertLandingSettings sanitizes strings and casts booleans correctly', async () => {
  let capturedData = null;
  const origUpsert = prisma.courseLandingContent.upsert;
  prisma.courseLandingContent.upsert = async ({ where, create, update }) => {
    capturedData = update;
    return { id: 1, courseId: 10, ...update };
  };

  try {
    const payload = {
      heroEyebrow: '   Cosmetology Master Class   ',
      heroTitleOverride: 'Custom Title',
      heroAccentText: 'Clinical Excellence',
      heroMediaType: 'VIDEO',
      certificateSectionEnabled: 'false',
      aboutEnabled: 'true',
      takeawaysEnabled: '1',
      curriculumDefaultExpanded: 'on',
    };

    const res = await courseLandingService.upsertLandingSettings(10, payload);
    assert.equal(capturedData.heroEyebrow, 'Cosmetology Master Class');
    assert.equal(capturedData.heroTitleOverride, 'Custom Title');
    assert.equal(capturedData.heroAccentText, 'Clinical Excellence');
    assert.equal(capturedData.heroMediaType, 'VIDEO');
    assert.equal(capturedData.certificateSectionEnabled, false);
    assert.equal(capturedData.aboutEnabled, true);
    assert.equal(capturedData.takeawaysEnabled, true);
    assert.equal(capturedData.curriculumDefaultExpanded, true);
  } finally {
    prisma.courseLandingContent.upsert = origUpsert;
  }
});

// --- 3. Course Ownership & Repeatable Item CRUD ---

test('updateHeroChip rejects modification when chip belongs to another course', async () => {
  const origFindUnique = prisma.courseHeroChip.findUnique;
  prisma.courseHeroChip.findUnique = async ({ where }) => {
    return { id: 99, courseId: 999, label: 'Wrong Course Chip' };
  };

  try {
    await assert.rejects(
      async () => {
        // Calling for course 100 on chip that belongs to course 999
        await courseLandingService.updateHeroChip(100, 99, { label: 'Hacked Chip' });
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.ok(err.message.includes('not belong to this course'));
        return true;
      }
    );
  } finally {
    prisma.courseHeroChip.findUnique = origFindUnique;
  }
});

test('deleteTakeaway rejects when takeaway belongs to another course', async () => {
  const origFindUnique = prisma.courseTakeaway.findUnique;
  prisma.courseTakeaway.findUnique = async ({ where }) => {
    return { id: 88, courseId: 999, title: 'Foreign Takeaway' };
  };

  try {
    await assert.rejects(
      async () => {
        await courseLandingService.deleteTakeaway(100, 88);
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  } finally {
    prisma.courseTakeaway.findUnique = origFindUnique;
  }
});

test('deleteQuestion rejects when question belongs to another course', async () => {
  const origFindUnique = prisma.courseQuestion.findUnique;
  prisma.courseQuestion.findUnique = async ({ where }) => {
    return { id: 77, courseId: 999, question: 'Foreign Question' };
  };

  try {
    await assert.rejects(
      async () => {
        await courseLandingService.deleteQuestion(100, 77);
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  } finally {
    prisma.courseQuestion.findUnique = origFindUnique;
  }
});

test('deleteAudienceItem rejects when item belongs to another course', async () => {
  const origFindUnique = prisma.courseAudienceItem.findUnique;
  prisma.courseAudienceItem.findUnique = async ({ where }) => {
    return { id: 66, courseId: 999, title: 'Foreign Audience' };
  };

  try {
    await assert.rejects(
      async () => {
        await courseLandingService.deleteAudienceItem(100, 66);
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  } finally {
    prisma.courseAudienceItem.findUnique = origFindUnique;
  }
});

test('deleteFaq rejects when FAQ belongs to another course', async () => {
  const origFindUnique = prisma.courseFaq.findUnique;
  prisma.courseFaq.findUnique = async ({ where }) => {
    return { id: 55, courseId: 999, question: 'Foreign FAQ' };
  };

  try {
    await assert.rejects(
      async () => {
        await courseLandingService.deleteFaq(100, 55);
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  } finally {
    prisma.courseFaq.findUnique = origFindUnique;
  }
});

// --- 4. Repeatable Item Reordering (Move Up / Down) ---

test('moveHeroChip correctly swaps adjacent chips', async () => {
  const origFindUnique = prisma.courseHeroChip.findUnique;
  const origFindMany = prisma.courseHeroChip.findMany;
  const origUpdate = prisma.courseHeroChip.update;

  const mockChips = [
    { id: 1, courseId: 10, sortOrder: 1 },
    { id: 2, courseId: 10, sortOrder: 2 },
    { id: 3, courseId: 10, sortOrder: 3 },
  ];

  prisma.courseHeroChip.findUnique = async ({ where }) => mockChips.find(c => c.id === where.id);
  prisma.courseHeroChip.findMany = async () => [...mockChips];

  const updates = [];
  prisma.courseHeroChip.update = async ({ where, data }) => {
    updates.push({ id: where.id, sortOrder: data.sortOrder });
    return { ...where, ...data };
  };

  try {
    // Move chip 2 UP (should swap with chip 1)
    await courseLandingService.moveHeroChip(10, 2, 'up');
    assert.equal(updates.length, 2);
    assert.deepEqual(updates, [
      { id: 2, sortOrder: 1 },
      { id: 1, sortOrder: 2 },
    ]);
  } finally {
    prisma.courseHeroChip.findUnique = origFindUnique;
    prisma.courseHeroChip.findMany = origFindMany;
    prisma.courseHeroChip.update = origUpdate;
  }
});

test('moveTakeaway correctly moves card down', async () => {
  const origFindUnique = prisma.courseTakeaway.findUnique;
  const origFindMany = prisma.courseTakeaway.findMany;
  const origUpdate = prisma.courseTakeaway.update;

  const mockTakeaways = [
    { id: 10, courseId: 10, sortOrder: 1 },
    { id: 20, courseId: 10, sortOrder: 2 },
  ];

  prisma.courseTakeaway.findUnique = async ({ where }) => mockTakeaways.find(t => t.id === where.id);
  prisma.courseTakeaway.findMany = async () => [...mockTakeaways];

  const updates = [];
  prisma.courseTakeaway.update = async ({ where, data }) => {
    updates.push({ id: where.id, sortOrder: data.sortOrder });
    return { ...where, ...data };
  };

  try {
    // Move item 10 DOWN (should swap with item 20)
    await courseLandingService.moveTakeaway(10, 10, 'down');
    assert.equal(updates.length, 2);
    assert.deepEqual(updates, [
      { id: 10, sortOrder: 2 },
      { id: 20, sortOrder: 1 },
    ]);
  } finally {
    prisma.courseTakeaway.findUnique = origFindUnique;
    prisma.courseTakeaway.findMany = origFindMany;
    prisma.courseTakeaway.update = origUpdate;
  }
});

// --- 5. View Rendering Tests (EJS) ---

const TEMPLATE_PATH = path.join(__dirname, '..', 'views', 'public', 'course-detail-content.ejs');
const templateStr = fs.readFileSync(TEMPLATE_PATH, 'utf8');

function renderTemplate(context) {
  const defaultContext = {
    cms: {
      course: { backLabel: 'Back to Courses', freeCta: 'Enroll Free →', requestedLabel: 'Request Pending', requestCta: 'Request Enrollment →' },
      brand: { defaultCourseImageUrl: '/assets/images/course-placeholder.svg', defaultInstructorImageUrl: '/assets/images/instructor-placeholder.svg' },
    },
    course: {
      id: 1,
      title: 'Advanced FMR Master Class',
      slug: 'advanced-fmr-master-class',
      price: 0,
      salePrice: null,
      currency: 'INR',
      shortDescription: 'Master class short description',
      description: 'Comprehensive description',
      category: { name: 'Dental Sciences', slug: 'dental' },
      instructor: null,
      thumbnailUrl: null,
      lessons: [],
    },
    isFree: true,
    priceLabel: 'Free',
    isEnrolled: false,
    hasPendingRequest: false,
    paymentsEnabled: false,
    stats: {
      moduleCount: 4,
      publishedModuleCount: 4,
      topicCount: 9,
      publishedTopicCount: 9,
      lessonCount: 23,
      publishedLessonCount: 15,
      videoCount: 15,
      totalDurationSeconds: 0,
      totalDurationFormatted: '12h 45m',
      resourceCount: 1,
    },
    curriculum: [],
    resources: [],
    faqs: [],
    landing: null,
    csrfToken: 'test-csrf-token',
    cspNonce: 'test-nonce',
  };

  return ejs.render(templateStr, { ...defaultContext, ...context });
}

test('view renders certificate section ONLY when certificateSectionEnabled is true', () => {
  // Case A: certificateSectionEnabled is false (Default)
  const htmlWithoutCert = renderTemplate({
    landing: {
      content: { certificateSectionEnabled: false },
      heroChips: [],
      takeaways: [],
      questions: [],
      audienceFor: [],
      audienceNotFor: [],
      faqs: [],
    },
  });
  assert.ok(!htmlWithoutCert.includes('Official Verifiable Clinical Credential'), 'Certificate mockup MUST NOT appear when certificateSectionEnabled is false');
  assert.ok(!htmlWithoutCert.includes('Recognize your progress'), 'Certificate copy MUST NOT appear when certificateSectionEnabled is false');

  // Case B: certificateSectionEnabled is true
  const htmlWithCert = renderTemplate({
    landing: {
      content: {
        certificateSectionEnabled: true,
        certificateHeading: 'Official Board Certification',
        certificateBody: 'Granted after successful completion of all clinical cases.',
      },
      heroChips: [],
      takeaways: [],
      questions: [],
      audienceFor: [],
      audienceNotFor: [],
      faqs: [],
    },
  });
  assert.ok(htmlWithCert.includes('Official Verifiable Clinical Credential'), 'Certificate mockup MUST appear when certificateSectionEnabled is true');
  assert.ok(htmlWithCert.includes('Official Board Certification'));
  assert.ok(htmlWithCert.includes('Granted after successful completion'));
});

test('view hides repeating sections when they have zero active items (no invented copy)', () => {
  const html = renderTemplate({
    landing: {
      content: {
        takeawaysEnabled: true,
        questionsEnabled: true,
        audienceEnabled: true,
        faqEnabled: true,
      },
      heroChips: [], // 0 chips
      takeaways: [], // 0 takeaways
      questions: [], // 0 questions
      audienceFor: [], // 0 audience
      audienceNotFor: [],
      faqs: [], // 0 faqs
    },
  });

  // Zero chips -> no chips div
  assert.ok(!html.includes('class="chips rv d2"'), 'Chips container must be hidden when zero chips exist');

  // Zero takeaways -> no takeaway cards or takeaway heading
  assert.ok(!html.includes('class="card takeaway'), 'Takeaways cards must not render when 0 items exist');

  // Zero questions -> no question cards
  assert.ok(!html.includes('class="question-grid"'), 'Question grid must not render when 0 items exist');

  // Zero audience -> no audience section
  assert.ok(!html.includes('class="audience"'), 'Audience section must not render when 0 items exist');

  // Zero FAQs -> no FAQ details
  assert.ok(!html.includes('class="faq"'), 'FAQ section must not render when 0 items exist');
});

test('view renders dynamic hero chips, takeaways, questions, audience, and FAQs when provided', () => {
  const html = renderTemplate({
    landing: {
      content: {
        heroEyebrow: 'Specialized Clinical Course',
        heroTitleOverride: 'Pro Full Mouth Rehab',
        heroAccentText: 'Full Mouth',
        heroDescription: 'Dynamic custom lede text for testing.',
        takeawaysEnabled: true,
        takeawaysHeading: 'Custom Key Outcomes',
        questionsEnabled: true,
        questionsHeading: 'Core Clinical Dilemmas',
        audienceEnabled: true,
        audienceForHeading: 'Who Should Join',
        audienceNotForHeading: 'Who Should Skip',
        faqEnabled: true,
      },
      heroChips: [{ label: '100% Private Streaming' }, { label: 'Downloadable Protocols' }],
      takeaways: [
        { icon: '01', title: 'Occlusal Splints', description: 'Deep dive into splints.' },
      ],
      questions: [
        { question: 'How to calculate interocclusal space?' },
      ],
      audienceFor: [{ title: 'Prosthodontists seeking systematic protocols' }],
      audienceNotFor: [{ title: 'Students looking for quick exam shortcuts' }],
      faqs: [{ question: 'Is video downloadable?', answer: 'Videos stream securely in high definition.' }],
    },
  });

  // Hero
  assert.ok(html.includes('Specialized Clinical Course'));
  assert.ok(html.includes('Pro <em>Full Mouth</em> Rehab'));
  assert.ok(html.includes('Dynamic custom lede text for testing.'));
  assert.ok(html.includes('100% Private Streaming'));
  assert.ok(html.includes('Downloadable Protocols'));

  // Takeaways
  assert.ok(html.includes('Custom Key Outcomes'));
  assert.ok(html.includes('Occlusal Splints'));
  assert.ok(html.includes('Deep dive into splints.'));

  // Questions
  assert.ok(html.includes('Core Clinical Dilemmas'));
  assert.ok(html.includes('How to calculate interocclusal space?'));

  // Audience
  assert.ok(html.includes('Who Should Join'));
  assert.ok(html.includes('Prosthodontists seeking systematic protocols'));
  assert.ok(html.includes('Who Should Skip'));
  assert.ok(html.includes('Students looking for quick exam shortcuts'));

  // FAQs
  assert.ok(html.includes('Is video downloadable?'));
  assert.ok(html.includes('Videos stream securely in high definition.'));
});

test('view preserves free vs paid enrollment logic without breaking', () => {
  // Free Course: shows "Enroll Free →" for student
  const freeHtml = renderTemplate({
    currentUser: { id: 10, role: 'STUDENT' },
    isFree: true,
    priceLabel: 'Free',
    course: { id: 1, title: 'Free Course', slug: 'free-course', price: 0, salePrice: null, currency: 'INR' },
  });
  assert.ok(freeHtml.includes('action="/courses/free-course/enroll-free"'), 'Free course includes enrollment form');

  // Paid Course with payments enabled: links to checkout for logged-in student
  const paidHtml = renderTemplate({
    currentUser: { id: 10, role: 'STUDENT' },
    isFree: false,
    paymentsEnabled: true,
    priceLabel: '₹24,999',
    course: { id: 2, title: 'Paid Course', slug: 'paid-course', price: 24999, salePrice: null, currency: 'INR' },
  });
  assert.ok(paidHtml.includes('href="/checkout/paid-course"'), 'Paid course with payments enabled links to checkout');
  assert.ok(paidHtml.includes('Buy Course – ₹24,999'));
});
