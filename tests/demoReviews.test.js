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

const TEMPLATE_PATH = path.join(__dirname, '..', 'views', 'public', 'course-detail-content.ejs');

function renderCourseLanding(data = {}) {
  const defaults = {
    course: {
      id: 6,
      title: 'Advanced FMR Master Class',
      slug: 'advanced-fmr-master-class',
      price: 0,
      salePrice: null,
      currency: 'INR',
      shortDescription: 'Master Full Mouth Rehabilitation systematically.',
      description: 'Comprehensive clinical course for dentists.',
      category: { id: 1, name: 'Prosthodontics', slug: 'prosthodontics' },
      instructor: {
        id: 1,
        name: 'Dr. Tanu Raghav',
        photoUrl: '/uploads/tanu.jpg',
        designation: '',
        organization: '',
        experienceLabel: '',
        fullBio: '',
        credentials: [],
        mentorQuote: '',
      },
      lessons: [],
    },
    cms: {
      course: {
        backLabel: 'Back to Courses',
        freeCta: 'Enroll Free',
        loginFreeCta: 'Enroll Free',
        requestCta: 'Request Enrollment',
        requestedLabel: 'Request Pending',
        curriculumHeading: 'Course Curriculum',
        emptyLessons: 'No lessons published yet.',
      },
      brand: {
        defaultCourseImageUrl: '/assets/images/course-placeholder.svg',
        defaultInstructorImageUrl: '/assets/images/instructor-placeholder.svg',
      },
    },
    isFree: true,
    priceLabel: 'Free',
    isEnrolled: false,
    hasPendingRequest: false,
    paymentsEnabled: true,
    currentUser: null,
    csrfToken: 'test-csrf-token',
    cspNonce: 'test-nonce-12345',
    isPreviewMode: false,
    landing: {
      content: {
        heroEnabled: true,
        heroEyebrow: 'Online Certificate Masterclass',
        heroTitleOverride: 'Advanced FMR Master Class',
        heroAccentText: 'Master Class',
        heroDescription: 'From diagnosis to final full mouth delivery.',
        heroPrimaryCtaLabel: 'Enroll Free',
        accessLabel: 'Self-Paced Lifetime Access',
        whyRegisterEnabled: false,
        curriculumEnabled: false,
        highlightsEnabled: false,
        purchaseCardEnabled: false,
        reviewsEnabled: true,
        comparisonEnabled: false,
        audienceEnabled: false,
        accessSectionEnabled: false,
        mentorSectionEnabled: false,
        faqEnabled: false,
        socialProofEnabled: false,
        finalCtaEnabled: true,
        finalCtaHeading: 'Ready to Master Full Mouth Rehabilitation?',
        stickyCtaEnabled: false,
      },
      heroChips: [],
      stats: [],
      takeaways: [],
      questions: [],
      whyRegisterWant: [],
      whyRegisterGet: [],
      highlights: [],
      testimonials: [],
      realReviewCount: 0,
      realAverageRating: 0,
      accessPlans: [],
      comparisonColumns: [],
      audienceFor: [],
      audienceNotFor: [],
      accessSteps: [],
      faqs: [],
      landingSections: ['HERO', 'REVIEWS', 'FINAL_CTA'],
    },
    stats: {
      moduleCount: 4,
      publishedModuleCount: 4,
      topicCount: 9,
      publishedTopicCount: 9,
      lessonCount: 23,
      publishedLessonCount: 15,
      videoCount: 15,
      totalDurationSeconds: 7200,
      totalDurationFormatted: '2h 00m',
      resourceCount: 0,
    },
    curriculum: [],
    resources: [],
  };

  const merged = { ...defaults, ...data };
  if (data.course) merged.course = { ...defaults.course, ...data.course };
  if (data.landing) {
    merged.landing = {
      ...defaults.landing,
      ...data.landing,
      content: { ...defaults.landing.content, ...(data.landing.content || {}) },
    };
  }
  return ejs.render(fs.readFileSync(TEMPLATE_PATH, 'utf8'), merged, { filename: TEMPLATE_PATH });
}

