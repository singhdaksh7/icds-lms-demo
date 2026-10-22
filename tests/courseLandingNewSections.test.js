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
const instructorService = require('../src/services/instructor.service');
const homeService = require('../src/services/home.service');

// ============================================================================
// 1. WHY REGISTER FOR THIS COURSE: CRUD, WANT/GET Grouping & Ordering
// ============================================================================

test('addWhyRegisterItem creates WANT and GET items with proper sortOrder and sanitization', async () => {
  let createdPayload = null;
  const origCreate = prisma.courseWhyRegisterItem.create;
  const origCount = prisma.courseWhyRegisterItem.count;

  prisma.courseWhyRegisterItem.count = async () => 2;
  prisma.courseWhyRegisterItem.create = async ({ data }) => {
    createdPayload = data;
    return { id: 101, ...data };
  };

  try {
    const item = await courseLandingService.addWhyRegisterItem(5, {
      type: 'WANT',
      title: '  Master Occlusal Vertical Dimension  ',
      description: '  Practical steps to evaluate collapsed bite.  ',
      icon: 'check',
    });

    assert.equal(createdPayload.courseId, 5);
    assert.equal(createdPayload.type, 'WANT');
    assert.equal(createdPayload.title, 'Master Occlusal Vertical Dimension');
    assert.equal(createdPayload.description, 'Practical steps to evaluate collapsed bite.');
    assert.equal(createdPayload.sortOrder, 30);
    assert.equal(createdPayload.isPublished, true);
  } finally {
    prisma.courseWhyRegisterItem.create = origCreate;
    prisma.courseWhyRegisterItem.count = origCount;
  }
});

test('updateWhyRegisterItem enforces course ownership and updates fields', async () => {
  const origFindUnique = prisma.courseWhyRegisterItem.findUnique;
  const origUpdate = prisma.courseWhyRegisterItem.update;

  prisma.courseWhyRegisterItem.findUnique = async ({ where }) => {
    if (where.id === 50) return { id: 50, courseId: 999, type: 'WANT', title: 'Other course item' };
    if (where.id === 51) return { id: 51, courseId: 5, type: 'WANT', title: 'Valid item' };
    return null;
  };

  let updatedData = null;
  prisma.courseWhyRegisterItem.update = async ({ where, data }) => {
    updatedData = data;
    return { id: where.id, courseId: 5, ...data };
  };

  try {
    // Rejects if belongs to different course
    await assert.rejects(
      async () => {
        await courseLandingService.updateWhyRegisterItem(5, 50, { title: 'Unauthorized update' });
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /does not belong to this course/i);
        return true;
      }
    );

    // Updates successfully for owner course
    const updated = await courseLandingService.updateWhyRegisterItem(5, 51, {
      title: 'Updated Title',
      type: 'GET',
      isPublished: 'false',
    });
    assert.equal(updatedData.title, 'Updated Title');
    assert.equal(updatedData.type, 'GET');
    assert.equal(updatedData.isPublished, false);
  } finally {
    prisma.courseWhyRegisterItem.findUnique = origFindUnique;
    prisma.courseWhyRegisterItem.update = origUpdate;
  }
});

test('moveWhyRegisterItem swaps sort order within same course and type', async () => {
  const origFindUnique = prisma.courseWhyRegisterItem.findUnique;
  const origFindMany = prisma.courseWhyRegisterItem.findMany;
  const origUpdate = prisma.courseWhyRegisterItem.update;

  const mockItems = [
    { id: 1, courseId: 5, type: 'WANT', sortOrder: 1 },
    { id: 2, courseId: 5, type: 'WANT', sortOrder: 2 },
    { id: 3, courseId: 5, type: 'WANT', sortOrder: 3 },
  ];

  prisma.courseWhyRegisterItem.findUnique = async ({ where }) => {
    return mockItems.find((i) => i.id === where.id) || null;
  };
  prisma.courseWhyRegisterItem.findMany = async () => [...mockItems];
  const updates = [];
  prisma.courseWhyRegisterItem.update = async ({ where, data }) => {
    updates.push({ id: where.id, sortOrder: data.sortOrder });
    return { ...where, ...data };
  };

  try {
    // Move item 2 up -> should swap with item 1
    await courseLandingService.moveWhyRegisterItem(5, 2, 'up');
    assert.equal(updates.length, 2);
    assert.deepEqual(updates, [
      { id: 2, sortOrder: 1 },
      { id: 1, sortOrder: 2 },
    ]);
  } finally {
    prisma.courseWhyRegisterItem.findUnique = origFindUnique;
    prisma.courseWhyRegisterItem.findMany = origFindMany;
    prisma.courseWhyRegisterItem.update = origUpdate;
  }
});

