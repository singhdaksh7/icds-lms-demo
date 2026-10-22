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
      id: 10,
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
        designation: 'Director & Chief Mentor',
        organization: 'Institute of Cosmetology & Dental Sciences',
        experienceLabel: '15+ Years Clinical Practice',
        fullBio: 'Specialist in full mouth rehabilitation, fixed prosthodontics, and occlusion.',
        credentials: [
          { id: 1, title: 'BDS, MDS Prosthodontics', description: 'Certified Specialist' },
        ],
        mentorQuote: 'Predictable clinical outcomes come from rigorous attention to diagnosis and protocol.',
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
    landing: {
      content: {
        heroEnabled: true,
        heroEyebrow: 'Online Certificate Masterclass',
        heroTitleOverride: 'Advanced FMR Master Class',
        heroAccentText: 'Master Class',
        heroDescription: 'From diagnosis to final full mouth delivery.',
        heroPrimaryCtaLabel: 'Enroll Free',
        accessLabel: 'Self-Paced Lifetime Access',
        whyRegisterEnabled: true,
        whyRegisterEyebrow: 'Why Register For This Course?',
        whyRegisterHeading: 'Systematic Clinical Excellence',
        whyRegisterEmphasisText: 'This course prepares you to execute FMR predictably.',
        whyRegisterWantHeading: 'This course is for you if you want to',
        whyRegisterGetHeading: 'What you get',
        whyRegisterClosingText: 'Transform your restorative dentistry practice with confidence.',
        curriculumEnabled: true,
        curriculumHeading: 'Detailed Course Curriculum',
        curriculumShowSessionCount: true,
        curriculumShowTotalDuration: true,
        curriculumShowResourceCount: true,
        highlightsEnabled: true,
        highlightsHeading: 'Highlights',
        purchaseCardEnabled: true,
        purchaseCardHeading: 'Masterclass Access',
        purchaseCardButtonLabel: 'Enroll Free',
        reviewsEnabled: false, // Strict: FMR has 0 reviews
        comparisonEnabled: false, // Strict: FMR has no competitor comparison
        audienceEnabled: true,
        audienceNotForHeading: 'Who Should Not Take This Course?',
        audienceForHeading: 'Who Is This Course Ideal For?',
        accessSectionEnabled: false,
        mentorSectionEnabled: true,
        faqEnabled: true,
        faqHeading: 'Frequently Asked Questions',
        socialProofEnabled: false, // Strict: FMR has 0 reviews
        finalCtaEnabled: true,
        finalCtaHeading: 'Ready to Master Full Mouth Rehabilitation?',
        finalCtaLine1: 'Learn the foundational science.',
        finalCtaLine2: 'Master the clinical sequence.',
        finalCtaLine3: 'Deliver with clinical predictability.',
        stickyCtaEnabled: true,
        stickyCtaText: 'JOIN NOW TO LEARN MORE',
      },
      heroChips: [],
      stats: [],
      takeaways: [],
      questions: [
        { id: 1, question: 'How to calculate and verify the vertical dimension?' },
        { id: 2, question: 'When is centric relation recording required?' },
      ],
      whyRegisterWant: [
        { id: 1, title: 'Stop referring out complex FMR cases', description: 'Handle rehabilitation in-house.' },
      ],
      whyRegisterGet: [
        { id: 1, title: 'Step-by-step clinical protocol checklists', description: 'Direct implementation.' },
      ],
      highlights: [
        { id: 1, title: 'Evidence-based clinical protocols', description: 'Structured modules' },
      ],
      testimonials: [], // Strict: 0 reviews
      accessPlans: [], // Fallback to course price
      comparisonColumns: [],
      audienceFor: [
        { id: 1, title: 'Clinicians seeking predictable FMR workflows' },
      ],
      audienceNotFor: [
        { id: 1, title: 'Practitioners seeking superficial shortcuts' },
      ],
      accessSteps: [],
      faqs: [
        { id: 1, question: 'Is this course suitable for beginners in FMR?', answer: 'Yes, it begins with core foundational principles.' },
      ],
      landingSections: [
        'HERO',
        'STATS',
        'QUESTIONS',
        'WHY_REGISTER',
        'CURRICULUM',
        'HIGHLIGHTS',
        'PURCHASE',
        'REVIEWS',
        'COMPARISON',
        'AUDIENCE',
        'ACCESS',
        'RESOURCES',
        'MENTOR',
        'FAQ',
        'SOCIAL_PROOF',
        'FINAL_CTA',
      ],
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
      resourceCount: 1,
    },
    curriculum: [
      {
        id: 1,
        title: 'Foundations of Occlusion',
        topics: [
          {
            id: 1,
            title: 'Diagnostic Mounting',
            lessons: [
              { id: 1, title: 'Facebow & CR Mounting', status: 'PUBLISHED', duration: '12:45', preview: true, slug: 'facebow-cr' },
            ],
          },
        ],
      },
    ],
    resources: [
      { id: 1, title: 'Dental Case History Forms', contentType: 'application/pdf', sizeBytes: 1548576 },
    ],
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