function mockLandingDb(overrides = {}) {
  const captured = {
    testimonialWhere: null,
    aggregateWhere: null,
  };

  const origs = {
    findUniqueContent: prisma.courseLandingContent.findUnique,
    findManyHeroChip: prisma.courseHeroChip.findMany,
    findManyTakeaway: prisma.courseTakeaway.findMany,
    findManyQuestion: prisma.courseQuestion.findMany,
    findManyAudience: prisma.courseAudienceItem.findMany,
    findManyFaq: prisma.courseFaq.findMany,
    findManyWhyRegister: prisma.courseWhyRegisterItem.findMany,
    findManyHighlight: prisma.courseHighlight.findMany,
    findManyTestimonial: prisma.courseTestimonial.findMany,
    findManyAccessPlan: prisma.courseAccessPlan.findMany,
    findManyStat: prisma.courseStat.findMany,
    findManyComparison: prisma.courseComparisonColumn.findMany,
    findManyAccessStep: prisma.courseAccessStep.findMany,
    findManyLandingSection: prisma.courseLandingSection.findMany,
    aggregateTestimonial: prisma.courseTestimonial.aggregate,
  };

  prisma.courseLandingContent.findUnique = async () => overrides.landingContent || null;
  prisma.courseHeroChip.findMany = async () => overrides.heroChips || [];
  prisma.courseTakeaway.findMany = async () => overrides.takeaways || [];
  prisma.courseQuestion.findMany = async () => overrides.questions || [];
  prisma.courseAudienceItem.findMany = async () => overrides.audienceItems || [];
  prisma.courseFaq.findMany = async () => overrides.faqs || [];
  prisma.courseWhyRegisterItem.findMany = async () => overrides.whyRegisterItems || [];
  prisma.courseHighlight.findMany = async () => overrides.highlights || [];
  prisma.courseTestimonial.findMany = async ({ where }) => {
    captured.testimonialWhere = where;
    return overrides.testimonials || [];
  };
  prisma.courseAccessPlan.findMany = async () => overrides.accessPlans || [];
  prisma.courseStat.findMany = async () => overrides.stats || [];
  prisma.courseComparisonColumn.findMany = async () => overrides.comparisonColumns || [];
  prisma.courseAccessStep.findMany = async () => overrides.accessSteps || [];
  prisma.courseLandingSection.findMany = async () => overrides.landingSections || [];
  prisma.courseTestimonial.aggregate = async ({ where }) => {
    captured.aggregateWhere = where;
    return overrides.aggregate || { _count: { id: 0 }, _avg: { rating: 0 } };
  };

  return {
    captured,
    restore() {
      prisma.courseLandingContent.findUnique = origs.findUniqueContent;
      prisma.courseHeroChip.findMany = origs.findManyHeroChip;
      prisma.courseTakeaway.findMany = origs.findManyTakeaway;
      prisma.courseQuestion.findMany = origs.findManyQuestion;
      prisma.courseAudienceItem.findMany = origs.findManyAudience;
      prisma.courseFaq.findMany = origs.findManyFaq;
      prisma.courseWhyRegisterItem.findMany = origs.findManyWhyRegister;
      prisma.courseHighlight.findMany = origs.findManyHighlight;
      prisma.courseTestimonial.findMany = origs.findManyTestimonial;
      prisma.courseAccessPlan.findMany = origs.findManyAccessPlan;
      prisma.courseStat.findMany = origs.findManyStat;
      prisma.courseComparisonColumn.findMany = origs.findManyComparison;
      prisma.courseAccessStep.findMany = origs.findManyAccessStep;
      prisma.courseLandingSection.findMany = origs.findManyLandingSection;
      prisma.courseTestimonial.aggregate = origs.aggregateTestimonial;
    },
  };
}

// ============================================================================
// 1. DEMO REVIEW CRUD
// ============================================================================