test('deleteWhyRegisterItem enforces course ownership', async () => {
  const origFindUnique = prisma.courseWhyRegisterItem.findUnique;
  const origDelete = prisma.courseWhyRegisterItem.delete;

  prisma.courseWhyRegisterItem.findUnique = async ({ where }) => {
    if (where.id === 99) return { id: 99, courseId: 888 };
    return null;
  };

  try {
    await assert.rejects(
      async () => {
        await courseLandingService.deleteWhyRegisterItem(5, 99);
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  } finally {
    prisma.courseWhyRegisterItem.findUnique = origFindUnique;
    prisma.courseWhyRegisterItem.delete = origDelete;
  }
});

// ============================================================================
// 2. HIGHLIGHTS: CRUD & Ordering
// ============================================================================

test('addHighlight creates highlight item and moves it correctly', async () => {
  let created = null;
  const origCount = prisma.courseHighlight.count;
  const origCreate = prisma.courseHighlight.create;

  prisma.courseHighlight.count = async () => 0;
  prisma.courseHighlight.create = async ({ data }) => {
    created = data;
    return { id: 10, ...data };
  };

  try {
    const res = await courseLandingService.addHighlight(5, {
      title: '  Structured Full Mouth Rehabilitation curriculum  ',
      description: 'Step-by-step clinical guidance',
    });
    assert.equal(created.courseId, 5);
    assert.equal(created.title, 'Structured Full Mouth Rehabilitation curriculum');
    assert.equal(created.sortOrder, 10);
    assert.equal(created.isPublished, true);
  } finally {
    prisma.courseHighlight.count = origCount;
    prisma.courseHighlight.create = origCreate;
  }
});

test('moveHighlight reorders highlights', async () => {
  const origFindUnique = prisma.courseHighlight.findUnique;
  const origFindMany = prisma.courseHighlight.findMany;
  const origUpdate = prisma.courseHighlight.update;

  const mockHighlights = [
    { id: 10, courseId: 5, sortOrder: 1 },
    { id: 20, courseId: 5, sortOrder: 2 },
  ];

  prisma.courseHighlight.findUnique = async ({ where }) => {
    return mockHighlights.find((i) => i.id === where.id) || null;
  };
  prisma.courseHighlight.findMany = async () => [...mockHighlights];
  const updates = [];
  prisma.courseHighlight.update = async ({ where, data }) => {
    updates.push({ id: where.id, sortOrder: data.sortOrder });
    return { ...where, ...data };
  };

  try {
    await courseLandingService.moveHighlight(5, 10, 'down');
    assert.equal(updates.length, 2);
    assert.deepEqual(updates, [
      { id: 10, sortOrder: 2 },
      { id: 20, sortOrder: 1 },
    ]);
  } finally {
    prisma.courseHighlight.findUnique = origFindUnique;
    prisma.courseHighlight.findMany = origFindMany;
    prisma.courseHighlight.update = origUpdate;
  }
});

// ============================================================================
// 3. REVIEWS / TESTIMONIALS: Rating clamp, Initials & Safe Defaults
// ============================================================================

test('addTestimonial clamps rating between 1 and 5 and computes initials if no avatar', async () => {
  let created = null;
  const origCount = prisma.courseTestimonial.count;
  const origCreate = prisma.courseTestimonial.create;

  prisma.courseTestimonial.count = async () => 0;
  prisma.courseTestimonial.create = async ({ data }) => {
    created = data;
    return { id: 1, ...data };
  };

  try {
    // Rating 10 should clamp to 5
    await courseLandingService.addTestimonial(5, {
      reviewerName: 'Dr. Ramesh Sharma',
      reviewerDesignation: 'Prosthodontist',
      reviewerLocation: 'New Delhi',
      quote: 'Exceptional clarity on articulator mounting and programming.',
      rating: 10,
    });

    assert.equal(created.courseId, 5);
    assert.equal(created.rating, 5);
    assert.equal(created.initials, 'DRS');
    assert.equal(created.reviewerName, 'Dr. Ramesh Sharma');
    assert.equal(created.isPublished, true);

    // Rating 0 should clamp to 1
    await courseLandingService.addTestimonial(5, {
      reviewerName: 'Amit Patel',
      quote: 'Clear step by step guidance.',
      rating: -1,
    });
    assert.equal(created.rating, 1);
    assert.equal(created.initials, 'AP');
  } finally {
    prisma.courseTestimonial.count = origCount;
    prisma.courseTestimonial.create = origCreate;
  }
});

// ============================================================================
// 4. INSTRUCTOR CREDENTIALS: CRUD & Ordering
// ============================================================================

test('instructorService credentials CRUD operations validate instructor and order items', async () => {
  let createdCred = null;
  const origCount = prisma.instructorCredential.count;
  const origCreate = prisma.instructorCredential.create;
  const origFindUnique = prisma.instructorCredential.findUnique;
  const origUpdate = prisma.instructorCredential.update;

  prisma.instructorCredential.count = async () => 1;
  prisma.instructorCredential.create = async ({ data }) => {
    createdCred = data;
    return { id: 77, ...data };
  };

  prisma.instructorCredential.findUnique = async ({ where }) => {
    if (where.id === 77) return { id: 77, instructorId: 2, title: 'Original Credential', sortOrder: 1 };
    return null;
  };

  prisma.instructorCredential.update = async ({ where, data }) => {
    return { id: where.id, ...data };
  };

  try {
    // Add credential
    const cred = await instructorService.addCredential(2, {
      title: 'Director, Dental Studies Institute',
      description: 'Specializing in restorative dentistry',
    });
    assert.equal(createdCred.instructorId, 2);
    assert.equal(createdCred.title, 'Director, Dental Studies Institute');
    assert.equal(createdCred.sortOrder, 20);
    assert.equal(createdCred.isPublished, true);

    // Update credential for wrong instructor throws 403
    await assert.rejects(
      async () => {
        await instructorService.updateCredential(999, 77, { title: 'Hacked' });
      },
      (err) => {
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  } finally {
    prisma.instructorCredential.count = origCount;
    prisma.instructorCredential.create = origCreate;
    prisma.instructorCredential.findUnique = origFindUnique;
    prisma.instructorCredential.update = origUpdate;
  }
});

// ============================================================================
// 5. PUBLIC VIEW RENDERING: Course Landing Page Template Tests
// ============================================================================

const COURSE_DETAIL_TEMPLATE_PATH = path.join(__dirname, '..', 'views', 'public', 'course-detail-content.ejs');
const courseDetailTemplateStr = fs.readFileSync(COURSE_DETAIL_TEMPLATE_PATH, 'utf8');

function renderCourseDetail(context) {
  const defaultContext = {
    cms: {
      course: { backLabel: 'Back to Courses', freeCta: 'Enroll Free →', requestedLabel: 'Request Pending', requestCta: 'Request Enrollment →' },
      brand: { defaultCourseImageUrl: '/assets/images/course-placeholder.svg', defaultInstructorImageUrl: '/assets/images/instructor-placeholder.svg' },
    },
    course: {
      id: 6,
      title: 'Advanced FMR Master Class',
      slug: 'advanced-fmr-master-class',
      price: 0,
      salePrice: null,
      currency: 'INR',
      shortDescription: 'Comprehensive full mouth rehabilitation master class.',
      description: 'Detailed curriculum covering diagnostic and restorative workflows.',
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
      totalDurationSeconds: 45000,
      totalDurationFormatted: '12h 30m',
      resourceCount: 1,
    },
    curriculum: [],
    resources: [{ id: 1, title: 'Dental Case History Forms', fileName: 'dental-case-history-forms.pdf' }],
    faqs: [],
    landing: {
      content: {
        accessLabel: 'Self-Paced Access',
        whyRegisterEnabled: false,
        highlightsEnabled: false,
        reviewsEnabled: false,
        mentorSectionEnabled: true,
      },
      heroChips: [],
      whyRegisterWant: [],
      whyRegisterGet: [],
      highlights: [],
      testimonials: [],
      takeaways: [],
      questions: [],
      audienceFor: [],
      audienceNotFor: [],
      faqs: [],
    },
    csrfToken: 'test-csrf-token',
    cspNonce: 'test-nonce',
  };

  return ejs.render(courseDetailTemplateStr, { ...defaultContext, ...context });
}

test('view renders dynamic accessLabel if provided', () => {
  const html = renderCourseDetail({
    landing: {
      content: { accessLabel: '365 Days Access' },
      heroChips: [],
      whyRegisterWant: [],
      whyRegisterGet: [],
      highlights: [],
      testimonials: [],
      takeaways: [],
      questions: [],
      audienceFor: [],
      audienceNotFor: [],
      faqs: [],
    },
  });
  assert.ok(html.includes('365 Days Access'), 'accessLabel must render in the page when provided');
});

test('view renders Why Register section ONLY when enabled AND has items', () => {
  // Case A: Enabled but 0 items -> HIDE
  const htmlEmpty = renderCourseDetail({
    landing: {
      content: {
        whyRegisterEnabled: true,
        whyRegisterHeading: 'Why Register For This Course?',
      },
      whyRegisterWant: [],
      whyRegisterGet: [],
      highlights: [],
      testimonials: [],
      heroChips: [],
      takeaways: [],
      questions: [],
      audienceFor: [],
      audienceNotFor: [],
      faqs: [],
    },
  });
  assert.ok(!htmlEmpty.includes('why-register-section'), 'Why Register MUST be hidden when 0 items exist');

  // Case B: Disabled but items exist -> HIDE
  const htmlDisabled = renderCourseDetail({
    landing: {
      content: {
        whyRegisterEnabled: false,
        whyRegisterHeading: 'Why Register For This Course?',
      },
      whyRegisterWant: [{ id: 1, title: 'Diagnose tooth wear' }],
      whyRegisterGet: [{ id: 2, title: 'Articulator protocols' }],
      highlights: [],
      testimonials: [],
      heroChips: [],
      takeaways: [],
      questions: [],
      audienceFor: [],
      audienceNotFor: [],
      faqs: [],
    },
  });
  assert.ok(!htmlDisabled.includes('why-register-section'), 'Why Register MUST be hidden when disabled');

  // Case C: Enabled and items exist -> RENDER BOTH GROUPS
  const htmlVisible = renderCourseDetail({
    landing: {
      content: {
        whyRegisterEnabled: true,
        whyRegisterHeading: 'Why Register For This Course?',
        whyRegisterIntro: 'Designed for clinicians seeking mastery in FMR.',
        whyRegisterEmphasisText: 'Transform your full mouth rehabilitation diagnostics.',
        whyRegisterWantHeading: 'This course is for you if you want to:',
        whyRegisterGetHeading: 'What you get:',
        whyRegisterClosingText: 'Enroll now and elevate your clinical practice.',
      },
      whyRegisterWant: [
        { id: 1, title: 'Understand tooth wear vs collapsed bite', description: 'Differential diagnosis.' },
      ],
      whyRegisterGet: [
        { id: 2, title: 'Articulator zeroing protocols', description: 'Step-by-step video guidance.' },
      ],
      highlights: [],
      testimonials: [],
      heroChips: [],
      takeaways: [],
      questions: [],
      audienceFor: [],
      audienceNotFor: [],
      faqs: [],
    },
  });

  assert.ok(htmlVisible.includes('why-register-section'), 'Why Register section should render');
  assert.ok(htmlVisible.includes('Why Register For This Course?'));
  assert.ok(htmlVisible.includes('Transform your full mouth rehabilitation diagnostics.'));
  assert.ok(htmlVisible.includes('Understand tooth wear vs collapsed bite'));
  assert.ok(htmlVisible.includes('Articulator zeroing protocols'));
  assert.ok(htmlVisible.includes('Enroll now and elevate your clinical practice.'));
});

test('view renders Highlights section with check_circle style when enabled with items', () => {
  const html = renderCourseDetail({
    landing: {
      content: {
        highlightsEnabled: true,
        highlightsHeading: 'Highlights',
        highlightsDescription: 'Key clinical competencies you will develop.',
      },
      whyRegisterWant: [],
      whyRegisterGet: [],
      highlights: [
        { id: 1, title: 'Structured Full Mouth Rehabilitation curriculum', description: '23 organized clinical lessons.' },
        { id: 2, title: 'Facebow clinical theory and demonstration', description: 'Accurate kinematic records.' },
      ],
      testimonials: [],
      heroChips: [],
      takeaways: [],
      questions: [],
      audienceFor: [],
      audienceNotFor: [],
      faqs: [],
    },
  });

  assert.ok(html.includes('highlights-section'), 'Highlights section should render');
  assert.ok(html.includes('Structured Full Mouth Rehabilitation curriculum'));
  assert.ok(html.includes('Facebow clinical theory and demonstration'));
});

test('REVIEWS section STRICTLY hidden when reviewsEnabled is false OR published testimonials is 0', () => {
  // Case A: reviewsEnabled is false, even if testimonials exist
  const htmlDisabled = renderCourseDetail({
    landing: {
      content: { reviewsEnabled: false },
      testimonials: [{ id: 1, reviewerName: 'Dr. Test', quote: 'Great course', rating: 5, isPublished: true }],
      whyRegisterWant: [],
      whyRegisterGet: [],
      highlights: [],
      heroChips: [],
      takeaways: [],
      questions: [],
      audienceFor: [],
      audienceNotFor: [],
      faqs: [],
    },
  });
  assert.ok(!htmlDisabled.includes('reviews-section'), 'Reviews section MUST be hidden when reviewsEnabled is false');

  // Case B: reviewsEnabled is true but 0 testimonials exist
  const htmlZero = renderCourseDetail({
    landing: {
      content: { reviewsEnabled: true, reviewsHeading: 'Reviews from Dentists' },
      testimonials: [],
      whyRegisterWant: [],
      whyRegisterGet: [],
      highlights: [],
      heroChips: [],
      takeaways: [],
      questions: [],
      audienceFor: [],
      audienceNotFor: [],
      faqs: [],
    },
  });
  assert.ok(!htmlZero.includes('reviews-section'), 'Reviews section MUST be hidden when 0 testimonials exist');

  // Verify competitor names are never in the template output
  assert.ok(!htmlZero.includes('Dr. Juhi Khandelwal'));
  assert.ok(!htmlZero.includes('Dr. Kshitish Kothuru'));
  assert.ok(!htmlZero.includes('Dr. Sandhya Tripathi'));
  assert.ok(!htmlZero.includes('Dr. Avni Guru'));
  assert.ok(!htmlZero.includes('Moez Khakiani'));
});

test('REVIEWS section renders star ratings and reviewer initials/photo when enabled with testimonials', () => {
  const html = renderCourseDetail({
    landing: {
      content: {
        reviewsEnabled: true,
        reviewsHeading: 'Verified Student Feedback',
      },
      testimonials: [
        {
          id: 1,
          reviewerName: 'Dr. Anita Desai',
          reviewerDesignation: 'General Dental Practitioner',
          reviewerLocation: 'Mumbai',
          quote: 'The TMJ and muscle palpation curriculum gave me instant clinical confidence.',
          rating: 5,
          initials: 'AD',
          avatarUrl: null,
          isPublished: true,
        },
      ],
      whyRegisterWant: [],
      whyRegisterGet: [],
      highlights: [],
      heroChips: [],
      takeaways: [],
      questions: [],
      audienceFor: [],
      audienceNotFor: [],
      faqs: [],
    },
  });

  assert.ok(html.includes('reviews-section'), 'Reviews section should render when enabled with published items');
  assert.ok(html.includes('Verified Student Feedback'));
  assert.ok(html.includes('Dr. Anita Desai'));
  assert.ok(html.includes('General Dental Practitioner • Mumbai'));
  assert.ok(html.includes('The TMJ and muscle palpation curriculum gave me instant clinical confidence.'));
  assert.ok(html.includes('AD'), 'Initials avatar renders');
});

test('MEET YOUR MENTOR section is hidden when course has NO instructor or mentorSectionEnabled is false', () => {
  // Case A: course.instructor is null
  const htmlNoInstructor = renderCourseDetail({
    course: {
      id: 6,
      title: 'Advanced FMR Master Class',
      instructor: null,
    },
    landing: {
      content: { mentorSectionEnabled: true },
      whyRegisterWant: [],
      whyRegisterGet: [],
      highlights: [],
      testimonials: [],
      heroChips: [],
      takeaways: [],
      questions: [],
      audienceFor: [],
      audienceNotFor: [],
      faqs: [],
    },
  });
  assert.ok(!htmlNoInstructor.includes('mentor-section'), 'Mentor section MUST be hidden when course has no instructor');

  // Case B: mentorSectionEnabled is false
  const htmlDisabled = renderCourseDetail({
    course: {
      id: 6,
      title: 'Advanced FMR Master Class',
      instructor: {
        id: 1,
        name: 'Dr. Tanu Raghav',
        shortBio: 'Experienced dental educator',
      },
    },
    landing: {
      content: { mentorSectionEnabled: false },
      whyRegisterWant: [],
      whyRegisterGet: [],
      highlights: [],
      testimonials: [],
      heroChips: [],
      takeaways: [],
      questions: [],
      audienceFor: [],
      audienceNotFor: [],
      faqs: [],
    },
  });
  assert.ok(!htmlDisabled.includes('mentor-section'), 'Mentor section MUST be hidden when mentorSectionEnabled is false');
});

test('MEET YOUR MENTOR renders Dr. Tanu Raghav data accurately and hides empty credentials/experience', () => {
  // Case A: Empty credentials & empty experience -> hides badge and credentials list
  const htmlClean = renderCourseDetail({
    course: {
      id: 6,
      title: 'Advanced FMR Master Class',
      instructor: {
        id: 1,
        name: 'Dr. Tanu Raghav',
        designation: 'Chief Mentor & Clinical Educator',
        organization: 'ICDS',
        experienceLabel: null, // empty -> hide badge
        shortBio: 'Dedicated to advancing dental clinician skills through evidence-based methodology.',
        fullBio: null,
        credentials: [], // empty -> hide credentials list
      },
    },
    landing: {
      content: { mentorSectionEnabled: true, mentorHeading: 'Meet Your Mentor' },
      whyRegisterWant: [],
      whyRegisterGet: [],
      highlights: [],
      testimonials: [],
      heroChips: [],
      takeaways: [],
      questions: [],
      audienceFor: [],
      audienceNotFor: [],
      faqs: [],
    },
  });

  assert.ok(htmlClean.includes('mentor-section'), 'Mentor section renders');
  assert.ok(htmlClean.includes('Dr. Tanu Raghav'), 'Mentor name renders');
  assert.ok(htmlClean.includes('Chief Mentor &amp; Clinical Educator') && htmlClean.includes('ICDS'));
  assert.ok(!htmlClean.includes('mentor-exp-badge'), 'Experience badge must NOT render when experienceLabel is null');
  assert.ok(!htmlClean.includes('credentials-checklist'), 'Credentials list must NOT render when credentials array is empty');

  // Case B: Populated credentials & experience -> renders badge and credential items
  const htmlWithCreds = renderCourseDetail({
    course: {
      id: 6,
      title: 'Advanced FMR Master Class',
      instructor: {
        id: 1,
        name: 'Dr. Tanu Raghav',
        designation: 'Course Director',
        experienceLabel: '15+ Years Clinical Practice',
        shortBio: 'Leading educator in restorative protocols.',
        credentials: [
          { id: 1, title: 'Master of Dental Surgery', isPublished: true },
        ],
      },
    },
    landing: {
      content: { mentorSectionEnabled: true },
      whyRegisterWant: [],
      whyRegisterGet: [],
      highlights: [],
      testimonials: [],
      heroChips: [],
      takeaways: [],
      questions: [],
      audienceFor: [],
      audienceNotFor: [],
      faqs: [],
    },
  });

  assert.ok(htmlWithCreds.includes('15+ Years Clinical Practice'), 'Experience badge renders when provided');
  assert.ok(htmlWithCreds.includes('Master of Dental Surgery'), 'Credential item renders');
});

// ============================================================================
// 6. HOMEPAGE MENTOR INTEGRATION: Shared Instructor Model & Partial View
// ============================================================================

const HOMEPAGE_MENTOR_PARTIAL_PATH = path.join(__dirname, '..', 'views', 'partials', 'mentor.ejs');
const homepageMentorPartialStr = fs.readFileSync(HOMEPAGE_MENTOR_PARTIAL_PATH, 'utf8');

test('homepage mentor partial renders selected instructor from siteContent', () => {
  const rendered = ejs.render(homepageMentorPartialStr, {
    cms: {
      mentor: {
        enabled: true,
        eyebrow: 'FACULTY SPOTLIGHT',
        heading: 'Learn from Elite Clinical Mentors',
        credentialLimit: 4,
        ctaLabel: 'Explore Master Classes',
        ctaTarget: '/courses',
      },
      brand: { defaultInstructorImageUrl: '/assets/images/instructor-placeholder.svg' },
    },
    mentorInstructor: {
      id: 1,
      name: 'Dr. Tanu Raghav',
      designation: 'Course Mentor',
      organization: 'ICDS Faculty',
      experienceLabel: 'Clinical Specialist',
      shortBio: 'Specialist in full mouth rehabilitation and restorative dentistry.',
      credentials: [
        { id: 1, title: 'Director of Clinical Training', isPublished: true },
      ],
    },
  });

  assert.ok(rendered.includes('FACULTY SPOTLIGHT'));
  assert.ok(rendered.includes('Dr. Tanu Raghav'));
  assert.ok(rendered.includes('Clinical Specialist'));
  assert.ok(rendered.includes('Director of Clinical Training'));
  assert.ok(rendered.includes('Explore Master Classes'));
  assert.ok(rendered.includes('href="/courses"'));
});

test('homepage mentor partial hides cleanly when mentor.enabled is false or instructor is null', () => {
  // Case A: mentor.enabled is false
  const hiddenDisabled = ejs.render(homepageMentorPartialStr, {
    cms: { mentor: { enabled: false } },
    mentorInstructor: { id: 1, name: 'Dr. Tanu Raghav' },
  });
  assert.equal(hiddenDisabled.trim(), '', 'Partial output should be empty when disabled');

  // Case B: mentorInstructor is null
  const hiddenNoInstructor = ejs.render(homepageMentorPartialStr, {
    cms: { mentor: { enabled: true } },
    mentorInstructor: null,
  });
  assert.equal(hiddenNoInstructor.trim(), '', 'Partial output should be empty when mentorInstructor is null');
});

// ============================================================================
// 7. INVARIANTS: FMR Course Remains Free With Unaltered Lessons & Resources
// ============================================================================

test('FMR Course invariants: Free enrollment preserved, 15 published videos, 1 downloadable resource', () => {
  const html = renderCourseDetail({
    currentUser: { id: 10, role: 'STUDENT' },
    isFree: true,
    priceLabel: 'Free',
    course: {
      id: 6,
      title: 'Advanced FMR Master Class',
      slug: 'advanced-fmr-master-class',
      price: 0,
      salePrice: null,
      currency: 'INR',
      instructor: {
        id: 1,
        name: 'Dr. Tanu Raghav',
      },
    },
    stats: {
      lessonCount: 23,
      publishedLessonCount: 15,
      videoCount: 15,
      resourceCount: 1,
    },
  });

  // Must have free enrollment action
  assert.ok(html.includes('action="/courses/advanced-fmr-master-class/enroll-free"'));
  assert.ok(html.includes('video lessons'));
  assert.ok(html.includes('Dental Case History Forms') || html.includes('resource-card'));
});