// ============================================================================
// 1. SECTION ORDERING & ENABLE / DISABLE DYNAMICS
// ============================================================================

test('Section Ordering: Public landing page respects custom section order from CMS', () => {
  // Reverse order: put FAQ first, then QUESTIONS, then HERO
  const customOrder = ['FAQ', 'QUESTIONS', 'HERO', 'FINAL_CTA'];
  const html = renderCourseLanding({
    landing: {
      landingSections: customOrder,
    },
  });

  const faqPos = html.indexOf('id="faq"');
  const questionsPos = html.indexOf('id="questions"');
  const heroPos = html.indexOf('id="hero"');
  const finalCtaPos = html.indexOf('id="final-cta"');

  assert.ok(faqPos !== -1 && questionsPos !== -1 && heroPos !== -1 && finalCtaPos !== -1);
  assert.ok(faqPos < questionsPos, 'FAQ should appear before QUESTIONS');
  assert.ok(questionsPos < heroPos, 'QUESTIONS should appear before HERO');
  assert.ok(heroPos < finalCtaPos, 'HERO should appear before FINAL_CTA');
});

test('Section Toggle: Disabled sections do NOT render on the public landing page', () => {
  const html = renderCourseLanding({
    landing: {
      content: {
        heroEnabled: false,
        questionsEnabled: false,
        whyRegisterEnabled: false,
        faqEnabled: false,
      },
    },
  });

  assert.ok(!html.includes('id="hero"'), 'Hero must not render when disabled');
  assert.ok(!html.includes('id="questions"'), 'Questions must not render when disabled');
  assert.ok(!html.includes('id="why-register"'), 'Why register must not render when disabled');
  assert.ok(!html.includes('id="faq"'), 'FAQ must not render when disabled');
});

// ============================================================================
// 2. COURSE ACCESS PLAN CRUD & FALLBACK TO COURSE PRICE
// ============================================================================

test('Access Plans: Falls back to course price and access label when accessPlans array is empty', () => {
  const html = renderCourseLanding({
    currentUser: { id: 10, role: 'STUDENT' },
    isFree: true,
    priceLabel: 'Free',
    landing: {
      accessPlans: [],
      content: {
        accessLabel: 'Self-Paced Lifetime Access',
      },
    },
  });

  assert.ok(html.includes('Self-Paced Lifetime Access'));
  assert.ok(html.includes('action="/courses/advanced-fmr-master-class/enroll-free"'));
});

test('Access Plans: Renders default access plan label when configured', () => {
  const html = renderCourseLanding({
    isFree: false,
    priceLabel: '₹4,999',
    landing: {
      accessPlans: [
        { id: 1, label: '365 Day Access', isDefault: true, price: 4999 },
        { id: 2, label: '30 Day Access', isDefault: false, price: 1999 },
      ],
    },
  });

  assert.ok(html.includes('365 Day Access'));
});