test('demo review CRUD: addTestimonial flags isDemo correctly and defaults to false', async () => {
  let createdData = null;
  const origCreate = prisma.courseTestimonial.create;
  const origCount = prisma.courseTestimonial.count;

  prisma.courseTestimonial.count = async () => 0;
  prisma.courseTestimonial.create = async ({ data }) => {
    createdData = data;
    return { id: 101, ...data };
  };

  try {
    // 1. Default review creation must have isDemo: false
    await courseLandingService.addTestimonial(6, {
      reviewerName: 'Dr. Real Clinician',
      reviewerDesignation: 'Prosthodontist',
      quote: 'Genuine authentic feedback from practicing clinician.',
      rating: 5,
    });
    assert.equal(createdData.isDemo, false, 'Default isDemo MUST be false');
    assert.equal(createdData.reviewerName, 'Dr. Real Clinician');

    // 2. Demo review creation with isDemo: true
    await courseLandingService.addTestimonial(6, {
      reviewerName: 'Dr. A. Sharma',
      reviewerDesignation: 'Demo Reviewer',
      quote: 'Demo testimonial for layout preview.',
      rating: 5,
      isDemo: true,
    });
    assert.equal(createdData.isDemo, true, 'isDemo must be true when specified');
    assert.equal(createdData.reviewerName, 'Dr. A. Sharma');

    // 3. String 'true' or 'on' from form checkbox
    await courseLandingService.addTestimonial(6, {
      reviewerName: 'Dr. R. Mehta',
      quote: 'Preview content for QA testing.',
      isDemo: 'on',
    });
    assert.equal(createdData.isDemo, true, 'cleanBoolValue must convert "on" to true');
  } finally {
    prisma.courseTestimonial.create = origCreate;
    prisma.courseTestimonial.count = origCount;
  }
});

test('demo review CRUD: updateTestimonial updates isDemo and fields safely', async () => {
  let updatedData = null;
  const origFindUnique = prisma.courseTestimonial.findUnique;
  const origUpdate = prisma.courseTestimonial.update;

  prisma.courseTestimonial.findUnique = async () => ({
    id: 101,
    courseId: 6,
    reviewerName: 'Dr. A. Sharma',
    quote: 'Demo testimonial',
    rating: 5,
    isPublished: true,
    isDemo: true,
  });

  prisma.courseTestimonial.update = async ({ data }) => {
    updatedData = data;
    return { id: 101, courseId: 6, ...data };
  };

  try {
    await courseLandingService.updateTestimonial(6, 101, {
      quote: 'Updated demo testimonial content.',
      rating: 4,
      isDemo: false,
    });

    assert.equal(updatedData.quote, 'Updated demo testimonial content.');
    assert.equal(updatedData.rating, 4);
    assert.equal(updatedData.isDemo, false);
  } finally {
    prisma.courseTestimonial.findUnique = origFindUnique;
    prisma.courseTestimonial.update = origUpdate;
  }
});

test('demo review CRUD: deleteTestimonial removes the testimonial record', async () => {
  let deletedId = null;
  const origFindUnique = prisma.courseTestimonial.findUnique;
  const origDelete = prisma.courseTestimonial.delete;

  prisma.courseTestimonial.findUnique = async () => ({
    id: 202,
    courseId: 6,
    reviewerName: 'Dr. P. Kapoor',
  });

  prisma.courseTestimonial.delete = async ({ where }) => {
    deletedId = where.id;
    return { id: where.id };
  };

  try {
    await courseLandingService.deleteTestimonial(6, 202);
    assert.equal(deletedId, 202, 'Correct testimonial ID was deleted');
  } finally {
    prisma.courseTestimonial.findUnique = origFindUnique;
    prisma.courseTestimonial.delete = origDelete;
  }
});

// ============================================================================
// 2. PUBLIC RENDERING RULE (DEMO REVIEWS STRICTLY HIDDEN)
// ============================================================================

test('getPublicLandingData: strictly excludes isDemo reviews by default', async () => {
  const db = mockLandingDb();
  try {
    await courseLandingService.getPublicLandingData(6);
    assert.equal(db.captured.testimonialWhere.courseId, 6);
    assert.equal(db.captured.testimonialWhere.isPublished, true);
    assert.equal(db.captured.testimonialWhere.isDemo, false, 'Default public query MUST have isDemo: false');
  } finally {
    db.restore();
  }
});

test('public course page: 0 demo reviews render even if present in landing data', () => {
  const demoReviews = [
    {
      id: 1,
      reviewerName: 'Dr. A. Sharma',
      reviewerDesignation: 'Demo Reviewer',
      quote: 'Demo testimonial for layout preview.',
      rating: 5,
      isDemo: true,
      isPublished: true,
    },
    {
      id: 2,
      reviewerName: 'Dr. R. Mehta',
      reviewerDesignation: 'Demo Reviewer',
      quote: 'Demo testimonial for responsive testing.',
      rating: 5,
      isDemo: true,
      isPublished: true,
    },
  ];

  // Public visitor mode (isPreviewMode: false)
  const html = renderCourseLanding({
    isPreviewMode: false,
    landing: {
      content: { reviewsEnabled: true },
      testimonials: demoReviews,
      realReviewCount: 0,
      realAverageRating: 0,
    },
  });

  // Demo reviews MUST be completely omitted
  assert.equal(html.includes('Dr. A. Sharma'), false, 'Demo reviewer Dr. A. Sharma MUST NOT be in public HTML');
  assert.equal(html.includes('Dr. R. Mehta'), false, 'Demo reviewer Dr. R. Mehta MUST NOT be in public HTML');
  assert.equal(html.includes('Demo testimonial'), false, 'Demo quote MUST NOT be in public HTML');
  assert.equal(html.includes('id="reviews"'), false, 'Reviews section must NOT render if 0 real reviews exist');
});