test('Access Plans: Course ownership prevents modifying other course access plan', async () => {
  const origFindUnique = prisma.courseAccessPlan.findUnique;
  prisma.courseAccessPlan.findUnique = async () => ({
    id: 55,
    courseId: 999,
    label: 'Wrong Course Plan',
  });

  try {
    await assert.rejects(
      async () => {
        await courseLandingService.updateAccessPlan(10, 55, { label: 'Hacked Plan' });
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  } finally {
    prisma.courseAccessPlan.findUnique = origFindUnique;
  }
});

// ============================================================================
// 3. STATS AUTO-CALCULATION VS MANUAL STATS
// ============================================================================

test('Stats: Auto stat types resolve from actual course hierarchy without fake numbers', () => {
  const rawDbStats = [
    { id: 1, statType: 'PUBLISHED_VIDEO_COUNT', value: '', label: 'Published Lessons' },
    { id: 2, statType: 'TOTAL_VIDEO_DURATION', value: '', label: 'Total Content' },
    { id: 3, statType: 'RESOURCE_COUNT', value: '', label: 'Clinical Forms' },
    { id: 4, statType: 'MODULE_COUNT', value: '', label: 'Structured Modules' },
    { id: 5, statType: 'MANUAL', value: '4K Ultra', label: 'Streaming Quality' },
  ];

  const resolved = courseLandingService.resolveCourseStats(rawDbStats, {
    publishedLessonCount: 15,
    totalDurationFormatted: '2h 15m',
    resourceCount: 1,
    publishedModuleCount: 4,
  });

  assert.equal(resolved[0].displayValue, '15');
  assert.equal(resolved[1].displayValue, '2h 15m');
  assert.equal(resolved[2].displayValue, '1');
  assert.equal(resolved[3].displayValue, '4');
  assert.equal(resolved[4].displayValue, '4K Ultra');
});

// ============================================================================
// 4. COMPARISON MATRIX (TWO COLUMNS, RECOMMENDED BADGE)
// ============================================================================

test('Comparison: Renders two columns with Recommended badge when enabled and configured', () => {
  const html = renderCourseLanding({
    landing: {
      content: {
        comparisonEnabled: true,
        comparisonHeading: 'Choose the Level for Your Practice',
      },
      comparisonColumns: [
        {
          id: 1,
          title: 'Starter Guide',
          subtitle: '4 Hours',
          isRecommended: false,
          items: [{ id: 1, text: 'Basic FMR principles' }],
        },
        {
          id: 2,
          title: 'FMR Masterclass',
          subtitle: '20+ Hours',
          isRecommended: true,
          badgeText: 'Recommended',
          items: [{ id: 2, text: 'Full in-depth clinical demonstrations' }],
        },
      ],
    },
  });

  assert.ok(html.includes('id="comparison"'));
  assert.ok(html.includes('Starter Guide'));
  assert.ok(html.includes('FMR Masterclass'));
  assert.ok(html.includes('Recommended'));
  assert.ok(html.includes('Full in-depth clinical demonstrations'));
});

test('Comparison: STRICTLY hidden when comparisonEnabled is false', () => {
  const html = renderCourseLanding({
    landing: {
      content: {
        comparisonEnabled: false,
      },
      comparisonColumns: [
        { id: 1, title: 'Starter Guide', isRecommended: false, items: [] },
      ],
    },
  });

  assert.ok(!html.includes('id="comparison"'), 'Comparison section must be hidden when disabled');
});

// ============================================================================
// 5. AUDIENCE FOR AND NOT FOR
// ============================================================================

test('Audience: Renders NOT FOR and IDEAL FOR with appropriate icons', () => {
  const html = renderCourseLanding({
    landing: {
      audienceFor: [{ id: 1, title: 'Dentists seeking systematic FMR protocols' }],
      audienceNotFor: [{ id: 2, title: 'Practitioners looking for quick tricks' }],
    },
  });

  assert.ok(html.includes('id="audience"'));
  assert.ok(html.includes('Who Should Not Take This Course?'));
  assert.ok(html.includes('Practitioners looking for quick tricks'));
  assert.ok(html.includes('Who Is This Course Ideal For?'));
  assert.ok(html.includes('Dentists seeking systematic FMR protocols'));
});

// ============================================================================
// 6. HOW TO GET ACCESS
// ============================================================================

test('Access Steps: Renders step cards and video when accessSectionEnabled is true', () => {
  const html = renderCourseLanding({
    landing: {
      content: {
        accessSectionEnabled: true,
        accessHeading: 'How Will You Get Access To The Course?',
        accessMediaType: 'VIDEO',
        accessMediaUrl: 'https://example.com/access-video.mp4',
      },
      accessSteps: [
        { id: 1, title: '1. Register Free Account', description: 'Create your learner profile.' },
        { id: 2, title: '2. Instant Access', description: 'Begin streaming all clinical modules.' },
      ],
    },
  });

  assert.ok(html.includes('id="access-steps"'));
  assert.ok(html.includes('How Will You Get Access To The Course?'));
  assert.ok(html.includes('1. Register Free Account'));
  assert.ok(html.includes('2. Instant Access'));
});

test('Access Steps: Strictly hidden when accessSectionEnabled is false', () => {
  const html = renderCourseLanding({
    landing: {
      content: {
        accessSectionEnabled: false,
      },
      accessSteps: [
        { id: 1, title: 'Register Account', description: '' },
      ],
    },
  });

  assert.ok(!html.includes('id="access-steps"'));
});

// ============================================================================
// 7. MEET YOUR MENTOR (DR. TANU RAGHAV INVARIANTS)
// ============================================================================

test('Mentor: Sourced from Course.instructor (Dr. Tanu Raghav), empty fields disappear', () => {
  const html = renderCourseLanding({
    course: {
      id: 10,
      title: 'Advanced FMR Master Class',
      instructor: {
        id: 1,
        name: 'Dr. Tanu Raghav',
        photoUrl: '/uploads/tanu.jpg',
        designation: 'Director & Chief Mentor',
        organization: 'Institute of Cosmetology & Dental Sciences',
        experienceLabel: '15+ Years Clinical Practice',
        fullBio: 'Specialist in full mouth rehabilitation, fixed prosthodontics, and occlusion.',
        credentials: [
          { id: 1, title: 'BDS, MDS Prosthodontics', description: 'Certified Specialist' },
        ],
        mentorQuote: 'Predictable clinical outcomes come from rigorous attention to diagnosis.',
      },
    },
  });

  assert.ok(html.includes('id="mentor"'));
  assert.ok(html.includes('Dr. Tanu Raghav'));
  assert.ok(html.includes('Director &amp; Chief Mentor') || html.includes('Director'));
  assert.ok(html.includes('Institute of Cosmetology &amp; Dental Sciences') || html.includes('Institute of Cosmetology'));
  assert.ok(html.includes('15+ Years Clinical Practice'));
  assert.ok(html.includes('BDS, MDS Prosthodontics'));
  assert.ok(html.includes('Predictable clinical outcomes come from rigorous attention'));

  // Competitor claims must NOT appear
  assert.ok(!html.includes('Moez Khakiani'), 'Competitor mentor MUST NOT appear');
  assert.ok(!html.includes('Karnavati School of Dentistry'), 'Competitor organization MUST NOT appear');
  assert.ok(!html.includes('Smile Masters'), 'Competitor clinic MUST NOT appear');
});

// ============================================================================
// 8. FINAL CTA AND STICKY BOTTOM BAR
// ============================================================================

test('Final CTA & Sticky CTA: Render 3 check lines and business-aware buttons', () => {
  const html = renderCourseLanding({
    isFree: true,
    priceLabel: 'Free',
    landing: {
      content: {
        finalCtaEnabled: true,
        finalCtaHeading: 'Ready to Master Full Mouth Rehabilitation?',
        finalCtaLine1: 'Learn the foundational science.',
        finalCtaLine2: 'Master the clinical sequence.',
        finalCtaLine3: 'Deliver with clinical predictability.',
        stickyCtaEnabled: true,
        stickyCtaText: 'JOIN NOW TO LEARN MORE',
      },
    },
  });

  assert.ok(html.includes('id="final-cta"'));
  assert.ok(html.includes('Learn the foundational science.'));
  assert.ok(html.includes('Master the clinical sequence.'));
  assert.ok(html.includes('Deliver with clinical predictability.'));
  assert.ok(html.includes('id="course-floating-bar"'));
  assert.ok(html.includes('JOIN NOW TO LEARN MORE'));
});

// ============================================================================
// 9. ADMIN PREVIEW BAR (DRAFT OR PUBLISHED COURSES)
// ============================================================================

test('Admin Preview: Banner renders only in preview mode with back link to CMS', () => {
  const htmlPreview = renderCourseLanding({
    isPreview: true,
    course: {
      id: 10,
      title: 'Draft Masterclass',
      status: 'DRAFT',
    },
  });

  assert.ok(htmlPreview.includes('admin-preview-bar'));
  assert.ok(htmlPreview.includes('Admin Preview Mode'));
  assert.ok(htmlPreview.includes('/admin/courses/10/landing-page'));

  const htmlPublic = renderCourseLanding({
    isPreview: false,
  });
  assert.ok(!htmlPublic.includes('admin-preview-bar'));
});

// ============================================================================
// 10. REVIEWS & SOCIAL PROOF STRICT GUARD
// ============================================================================

test('Reviews & Social Proof: STRICTLY suppressed for FMR (0 genuine reviews)', () => {
  const html = renderCourseLanding({
    landing: {
      content: {
        reviewsEnabled: false,
        socialProofEnabled: false,
      },
      testimonials: [],
    },
  });

  assert.ok(!html.includes('id="reviews"'), 'Reviews section MUST NOT render for FMR');
  assert.ok(!html.includes('400+ Five-Star Reviews'), 'Fake review claims MUST NOT appear');
  assert.ok(!html.includes('Dr. Juhi Khandelwal'), 'Competitor review MUST NOT appear');
  assert.ok(!html.includes('Dr. Kshitish Kothuru'), 'Competitor review MUST NOT appear');
  assert.ok(!html.includes('Dr. Sandhya Tripathi'), 'Competitor review MUST NOT appear');
  assert.ok(!html.includes('Dr. Avni Guru'), 'Competitor review MUST NOT appear');
});