// ============================================================================
// 3. ADMIN PREVIEW (DEMO REVIEWS VISIBLE & PROMINENTLY BADGED)
// ============================================================================

test('getPublicLandingData: includes demo reviews when includeDemo: true is requested', async () => {
  const db = mockLandingDb();
  try {
    await courseLandingService.getPublicLandingData(6, { includeDemo: true });
    assert.equal(db.captured.testimonialWhere.courseId, 6);
    assert.equal(db.captured.testimonialWhere.isPublished, true);
    assert.equal(db.captured.testimonialWhere.isDemo, undefined, 'includeDemo: true MUST NOT filter out demo reviews');
  } finally {
    db.restore();
  }
});

test('admin preview: demo reviews render with DEMO REVIEW badges and TESTIMONIAL PREVIEW banner', () => {
  const demoReviews = [
    {
      id: 1,
      reviewerName: 'Dr. A. Sharma',
      reviewerDesignation: 'Demo Reviewer',
      quote: 'Demo testimonial for layout preview.',
      rating: 5,
      isDemo: true,
      isPublished: true,
    },
    {
      id: 2,
      reviewerName: 'Dr. R. Mehta',
      reviewerDesignation: 'Demo Reviewer',
      quote: 'Demo testimonial for responsive testing.',
      rating: 5,
      isDemo: true,
      isPublished: true,
    },
  ];

  const html = renderCourseLanding({
    isPreviewMode: true,
    landing: {
      content: { reviewsEnabled: false }, // Even if section is disabled, preview can inspect it
      testimonials: demoReviews,
      realReviewCount: 0,
    },
  });

  // Admin preview renders the reviews with clear demo labels
  assert.equal(html.includes('id="reviews"'), true, 'Reviews section must render in admin preview');
  assert.equal(html.includes('TESTIMONIAL PREVIEW'), true, 'Must display TESTIMONIAL PREVIEW banner');
  assert.equal(html.includes('DEMO REVIEW'), true, 'Must display DEMO REVIEW card badges');
  assert.equal(html.includes('Dr. A. Sharma'), true, 'Dr. A. Sharma should render in admin preview');
  assert.equal(html.includes('Dr. R. Mehta'), true, 'Dr. R. Mehta should render in admin preview');
});

// ============================================================================
// 4. REVIEW COUNT & AVERAGE RATING EXCLUSION
// ============================================================================

test('review count & average rating: strictly ignore demo reviews', async () => {
  const db = mockLandingDb({
    testimonials: [
      { id: 1, reviewerName: 'Dr. A. Sharma', rating: 5, isDemo: true, isPublished: true },
      { id: 2, reviewerName: 'Dr. R. Mehta', rating: 5, isDemo: true, isPublished: true },
    ],
    aggregate: {
      _count: { id: 0 },
      _avg: { rating: 0 },
    },
  });

  try {
    const landing = await courseLandingService.getPublicLandingData(6, { includeDemo: true });

    assert.equal(db.captured.aggregateWhere.courseId, 6);
    assert.equal(db.captured.aggregateWhere.isPublished, true);
    assert.equal(db.captured.aggregateWhere.isDemo, false, 'Aggregate query MUST filter where isDemo: false');
    assert.equal(landing.realReviewCount, 0, 'realReviewCount must be 0 when only demo reviews exist');
    assert.equal(landing.realAverageRating, 0, 'realAverageRating must be 0 when only demo reviews exist');
  } finally {
    db.restore();
  }
});

// ============================================================================
// 5. SOCIAL PROOF EXCLUSION
// ============================================================================

test('social proof: disabled when only demo reviews exist', async () => {
  const db = mockLandingDb({
    landingContent: {
      courseId: 6,
      socialProofMode: 'AUTO',
      socialProofEnabled: true,
    },
    aggregate: {
      _count: { id: 0 }, // 0 real reviews
      _avg: { rating: 0 },
    },
  });

  try {
    const landing = await courseLandingService.getPublicLandingData(6);
    assert.equal(landing.content.socialProofEnabled, false, 'socialProofEnabled must be forced to false in AUTO mode when 0 real reviews');
  } finally {
    db.restore();
  }
});

test('social proof: does not leak demo review count into final CTA eyebrow', () => {
  const html = renderCourseLanding({
    isPreviewMode: true,
    landing: {
      content: {
        socialProofEnabled: false,
        finalCtaEnabled: true,
      },
      testimonials: [
        { id: 1, reviewerName: 'Dr. A. Sharma', rating: 5, isDemo: true, isPublished: true },
      ],
      realReviewCount: 0,
    },
  });

  assert.equal(html.includes('Five-Star Reviews'), false, 'Social proof eyebrow MUST NOT appear from demo reviews');
});

// ============================================================================
// 6. JSON-LD STRUCTURED DATA EXCLUSION
// ============================================================================

test('JSON-LD: excludes aggregateRating and review schema when realReviewCount is 0', () => {
  function buildCourseJsonLd(course, landing) {
    return {
      '@context': 'https://schema.org',
      '@type': 'Course',
      name: course.title,
      description: course.shortDescription,
      ...(landing && landing.realReviewCount > 0 && landing.realAverageRating > 0
        ? {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: Number(landing.realAverageRating).toFixed(1),
              reviewCount: landing.realReviewCount,
            },
          }
        : {}),
    };
  }

  // 1. With demo reviews (realReviewCount = 0)
  const jsonLdWithDemoOnly = buildCourseJsonLd(
    { title: 'Advanced FMR Master Class', shortDescription: 'Master FMR.' },
    { realReviewCount: 0, realAverageRating: 0 }
  );
  assert.equal(jsonLdWithDemoOnly.aggregateRating, undefined, 'JSON-LD aggregateRating must be undefined when realReviewCount = 0');
  assert.equal(jsonLdWithDemoOnly.review, undefined, 'JSON-LD review must be undefined');

  // 2. With real reviews (realReviewCount = 5)
  const jsonLdWithReal = buildCourseJsonLd(
    { title: 'Advanced FMR Master Class', shortDescription: 'Master FMR.' },
    { realReviewCount: 5, realAverageRating: 4.8 }
  );
  assert.notEqual(jsonLdWithReal.aggregateRating, undefined);
  assert.equal(jsonLdWithReal.aggregateRating.reviewCount, 5);
  assert.equal(jsonLdWithReal.aggregateRating.ratingValue, '4.8');
});

// ============================================================================
// 7. REAL PUBLISHED REVIEW RENDERS & UNPUBLISHED REVIEW HIDDEN
// ============================================================================

test('real published review: renders cleanly in public course page', () => {
  const realReviews = [
    {
      id: 10,
      reviewerName: 'Dr. Genuine Dentist',
      reviewerDesignation: 'BDS, MDS Prosthodontics',
      reviewerLocation: 'New Delhi',
      quote: 'Truly exceptional course covering every aspect of full mouth reconstruction.',
      rating: 5,
      isDemo: false,
      isPublished: true,
      initials: 'GD',
    },
  ];

  const html = renderCourseLanding({
    isPreviewMode: false,
    landing: {
      content: { reviewsEnabled: true },
      testimonials: realReviews,
      realReviewCount: 1,
      realAverageRating: 5,
    },
  });

  assert.equal(html.includes('id="reviews"'), true, 'Reviews section must render when real published reviews exist');
  assert.equal(html.includes('Dr. Genuine Dentist'), true);
  assert.equal(html.includes('BDS, MDS Prosthodontics'), true);
  assert.equal(html.includes('Truly exceptional course'), true);
  assert.equal(html.includes('DEMO REVIEW'), false, 'Real reviews must NOT have DEMO REVIEW badge');
  assert.equal(html.includes('TESTIMONIAL PREVIEW'), false, 'Real reviews must NOT have TESTIMONIAL PREVIEW banner');
});

test('unpublished real review: filtered out by getPublicLandingData', async () => {
  const db = mockLandingDb();
  try {
    await courseLandingService.getPublicLandingData(6);
    assert.equal(db.captured.testimonialWhere.isPublished, true, 'getPublicLandingData must only query isPublished: true');
  } finally {
    db.restore();
  }
});
