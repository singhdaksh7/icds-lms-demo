const { prisma } = require('../config/db');

class CourseLandingError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'CourseLandingError';
    this.statusCode = statusCode;
  }
}

const DEFAULT_SECTION_ORDER = [
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
];

const SECTION_METADATA = {
  HERO: { name: 'Hero Section', tab: 'hero' },
  STATS: { name: 'Quick Stats Cards', tab: 'stats' },
  QUESTIONS: { name: 'Questions Answered', tab: 'questions' },
  WHY_REGISTER: { name: 'Why Register For This Course', tab: 'why-register' },
  CURRICULUM: { name: 'Detailed Course Curriculum', tab: 'curriculum' },
  HIGHLIGHTS: { name: 'Course Highlights', tab: 'highlights' },
  PURCHASE: { name: 'Access / Purchase Card', tab: 'purchase' },
  REVIEWS: { name: 'Reviews / Testimonials', tab: 'reviews' },
  COMPARISON: { name: 'Course Comparison', tab: 'comparison' },
  AUDIENCE: { name: 'Who Should Not Take / Ideal For', tab: 'audience' },
  ACCESS: { name: 'How You Get Access', tab: 'access' },
  RESOURCES: { name: 'Downloadable Resources', tab: 'resources' },
  MENTOR: { name: 'Meet Your Mentor', tab: 'mentor' },
  FAQ: { name: 'Frequently Asked Questions', tab: 'faqs' },
  SOCIAL_PROOF: { name: 'Social Proof Summary', tab: 'social-proof' },
  FINAL_CTA: { name: 'Final Conversion CTA', tab: 'final-cta' },
};

/**
 * Fetch all landing content and child models for admin editing
 */
async function getAdminLandingData(courseId) {
  const numericCourseId = parseInt(courseId, 10);
  if (!numericCourseId) throw new CourseLandingError('Invalid course id', 400);

  const [
    course,
    landingContent,
    heroChips,
    takeaways,
    questions,
    audienceItems,
    faqs,
    whyRegisterItems,
    highlights,
    testimonials,
    accessPlans,
    courseStats,
    comparisonColumns,
    accessSteps,
    rawLandingSections,
  ] = await Promise.all([
    prisma.course.findUnique({
      where: { id: numericCourseId },
      include: {
        category: true,
        instructor: {
          include: {
            credentials: { orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    }),
    prisma.courseLandingContent.findUnique({
      where: { courseId: numericCourseId },
    }),
    prisma.courseHeroChip.findMany({
      where: { courseId: numericCourseId },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseTakeaway.findMany({
      where: { courseId: numericCourseId },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseQuestion.findMany({
      where: { courseId: numericCourseId },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseAudienceItem.findMany({
      where: { courseId: numericCourseId },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseFaq.findMany({
      where: { courseId: numericCourseId },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseWhyRegisterItem.findMany({
      where: { courseId: numericCourseId },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseHighlight.findMany({
      where: { courseId: numericCourseId },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseTestimonial.findMany({
      where: { courseId: numericCourseId },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseAccessPlan.findMany({
      where: { courseId: numericCourseId },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseStat.findMany({
      where: { courseId: numericCourseId },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseComparisonColumn.findMany({
      where: { courseId: numericCourseId },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
      },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseAccessStep.findMany({
      where: { courseId: numericCourseId },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseLandingSection.findMany({
      where: { courseId: numericCourseId },
      orderBy: { sortOrder: 'asc' },
    }),
  ]);

  if (!course) throw new CourseLandingError('Course not found', 404);

  // Normalize landing sections: if none in DB or missing any keys, overlay defaults
  let landingSections = rawLandingSections || [];
  if (landingSections.length === 0) {
    landingSections = DEFAULT_SECTION_ORDER.map((sectionKey, idx) => ({
      id: idx + 1,
      courseId: numericCourseId,
      sectionKey,
      sortOrder: (idx + 1) * 10,
      isEnabled: true,
      name: SECTION_METADATA[sectionKey]?.name || sectionKey,
      tab: SECTION_METADATA[sectionKey]?.tab || 'hero',
    }));
  } else {
    landingSections = landingSections.map((sec) => ({
      ...sec,
      name: SECTION_METADATA[sec.sectionKey]?.name || sec.sectionKey,
      tab: SECTION_METADATA[sec.sectionKey]?.tab || 'hero',
    }));
  }

  return {
    course,
    landingContent: landingContent || getDefaultLandingSettings(course),
    heroChips,
    takeaways,
    questions,
    audienceItems,
    faqs,
    whyRegisterItems,
    highlights,
    testimonials,
    accessPlans,
    courseStats,
    comparisonColumns,
    accessSteps,
    landingSections,
  };
}

/**
 * Default fallback landing settings object when no DB row exists yet
 */
function getDefaultLandingSettings(course) {
  return {
    heroEyebrow: course.category ? `${course.category.name} • Online Certificate Course` : 'Online Certificate Course',
    heroTitleOverride: '',
    heroAccentText: '',
    heroDescription: course.shortDescription || course.description || '',
    heroMediaType: 'THUMBNAIL',
    heroMediaUrl: '',
    heroMediaCaption: '100% Verified Clinical Curriculum',
    secondaryCtaLabel: 'Explore Curriculum',
    secondaryCtaTarget: '#curriculum',
    priceSubtitle: 'Full Lifetime Access',
    accessLabel: '',

    whyRegisterEnabled: true,
    whyRegisterEyebrow: 'Why Register For This Course?',
    whyRegisterHeading: 'Master Full Mouth Rehabilitation with Clinical Predictability',
    whyRegisterIntro: 'Full mouth rehabilitation requires a structured approach to occlusal diagnostics, vertical dimension determination, and systematic clinical execution.',
    whyRegisterEmphasisText: 'Gain the confidence to evaluate, plan, and execute complex full mouth cases systematically.',
    whyRegisterWantHeading: 'This course is for you if you want to:',
    whyRegisterGetHeading: 'What you get:',
    whyRegisterClosingText: 'Take your restorative dentistry skills to the master level.',

    highlightsEnabled: true,
    highlightsEyebrow: 'Course Highlights',
    highlightsHeading: 'Course Highlights',
    highlightsDescription: 'Key pillars and clinical skills covered in this masterclass.',

    aboutEnabled: true,
    aboutEyebrow: course.category ? course.category.name : 'Clinical Fundamentals',
    aboutHeading: 'About This Masterclass',
    aboutBody: course.description || '',

    takeawaysEnabled: true,
    takeawaysEyebrow: 'Masterclass Learning Outcomes',
    takeawaysHeading: 'What clinicians will learn in this master class',
    takeawaysDescription: '',

    sneakPeekEnabled: true,
    sneakPeekEyebrow: 'A Sneak Peek',
    sneakPeekHeading: 'See the learning experience before you enroll',
    sneakPeekDescription: 'Watch this clinical preview to experience the depth, clarity, and systematic presentation style of the course.',
    sneakPeekMediaUrl: '',

    questionsEnabled: true,
    questionsEyebrow: 'Clinical Fundamentals',
    questionsHeading: 'Core clinical questions this masterclass helps you answer',

    curriculumEnabled: true,
    curriculumEyebrow: 'Course Curriculum',
    curriculumHeading: 'Structured modules for dentists',
    curriculumIntro: 'Learn the essential clinical workflow through structured modules covering occlusal foundations, centric relation, facebow transfer, articulators, vertical dimension, and comprehensive case planning.',
    curriculumDefaultExpanded: true,
    showLessonDuration: true,
    showLockIcon: true,
    showPreviewBadge: true,
    curriculumShowSessionCount: true,
    curriculumShowTotalDuration: true,
    curriculumShowResourceCount: true,

    purchaseCardEnabled: true,
    purchaseCardEyebrow: 'Full Masterclass Access',
    purchaseCardHeading: 'Enroll in this Masterclass',
    purchaseCardDescription: 'Gain comprehensive access to all modules, clinical demonstrations, and verified clinical documentation.',
    purchaseCardButtonLabel: '',

    comparisonEnabled: false,
    comparisonEyebrow: 'Curriculum Comparison',
    comparisonHeading: 'Choose the level that fits your practice',
    comparisonDescription: 'Compare course depth, demonstrated procedures, and access terms.',

    accessSectionEnabled: false,
    accessEyebrow: 'Access Protocol',
    accessHeading: 'How will you get access to the course?',
    accessDescription: 'Simple, direct steps to start streaming lessons immediately.',
    accessMediaType: 'NONE',
    accessMediaUrl: '',
    accessStepsEnabled: true,

    socialProofEnabled: false,
    socialProofMode: 'AUTO',
    socialProofValue: '',
    socialProofLabel: 'Verified Clinician Reviews',

    reviewsEnabled: false, // Critical: OFF by default unless genuine testimonials exist!
    reviewsEyebrow: 'Student Reviews',
    reviewsHeading: 'Reviews from dentists who transformed their practice with this masterclass',
    reviewsIntro: '',

    mentorSectionEnabled: true,
    mentorEyebrow: 'Meet Your Mentor',
    mentorHeading: 'Learn from an Experienced Clinician',

    certificateSectionEnabled: false, // Critical: OFF by default!
    certificateEyebrow: 'E-Certificate',
    certificateHeading: 'Recognize your progress in this course',
    certificateBody: 'Upon completion of all video lessons and clinical evaluations, you will receive an official verifiable digital Certificate of Completion recognizing your mastery and commitment to advancing clinical patient care.',
    certificateNote: 'Certificate issued digitally after verified curriculum completion.',

    audienceEnabled: true,
    audienceEyebrow: 'Candidate Profile',
    audienceHeading: 'Is this online Master Class right for you?',
    audienceForHeading: 'Good fit for',
    audienceNotForHeading: 'Probably not for',

    faqEnabled: true,
    faqEyebrow: 'Questions & Answers',
    faqHeading: 'Frequently asked course questions',

    finalCtaEnabled: true,
    finalCtaEyebrow: 'Start Learning Today',
    finalCtaHeading: `Enroll in ${course.title}`,
    finalCtaBody: 'Immediate online access to all structured video lessons, clinical demonstrations, and downloadable forms.',
    finalCtaButtonLabel: '',
    finalCtaBadgeText: '✓ 100% Free · Full Access',
    finalCtaLine1: 'Instant online streaming access',
    finalCtaLine2: 'Structured, evidence-based clinical curriculum',
    finalCtaLine3: 'Verified clinical documentation tools included',

    stickyCtaEnabled: true,
    stickyCtaText: 'Full Lifetime Access',
    stickyCtaButtonLabel: '',
  };
}

/**
 * Resolves dynamic auto stat values against course context
 */
function resolveCourseStats(dbStats, context = {}) {
  if (!dbStats || dbStats.length === 0) return [];
  return dbStats.map((s) => {
    let resolvedValue = s.value;
    if (s.statType === 'PUBLISHED_VIDEO_COUNT') {
      resolvedValue = String(context.videoCount || context.publishedLessonCount || '0');
    } else if (s.statType === 'TOTAL_VIDEO_DURATION') {
      resolvedValue = context.totalDurationFormatted || 'Self-Paced';
    } else if (s.statType === 'RESOURCE_COUNT') {
      resolvedValue = String(context.resourceCount || '0');
    } else if (s.statType === 'MODULE_COUNT') {
      resolvedValue = String(context.publishedModuleCount || context.moduleCount || '0');
    } else if (s.statType === 'TOPIC_COUNT') {
      resolvedValue = String(context.publishedTopicCount || context.topicCount || '0');
    } else if (s.statType === 'REVIEW_COUNT') {
      resolvedValue = String(context.reviewCount || '0');
    }
    return {
      ...s,
      displayValue: resolvedValue || s.value || '',
    };
  });
}

/**
 * Fetch public landing data for rendering views/public/course-detail.ejs
 */
async function getPublicLandingData(courseId, courseStatsContext = {}, options = {}) {
  const numericCourseId = parseInt(courseId, 10);
  if (!numericCourseId) return null;

  const resolvedOptions = (courseStatsContext && typeof courseStatsContext.includeDemo !== 'undefined')
    ? courseStatsContext
    : (options || {});
  const includeDemo = Boolean(resolvedOptions && resolvedOptions.includeDemo);
  const testimonialWhere = {
    courseId: numericCourseId,
    isPublished: true,
    ...(includeDemo ? {} : { isDemo: false }),
  };

  const [
    landingContent,
    heroChips,
    takeaways,
    questions,
    audienceItems,
    faqs,
    whyRegisterItems,
    highlights,
    testimonials,
    accessPlans,
    rawCourseStats,
    comparisonColumns,
    accessSteps,
    rawLandingSections,
    realReviewsAggregate,
  ] = await Promise.all([
    prisma.courseLandingContent.findUnique({
      where: { courseId: numericCourseId },
    }),
    prisma.courseHeroChip.findMany({
      where: { courseId: numericCourseId, isPublished: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseTakeaway.findMany({
      where: { courseId: numericCourseId, isPublished: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseQuestion.findMany({
      where: { courseId: numericCourseId, isPublished: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseAudienceItem.findMany({
      where: { courseId: numericCourseId, isPublished: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseFaq.findMany({
      where: { courseId: numericCourseId, isPublished: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseWhyRegisterItem.findMany({
      where: { courseId: numericCourseId, isPublished: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseHighlight.findMany({
      where: { courseId: numericCourseId, isPublished: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseTestimonial.findMany({
      where: testimonialWhere,
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseAccessPlan.findMany({
      where: { courseId: numericCourseId, isPublished: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseStat.findMany({
      where: { courseId: numericCourseId, isPublished: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseComparisonColumn.findMany({
      where: { courseId: numericCourseId, isPublished: true },
      include: {
        items: {
          where: { isPublished: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseAccessStep.findMany({
      where: { courseId: numericCourseId, isPublished: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseLandingSection.findMany({
      where: { courseId: numericCourseId },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courseTestimonial.aggregate({
      where: { courseId: numericCourseId, isPublished: true, isDemo: false },
      _count: { id: true },
      _avg: { rating: true },
    }),
  ]);

  const realReviewCount = (realReviewsAggregate && realReviewsAggregate._count) ? realReviewsAggregate._count.id : 0;
  const realAverageRating = (realReviewsAggregate && realReviewsAggregate._avg && realReviewsAggregate._avg.rating) ? realReviewsAggregate._avg.rating : 0;

  // Real review count strictly powers stats and social proof (never contaminated by demo reviews)
  const resolvedContext = {
    ...courseStatsContext,
    reviewCount: realReviewCount,
  };

  // If social proof is AUTO mode, require genuine published reviews
  if (landingContent && landingContent.socialProofMode === 'AUTO') {
    if (realReviewCount === 0) {
      landingContent.socialProofEnabled = false;
    } else {
      landingContent.socialProofValue = `${realReviewCount}+ Genuine Reviews`;
    }
  }

  // Dynamic Auto Stat values
  const courseStats = resolveCourseStats(rawCourseStats, resolvedContext);

  // Resolved section order: use DB order if exists, otherwise default 16-section flow
  let landingSections = [];
  if (rawLandingSections && rawLandingSections.length > 0) {
    landingSections = rawLandingSections
      .filter((s) => s.isEnabled)
      .map((s) => s.sectionKey);
  } else {
    landingSections = [...DEFAULT_SECTION_ORDER];
  }

  return {
    content: landingContent || {},
    heroChips,
    takeaways,
    questions,
    audienceFor: audienceItems.filter((item) => item.type === 'FOR'),
    audienceNotFor: audienceItems.filter((item) => item.type === 'NOT_FOR'),
    faqs,
    whyRegisterWant: whyRegisterItems.filter((item) => item.type === 'WANT'),
    whyRegisterGet: whyRegisterItems.filter((item) => item.type === 'GET'),
    highlights,
    testimonials,
    realReviewCount,
    realAverageRating,
    accessPlans,
    courseStats,
    comparisonColumns,
    accessSteps,
    landingSections,
  };
}

/**
 * Upsert main landing content settings
 */
async function upsertLandingSettings(courseId, payload) {
  const numericCourseId = parseInt(courseId, 10);
  if (!numericCourseId) throw new CourseLandingError('Invalid course id', 400);

  const cleanString = (val, max = 255) => {
    if (val === undefined || val === null) return null;
    const trimmed = String(val).trim();
    return trimmed ? trimmed.slice(0, max) : null;
  };

  const cleanBool = (val, defaultVal = false) => {
    if (val === undefined || val === null) return defaultVal;
    return val === true || val === 'true' || val === 'on' || val === '1' || val === 1;
  };

  const data = {
    heroEnabled: cleanBool(payload.heroEnabled, true),
    heroEyebrow: cleanString(payload.heroEyebrow, 255),
    heroTitleOverride: cleanString(payload.heroTitleOverride, 255),
    heroAccentText: cleanString(payload.heroAccentText, 255),
    heroDescription: cleanString(payload.heroDescription, 5000),
    heroMediaType: cleanString(payload.heroMediaType, 50) || 'THUMBNAIL',
    heroMediaUrl: cleanString(payload.heroMediaUrl, 500),
    heroMediaCaption: cleanString(payload.heroMediaCaption, 255),
    heroPrimaryCtaLabel: cleanString(payload.heroPrimaryCtaLabel, 100),
    secondaryCtaLabel: cleanString(payload.secondaryCtaLabel, 100) || 'Explore Curriculum',
    secondaryCtaTarget: cleanString(payload.secondaryCtaTarget, 255) || '#curriculum',
    priceSubtitle: cleanString(payload.priceSubtitle, 100),
    accessLabel: cleanString(payload.accessLabel, 100),

    whyRegisterEnabled: cleanBool(payload.whyRegisterEnabled, true),
    whyRegisterEyebrow: cleanString(payload.whyRegisterEyebrow, 100),
    whyRegisterHeading: cleanString(payload.whyRegisterHeading, 255),
    whyRegisterIntro: cleanString(payload.whyRegisterIntro, 5000),
    whyRegisterEmphasisText: cleanString(payload.whyRegisterEmphasisText, 5000),
    whyRegisterWantHeading: cleanString(payload.whyRegisterWantHeading, 255) || 'This course is for you if you want to:',
    whyRegisterGetHeading: cleanString(payload.whyRegisterGetHeading, 255) || 'What you get:',
    whyRegisterClosingText: cleanString(payload.whyRegisterClosingText, 5000),

    highlightsEnabled: cleanBool(payload.highlightsEnabled, true),
    highlightsEyebrow: cleanString(payload.highlightsEyebrow, 100) || 'Course Highlights',
    highlightsHeading: cleanString(payload.highlightsHeading, 255) || 'Course Highlights',
    highlightsDescription: cleanString(payload.highlightsDescription, 5000),

    aboutEnabled: cleanBool(payload.aboutEnabled, true),
    aboutEyebrow: cleanString(payload.aboutEyebrow, 100),
    aboutHeading: cleanString(payload.aboutHeading, 255),
    aboutBody: cleanString(payload.aboutBody, 10000),

    takeawaysEnabled: cleanBool(payload.takeawaysEnabled, true),
    takeawaysEyebrow: cleanString(payload.takeawaysEyebrow, 100),
    takeawaysHeading: cleanString(payload.takeawaysHeading, 255),
    takeawaysDescription: cleanString(payload.takeawaysDescription, 5000),

    sneakPeekEnabled: cleanBool(payload.sneakPeekEnabled, true),
    sneakPeekEyebrow: cleanString(payload.sneakPeekEyebrow, 100),
    sneakPeekHeading: cleanString(payload.sneakPeekHeading, 255),
    sneakPeekDescription: cleanString(payload.sneakPeekDescription, 5000),
    sneakPeekMediaUrl: cleanString(payload.sneakPeekMediaUrl, 500),

    questionsEnabled: cleanBool(payload.questionsEnabled, true),
    questionsEyebrow: cleanString(payload.questionsEyebrow, 100),
    questionsHeading: cleanString(payload.questionsHeading, 255),

    curriculumEnabled: cleanBool(payload.curriculumEnabled, true),
    curriculumEyebrow: cleanString(payload.curriculumEyebrow, 100),
    curriculumHeading: cleanString(payload.curriculumHeading, 255),
    curriculumIntro: cleanString(payload.curriculumIntro, 5000),
    curriculumDefaultExpanded: cleanBool(payload.curriculumDefaultExpanded, true),
    showLessonDuration: cleanBool(payload.showLessonDuration, true),
    showLockIcon: cleanBool(payload.showLockIcon, true),
    showPreviewBadge: cleanBool(payload.showPreviewBadge, true),
    curriculumShowSessionCount: cleanBool(payload.curriculumShowSessionCount, true),
    curriculumShowTotalDuration: cleanBool(payload.curriculumShowTotalDuration, true),
    curriculumShowResourceCount: cleanBool(payload.curriculumShowResourceCount, true),

    purchaseCardEnabled: cleanBool(payload.purchaseCardEnabled, true),
    purchaseCardEyebrow: cleanString(payload.purchaseCardEyebrow, 100),
    purchaseCardHeading: cleanString(payload.purchaseCardHeading, 255),
    purchaseCardDescription: cleanString(payload.purchaseCardDescription, 5000),
    purchaseCardButtonLabel: cleanString(payload.purchaseCardButtonLabel, 100),

    comparisonEnabled: cleanBool(payload.comparisonEnabled, false),
    comparisonEyebrow: cleanString(payload.comparisonEyebrow, 100),
    comparisonHeading: cleanString(payload.comparisonHeading, 255),
    comparisonDescription: cleanString(payload.comparisonDescription, 5000),

    accessSectionEnabled: cleanBool(payload.accessSectionEnabled, false),
    accessEyebrow: cleanString(payload.accessEyebrow, 100),
    accessHeading: cleanString(payload.accessHeading, 255),
    accessDescription: cleanString(payload.accessDescription, 5000),
    accessMediaType: cleanString(payload.accessMediaType, 20) || 'NONE',
    accessMediaUrl: cleanString(payload.accessMediaUrl, 500),
    accessStepsEnabled: cleanBool(payload.accessStepsEnabled, true),

    socialProofEnabled: cleanBool(payload.socialProofEnabled, false),
    socialProofMode: cleanString(payload.socialProofMode, 20) || 'AUTO',
    socialProofValue: cleanString(payload.socialProofValue, 100),
    socialProofLabel: cleanString(payload.socialProofLabel, 255),

    reviewsEnabled: cleanBool(payload.reviewsEnabled, false),
    reviewsEyebrow: cleanString(payload.reviewsEyebrow, 100),
    reviewsHeading: cleanString(payload.reviewsHeading, 255),
    reviewsIntro: cleanString(payload.reviewsIntro, 5000),

    mentorSectionEnabled: cleanBool(payload.mentorSectionEnabled, true),
    mentorEyebrow: cleanString(payload.mentorEyebrow, 100),
    mentorHeading: cleanString(payload.mentorHeading, 255),

    certificateSectionEnabled: cleanBool(payload.certificateSectionEnabled, false),
    certificateEyebrow: cleanString(payload.certificateEyebrow, 100),
    certificateHeading: cleanString(payload.certificateHeading, 255),
    certificateBody: cleanString(payload.certificateBody, 5000),
    certificateNote: cleanString(payload.certificateNote, 255),

    audienceEnabled: cleanBool(payload.audienceEnabled, true),
    audienceEyebrow: cleanString(payload.audienceEyebrow, 100),
    audienceHeading: cleanString(payload.audienceHeading, 255),
    audienceForHeading: cleanString(payload.audienceForHeading, 100) || 'Good fit for',
    audienceNotForHeading: cleanString(payload.audienceNotForHeading, 100) || 'Probably not for',

    faqEnabled: cleanBool(payload.faqEnabled, true),
    faqEyebrow: cleanString(payload.faqEyebrow, 100),
    faqHeading: cleanString(payload.faqHeading, 255),

    finalCtaEnabled: cleanBool(payload.finalCtaEnabled, true),
    finalCtaEyebrow: cleanString(payload.finalCtaEyebrow, 100),
    finalCtaHeading: cleanString(payload.finalCtaHeading, 255),
    finalCtaBody: cleanString(payload.finalCtaBody, 5000),
    finalCtaButtonLabel: cleanString(payload.finalCtaButtonLabel, 100),
    finalCtaBadgeText: cleanString(payload.finalCtaBadgeText, 255),
    finalCtaLine1: cleanString(payload.finalCtaLine1, 255),
    finalCtaLine2: cleanString(payload.finalCtaLine2, 255),
    finalCtaLine3: cleanString(payload.finalCtaLine3, 255),

    stickyCtaEnabled: cleanBool(payload.stickyCtaEnabled, true),
    stickyCtaText: cleanString(payload.stickyCtaText, 255),
    stickyCtaButtonLabel: cleanString(payload.stickyCtaButtonLabel, 100),
  };

  return prisma.courseLandingContent.upsert({
    where: { courseId: numericCourseId },
    create: { courseId: numericCourseId, ...data },
    update: data,
  });
}

// ============================================================================
// 1. Hero Chips
// ============================================================================

async function addHeroChip(courseId, { label, sortOrder = 0, isPublished = true }) {
  if (!label || !String(label).trim()) throw new CourseLandingError('Chip label is required');
  const count = await prisma.courseHeroChip.count({ where: { courseId } });
  return prisma.courseHeroChip.create({
    data: {
      courseId,
      label: String(label).trim().slice(0, 100),
      sortOrder: Number(sortOrder) || count * 10 + 10,
      isPublished: cleanBoolValue(isPublished),
    },
  });
}

async function updateHeroChip(courseId, chipId, { label, isPublished }) {
  const chip = await prisma.courseHeroChip.findUnique({ where: { id: chipId } });
  if (!chip) throw new CourseLandingError('Hero chip not found', 404);
  if (chip.courseId !== courseId) throw new CourseLandingError('Chip does not belong to this course', 403);
  return prisma.courseHeroChip.update({
    where: { id: chipId },
    data: {
      ...(label !== undefined ? { label: String(label).trim().slice(0, 100) } : {}),
      ...(isPublished !== undefined ? { isPublished: cleanBoolValue(isPublished) } : {}),
    },
  });
}

async function deleteHeroChip(courseId, chipId) {
  const chip = await prisma.courseHeroChip.findUnique({ where: { id: chipId } });
  if (!chip) throw new CourseLandingError('Hero chip not found', 404);
  if (chip.courseId !== courseId) throw new CourseLandingError('Chip does not belong to this course', 403);
  return prisma.courseHeroChip.delete({ where: { id: chipId } });
}

async function moveHeroChip(courseId, chipId, direction) {
  const chip = await prisma.courseHeroChip.findUnique({ where: { id: chipId } });
  if (!chip) throw new CourseLandingError('Hero chip not found', 404);
  if (chip.courseId !== courseId) throw new CourseLandingError('Chip does not belong to this course', 403);
  return reorderItem(prisma.courseHeroChip, { courseId }, chipId, direction);
}

// ============================================================================
// 2. Takeaways
// ============================================================================

async function addTakeaway(courseId, { title, description, icon, sortOrder = 0, isPublished = true }) {
  if (!title || !String(title).trim()) throw new CourseLandingError('Takeaway title is required');
  if (!description || !String(description).trim()) throw new CourseLandingError('Takeaway description is required');
  const count = await prisma.courseTakeaway.count({ where: { courseId } });
  return prisma.courseTakeaway.create({
    data: {
      courseId,
      title: String(title).trim().slice(0, 200),
      description: String(description).trim(),
      icon: icon ? String(icon).trim().slice(0, 50) : null,
      sortOrder: Number(sortOrder) || count * 10 + 10,
      isPublished: cleanBoolValue(isPublished),
    },
  });
}

async function updateTakeaway(courseId, takeawayId, { title, description, icon, isPublished }) {
  const item = await prisma.courseTakeaway.findUnique({ where: { id: takeawayId } });
  if (!item) throw new CourseLandingError('Takeaway not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Takeaway does not belong to this course', 403);
  return prisma.courseTakeaway.update({
    where: { id: takeawayId },
    data: {
      ...(title !== undefined ? { title: String(title).trim().slice(0, 200) } : {}),
      ...(description !== undefined ? { description: String(description).trim() } : {}),
      ...(icon !== undefined ? { icon: icon ? String(icon).trim().slice(0, 50) : null } : {}),
      ...(isPublished !== undefined ? { isPublished: cleanBoolValue(isPublished) } : {}),
    },
  });
}

async function deleteTakeaway(courseId, takeawayId) {
  const item = await prisma.courseTakeaway.findUnique({ where: { id: takeawayId } });
  if (!item) throw new CourseLandingError('Takeaway not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Takeaway does not belong to this course', 403);
  return prisma.courseTakeaway.delete({ where: { id: takeawayId } });
}

async function moveTakeaway(courseId, takeawayId, direction) {
  const item = await prisma.courseTakeaway.findUnique({ where: { id: takeawayId } });
  if (!item) throw new CourseLandingError('Takeaway not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Takeaway does not belong to this course', 403);
  return reorderItem(prisma.courseTakeaway, { courseId }, takeawayId, direction);
}

// ============================================================================
// 3. Clinical Questions
// ============================================================================

async function addQuestion(courseId, { question, description, sortOrder = 0, isPublished = true }) {
  if (!question || !String(question).trim()) throw new CourseLandingError('Question text is required');
  const count = await prisma.courseQuestion.count({ where: { courseId } });
  return prisma.courseQuestion.create({
    data: {
      courseId,
      question: String(question).trim().slice(0, 300),
      description: description ? String(description).trim() : null,
      sortOrder: Number(sortOrder) || count * 10 + 10,
      isPublished: cleanBoolValue(isPublished),
    },
  });
}

async function updateQuestion(courseId, questionId, { question, description, isPublished }) {
  const item = await prisma.courseQuestion.findUnique({ where: { id: questionId } });
  if (!item) throw new CourseLandingError('Question not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Question does not belong to this course', 403);
  return prisma.courseQuestion.update({
    where: { id: questionId },
    data: {
      ...(question !== undefined ? { question: String(question).trim().slice(0, 300) } : {}),
      ...(description !== undefined ? { description: description ? String(description).trim() : null } : {}),
      ...(isPublished !== undefined ? { isPublished: cleanBoolValue(isPublished) } : {}),
    },
  });
}

async function deleteQuestion(courseId, questionId) {
  const item = await prisma.courseQuestion.findUnique({ where: { id: questionId } });
  if (!item) throw new CourseLandingError('Question not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Question does not belong to this course', 403);
  return prisma.courseQuestion.delete({ where: { id: questionId } });
}

async function moveQuestion(courseId, questionId, direction) {
  const item = await prisma.courseQuestion.findUnique({ where: { id: questionId } });
  if (!item) throw new CourseLandingError('Question not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Question does not belong to this course', 403);
  return reorderItem(prisma.courseQuestion, { courseId }, questionId, direction);
}

// ============================================================================
// 4. Target Audience Items
// ============================================================================

async function addAudienceItem(courseId, { type = 'FOR', title, description, sortOrder = 0, isPublished = true }) {
  if (!title || !String(title).trim()) throw new CourseLandingError('Audience title is required');
  const itemType = String(type).trim().toUpperCase() === 'NOT_FOR' ? 'NOT_FOR' : 'FOR';
  const count = await prisma.courseAudienceItem.count({ where: { courseId, type: itemType } });
  return prisma.courseAudienceItem.create({
    data: {
      courseId,
      type: itemType,
      title: String(title).trim().slice(0, 300),
      description: description ? String(description).trim() : null,
      sortOrder: Number(sortOrder) || count * 10 + 10,
      isPublished: cleanBoolValue(isPublished),
    },
  });
}

async function updateAudienceItem(courseId, itemId, { title, description, isPublished, type }) {
  const item = await prisma.courseAudienceItem.findUnique({ where: { id: itemId } });
  if (!item) throw new CourseLandingError('Audience item not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Audience item does not belong to this course', 403);
  const cleanType = type !== undefined ? (String(type).trim().toUpperCase() === 'NOT_FOR' ? 'NOT_FOR' : 'FOR') : undefined;
  return prisma.courseAudienceItem.update({
    where: { id: itemId },
    data: {
      ...(cleanType !== undefined ? { type: cleanType } : {}),
      ...(title !== undefined ? { title: String(title).trim().slice(0, 300) } : {}),
      ...(description !== undefined ? { description: description ? String(description).trim() : null } : {}),
      ...(isPublished !== undefined ? { isPublished: cleanBoolValue(isPublished) } : {}),
    },
  });
}

async function deleteAudienceItem(courseId, itemId) {
  const item = await prisma.courseAudienceItem.findUnique({ where: { id: itemId } });
  if (!item) throw new CourseLandingError('Audience item not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Audience item does not belong to this course', 403);
  return prisma.courseAudienceItem.delete({ where: { id: itemId } });
}

async function moveAudienceItem(courseId, itemId, direction) {
  const item = await prisma.courseAudienceItem.findUnique({ where: { id: itemId } });
  if (!item) throw new CourseLandingError('Audience item not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Audience item does not belong to this course', 403);
  return reorderItem(prisma.courseAudienceItem, { courseId, type: item.type }, itemId, direction);
}

// ============================================================================
// 5. Course FAQs
// ============================================================================

async function addCourseFaq(courseId, { question, answer, sortOrder = 0, isPublished = true }) {
  if (!question || !String(question).trim()) throw new CourseLandingError('FAQ question is required');
  if (!answer || !String(answer).trim()) throw new CourseLandingError('FAQ answer is required');
  const count = await prisma.courseFaq.count({ where: { courseId } });
  return prisma.courseFaq.create({
    data: {
      courseId,
      question: String(question).trim().slice(0, 300),
      answer: String(answer).trim(),
      sortOrder: Number(sortOrder) || count * 10 + 10,
      isPublished: cleanBoolValue(isPublished),
    },
  });
}

async function updateCourseFaq(courseId, faqId, { question, answer, isPublished }) {
  const item = await prisma.courseFaq.findUnique({ where: { id: faqId } });
  if (!item) throw new CourseLandingError('Course FAQ not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Course FAQ does not belong to this course', 403);
  return prisma.courseFaq.update({
    where: { id: faqId },
    data: {
      ...(question !== undefined ? { question: String(question).trim().slice(0, 300) } : {}),
      ...(answer !== undefined ? { answer: String(answer).trim() } : {}),
      ...(isPublished !== undefined ? { isPublished: cleanBoolValue(isPublished) } : {}),
    },
  });
}

async function deleteCourseFaq(courseId, faqId) {
  const item = await prisma.courseFaq.findUnique({ where: { id: faqId } });
  if (!item) throw new CourseLandingError('Course FAQ not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Course FAQ does not belong to this course', 403);
  return prisma.courseFaq.delete({ where: { id: faqId } });
}

async function moveCourseFaq(courseId, faqId, direction) {
  const item = await prisma.courseFaq.findUnique({ where: { id: faqId } });
  if (!item) throw new CourseLandingError('Course FAQ not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Course FAQ does not belong to this course', 403);
  return reorderItem(prisma.courseFaq, { courseId }, faqId, direction);
}

// ============================================================================
// 6. Why Register Items
// ============================================================================

async function addWhyRegisterItem(courseId, { type = 'WANT', title, description, icon, sortOrder = 0, isPublished = true }) {
  if (!title || !String(title).trim()) throw new CourseLandingError('Item title is required');
  const cleanType = String(type).trim().toUpperCase() === 'GET' ? 'GET' : 'WANT';
  const count = await prisma.courseWhyRegisterItem.count({ where: { courseId, type: cleanType } });
  return prisma.courseWhyRegisterItem.create({
    data: {
      courseId,
      type: cleanType,
      title: String(title).trim().slice(0, 300),
      description: description ? String(description).trim() : null,
      icon: icon ? String(icon).trim().slice(0, 50) : null,
      sortOrder: Number(sortOrder) || count * 10 + 10,
      isPublished: cleanBoolValue(isPublished),
    },
  });
}

async function updateWhyRegisterItem(courseId, itemId, { type, title, description, icon, isPublished }) {
  const item = await prisma.courseWhyRegisterItem.findUnique({ where: { id: itemId } });
  if (!item) throw new CourseLandingError('Why Register item not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Item does not belong to this course', 403);
  const cleanType = type !== undefined ? (String(type).trim().toUpperCase() === 'GET' ? 'GET' : 'WANT') : undefined;
  return prisma.courseWhyRegisterItem.update({
    where: { id: itemId },
    data: {
      ...(cleanType !== undefined ? { type: cleanType } : {}),
      ...(title !== undefined ? { title: String(title).trim().slice(0, 300) } : {}),
      ...(description !== undefined ? { description: description ? String(description).trim() : null } : {}),
      ...(icon !== undefined ? { icon: icon ? String(icon).trim().slice(0, 50) : null } : {}),
      ...(isPublished !== undefined ? { isPublished: cleanBoolValue(isPublished) } : {}),
    },
  });
}

async function deleteWhyRegisterItem(courseId, itemId) {
  const item = await prisma.courseWhyRegisterItem.findUnique({ where: { id: itemId } });
  if (!item) throw new CourseLandingError('Why Register item not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Item does not belong to this course', 403);
  return prisma.courseWhyRegisterItem.delete({ where: { id: itemId } });
}

async function moveWhyRegisterItem(courseId, itemId, direction) {
  const item = await prisma.courseWhyRegisterItem.findUnique({ where: { id: itemId } });
  if (!item) throw new CourseLandingError('Why Register item not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Item does not belong to this course', 403);
  return reorderItem(prisma.courseWhyRegisterItem, { courseId, type: item.type }, itemId, direction);
}

// ============================================================================
// 7. Highlights
// ============================================================================

async function addHighlight(courseId, { title, description, icon, sortOrder = 0, isPublished = true }) {
  if (!title || !String(title).trim()) throw new CourseLandingError('Highlight title is required');
  const count = await prisma.courseHighlight.count({ where: { courseId } });
  return prisma.courseHighlight.create({
    data: {
      courseId,
      title: String(title).trim().slice(0, 300),
      description: description ? String(description).trim() : null,
      icon: icon ? String(icon).trim().slice(0, 50) : null,
      sortOrder: Number(sortOrder) || count * 10 + 10,
      isPublished: cleanBoolValue(isPublished),
    },
  });
}

async function updateHighlight(courseId, highlightId, { title, description, icon, isPublished }) {
  const item = await prisma.courseHighlight.findUnique({ where: { id: highlightId } });
  if (!item) throw new CourseLandingError('Highlight not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Highlight does not belong to this course', 403);
  return prisma.courseHighlight.update({
    where: { id: highlightId },
    data: {
      ...(title !== undefined ? { title: String(title).trim().slice(0, 300) } : {}),
      ...(description !== undefined ? { description: description ? String(description).trim() : null } : {}),
      ...(icon !== undefined ? { icon: icon ? String(icon).trim().slice(0, 50) : null } : {}),
      ...(isPublished !== undefined ? { isPublished: cleanBoolValue(isPublished) } : {}),
    },
  });
}

async function deleteHighlight(courseId, highlightId) {
  const item = await prisma.courseHighlight.findUnique({ where: { id: highlightId } });
  if (!item) throw new CourseLandingError('Highlight not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Highlight does not belong to this course', 403);
  return prisma.courseHighlight.delete({ where: { id: highlightId } });
}

async function moveHighlight(courseId, highlightId, direction) {
  const item = await prisma.courseHighlight.findUnique({ where: { id: highlightId } });
  if (!item) throw new CourseLandingError('Highlight not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Highlight does not belong to this course', 403);
  return reorderItem(prisma.courseHighlight, { courseId }, highlightId, direction);
}

// ============================================================================
// 8. Reviews / Testimonials
// ============================================================================

async function addTestimonial(courseId, { reviewerName, reviewerDesignation, reviewerLocation, quote, rating = 5, avatarUrl, initials, sortOrder = 0, isPublished = true, isDemo = false }) {
  if (!reviewerName || !String(reviewerName).trim()) throw new CourseLandingError('Reviewer name is required');
  if (!quote || !String(quote).trim()) throw new CourseLandingError('Testimonial quote is required');
  const count = await prisma.courseTestimonial.count({ where: { courseId } });
  const cleanRating = Math.max(1, Math.min(5, parseInt(rating, 10) || 5));
  const rawInitials = initials ? String(initials).trim().slice(0, 10) : '';
  const fallbackInitials = rawInitials || String(reviewerName).trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();

  return prisma.courseTestimonial.create({
    data: {
      courseId,
      reviewerName: String(reviewerName).trim().slice(0, 255),
      reviewerDesignation: reviewerDesignation ? String(reviewerDesignation).trim().slice(0, 255) : null,
      reviewerLocation: reviewerLocation ? String(reviewerLocation).trim().slice(0, 255) : null,
      quote: String(quote).trim(),
      rating: cleanRating,
      avatarUrl: avatarUrl ? String(avatarUrl).trim().slice(0, 500) : null,
      initials: fallbackInitials || null,
      sortOrder: Number(sortOrder) || count * 10 + 10,
      isPublished: cleanBoolValue(isPublished),
      isDemo: cleanBoolValue(isDemo),
    },
  });
}

async function updateTestimonial(courseId, testimonialId, { reviewerName, reviewerDesignation, reviewerLocation, quote, rating, avatarUrl, initials, isPublished, isDemo }) {
  const item = await prisma.courseTestimonial.findUnique({ where: { id: testimonialId } });
  if (!item) throw new CourseLandingError('Testimonial not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Testimonial does not belong to this course', 403);

  const cleanRating = rating !== undefined ? Math.max(1, Math.min(5, parseInt(rating, 10) || 5)) : undefined;

  return prisma.courseTestimonial.update({
    where: { id: testimonialId },
    data: {
      ...(reviewerName !== undefined ? { reviewerName: String(reviewerName).trim().slice(0, 255) } : {}),
      ...(reviewerDesignation !== undefined ? { reviewerDesignation: reviewerDesignation ? String(reviewerDesignation).trim().slice(0, 255) : null } : {}),
      ...(reviewerLocation !== undefined ? { reviewerLocation: reviewerLocation ? String(reviewerLocation).trim().slice(0, 255) : null } : {}),
      ...(quote !== undefined ? { quote: String(quote).trim() } : {}),
      ...(cleanRating !== undefined ? { rating: cleanRating } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl: avatarUrl ? String(avatarUrl).trim().slice(0, 500) : null } : {}),
      ...(initials !== undefined ? { initials: initials ? String(initials).trim().slice(0, 10) : null } : {}),
      ...(isPublished !== undefined ? { isPublished: cleanBoolValue(isPublished) } : {}),
      ...(isDemo !== undefined ? { isDemo: cleanBoolValue(isDemo) } : {}),
    },
  });
}

async function deleteTestimonial(courseId, testimonialId) {
  const item = await prisma.courseTestimonial.findUnique({ where: { id: testimonialId } });
  if (!item) throw new CourseLandingError('Testimonial not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Testimonial does not belong to this course', 403);
  return prisma.courseTestimonial.delete({ where: { id: testimonialId } });
}

async function moveTestimonial(courseId, testimonialId, direction) {
  const item = await prisma.courseTestimonial.findUnique({ where: { id: testimonialId } });
  if (!item) throw new CourseLandingError('Testimonial not found', 404);
  if (item.courseId !== courseId) throw new CourseLandingError('Testimonial does not belong to this course', 403);
  return reorderItem(prisma.courseTestimonial, { courseId }, testimonialId, direction);
}

// ============================================================================
// 9. Course Access Plans
// ============================================================================

async function addAccessPlan(courseId, { label, durationDays, price, salePrice, isDefault = false, sortOrder = 0, isPublished = true }) {
  if (!label || !String(label).trim()) throw new CourseLandingError('Access plan label is required');
  const count = await prisma.courseAccessPlan.count({ where: { courseId } });
  return prisma.courseAccessPlan.create({
    data: {
      courseId,
      label: String(label).trim().slice(0, 100),
      durationDays: durationDays !== undefined && durationDays !== '' && durationDays !== null ? parseInt(durationDays, 10) : null,
      price: price !== undefined && price !== '' && price !== null ? Number(price) : null,
      salePrice: salePrice !== undefined && salePrice !== '' && salePrice !== null ? Number(salePrice) : null,
      isDefault: cleanBoolValue(isDefault),
      sortOrder: Number(sortOrder) || count * 10 + 10,
      isPublished: cleanBoolValue(isPublished),
    },
  });
}

async function updateAccessPlan(courseId, planId, { label, durationDays, price, salePrice, isDefault, isPublished }) {
  const plan = await prisma.courseAccessPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new CourseLandingError('Access plan not found', 404);
  if (plan.courseId !== courseId) throw new CourseLandingError('Plan does not belong to this course', 403);

  return prisma.courseAccessPlan.update({
    where: { id: planId },
    data: {
      ...(label !== undefined ? { label: String(label).trim().slice(0, 100) } : {}),
      ...(durationDays !== undefined ? { durationDays: durationDays !== '' && durationDays !== null ? parseInt(durationDays, 10) : null } : {}),
      ...(price !== undefined ? { price: price !== '' && price !== null ? Number(price) : null } : {}),
      ...(salePrice !== undefined ? { salePrice: salePrice !== '' && salePrice !== null ? Number(salePrice) : null } : {}),
      ...(isDefault !== undefined ? { isDefault: cleanBoolValue(isDefault) } : {}),
      ...(isPublished !== undefined ? { isPublished: cleanBoolValue(isPublished) } : {}),
    },
  });
}

async function deleteAccessPlan(courseId, planId) {
  const plan = await prisma.courseAccessPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new CourseLandingError('Access plan not found', 404);
  if (plan.courseId !== courseId) throw new CourseLandingError('Plan does not belong to this course', 403);
  return prisma.courseAccessPlan.delete({ where: { id: planId } });
}

async function moveAccessPlan(courseId, planId, direction) {
  const plan = await prisma.courseAccessPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new CourseLandingError('Access plan not found', 404);
  if (plan.courseId !== courseId) throw new CourseLandingError('Plan does not belong to this course', 403);
  return reorderItem(prisma.courseAccessPlan, { courseId }, planId, direction);
}

// ============================================================================
// 10. Quick Stats
// ============================================================================

async function addCourseStat(courseId, { icon, value, label, statType = 'MANUAL', sortOrder = 0, isPublished = true }) {
  if (!label || !String(label).trim()) throw new CourseLandingError('Stat label is required');
  const count = await prisma.courseStat.count({ where: { courseId } });
  return prisma.courseStat.create({
    data: {
      courseId,
      icon: icon ? String(icon).trim().slice(0, 50) : null,
      value: value ? String(value).trim().slice(0, 100) : null,
      label: String(label).trim().slice(0, 100),
      statType: String(statType).trim().slice(0, 50) || 'MANUAL',
      sortOrder: Number(sortOrder) || count * 10 + 10,
      isPublished: cleanBoolValue(isPublished),
    },
  });
}

async function updateCourseStat(courseId, statId, { icon, value, label, statType, isPublished }) {
  const stat = await prisma.courseStat.findUnique({ where: { id: statId } });
  if (!stat) throw new CourseLandingError('Stat not found', 404);
  if (stat.courseId !== courseId) throw new CourseLandingError('Stat does not belong to this course', 403);

  return prisma.courseStat.update({
    where: { id: statId },
    data: {
      ...(icon !== undefined ? { icon: icon ? String(icon).trim().slice(0, 50) : null } : {}),
      ...(value !== undefined ? { value: value ? String(value).trim().slice(0, 100) : null } : {}),
      ...(label !== undefined ? { label: String(label).trim().slice(0, 100) } : {}),
      ...(statType !== undefined ? { statType: String(statType).trim().slice(0, 50) } : {}),
      ...(isPublished !== undefined ? { isPublished: cleanBoolValue(isPublished) } : {}),
    },
  });
}

async function deleteCourseStat(courseId, statId) {
  const stat = await prisma.courseStat.findUnique({ where: { id: statId } });
  if (!stat) throw new CourseLandingError('Stat not found', 404);
  if (stat.courseId !== courseId) throw new CourseLandingError('Stat does not belong to this course', 403);
  return prisma.courseStat.delete({ where: { id: statId } });
}

async function moveCourseStat(courseId, statId, direction) {
  const stat = await prisma.courseStat.findUnique({ where: { id: statId } });
  if (!stat) throw new CourseLandingError('Stat not found', 404);
  if (stat.courseId !== courseId) throw new CourseLandingError('Stat does not belong to this course', 403);
  return reorderItem(prisma.courseStat, { courseId }, statId, direction);
}

// ============================================================================
// 11. Comparison Columns & Items
// ============================================================================

async function addComparisonColumn(courseId, { title, subtitle, badgeText, isRecommended = false, sortOrder = 0, isPublished = true }) {
  if (!title || !String(title).trim()) throw new CourseLandingError('Column title is required');
  const count = await prisma.courseComparisonColumn.count({ where: { courseId } });
  return prisma.courseComparisonColumn.create({
    data: {
      courseId,
      title: String(title).trim().slice(0, 200),
      subtitle: subtitle ? String(subtitle).trim().slice(0, 200) : null,
      badgeText: badgeText ? String(badgeText).trim().slice(0, 100) : null,
      isRecommended: cleanBoolValue(isRecommended),
      sortOrder: Number(sortOrder) || count * 10 + 10,
      isPublished: cleanBoolValue(isPublished),
    },
  });
}

async function updateComparisonColumn(courseId, columnId, { title, subtitle, badgeText, isRecommended, isPublished }) {
  const col = await prisma.courseComparisonColumn.findUnique({ where: { id: columnId } });
  if (!col) throw new CourseLandingError('Comparison column not found', 404);
  if (col.courseId !== courseId) throw new CourseLandingError('Column does not belong to this course', 403);

  return prisma.courseComparisonColumn.update({
    where: { id: columnId },
    data: {
      ...(title !== undefined ? { title: String(title).trim().slice(0, 200) } : {}),
      ...(subtitle !== undefined ? { subtitle: subtitle ? String(subtitle).trim().slice(0, 200) : null } : {}),
      ...(badgeText !== undefined ? { badgeText: badgeText ? String(badgeText).trim().slice(0, 100) : null } : {}),
      ...(isRecommended !== undefined ? { isRecommended: cleanBoolValue(isRecommended) } : {}),
      ...(isPublished !== undefined ? { isPublished: cleanBoolValue(isPublished) } : {}),
    },
  });
}

async function deleteComparisonColumn(courseId, columnId) {
  const col = await prisma.courseComparisonColumn.findUnique({ where: { id: columnId } });
  if (!col) throw new CourseLandingError('Comparison column not found', 404);
  if (col.courseId !== courseId) throw new CourseLandingError('Column does not belong to this course', 403);
  return prisma.courseComparisonColumn.delete({ where: { id: columnId } });
}

async function moveComparisonColumn(courseId, columnId, direction) {
  const col = await prisma.courseComparisonColumn.findUnique({ where: { id: columnId } });
  if (!col) throw new CourseLandingError('Comparison column not found', 404);
  if (col.courseId !== courseId) throw new CourseLandingError('Column does not belong to this course', 403);
  return reorderItem(prisma.courseComparisonColumn, { courseId }, columnId, direction);
}

async function addComparisonItem(courseId, columnId, { text, sortOrder = 0, isPublished = true }) {
  if (!text || !String(text).trim()) throw new CourseLandingError('Comparison item text is required');
  const col = await prisma.courseComparisonColumn.findUnique({ where: { id: columnId } });
  if (!col) throw new CourseLandingError('Comparison column not found', 404);
  if (col.courseId !== courseId) throw new CourseLandingError('Column does not belong to this course', 403);

  const count = await prisma.courseComparisonItem.count({ where: { columnId } });
  return prisma.courseComparisonItem.create({
    data: {
      columnId,
      text: String(text).trim().slice(0, 300),
      sortOrder: Number(sortOrder) || count * 10 + 10,
      isPublished: cleanBoolValue(isPublished),
    },
  });
}

async function updateComparisonItem(courseId, columnId, itemId, { text, isPublished }) {
  const item = await prisma.courseComparisonItem.findUnique({
    where: { id: itemId },
    include: { column: true },
  });
  if (!item) throw new CourseLandingError('Comparison item not found', 404);
  if (item.columnId !== columnId || item.column.courseId !== courseId) {
    throw new CourseLandingError('Item does not belong to this course column', 403);
  }

  return prisma.courseComparisonItem.update({
    where: { id: itemId },
    data: {
      ...(text !== undefined ? { text: String(text).trim().slice(0, 300) } : {}),
      ...(isPublished !== undefined ? { isPublished: cleanBoolValue(isPublished) } : {}),
    },
  });
}

async function deleteComparisonItem(courseId, columnId, itemId) {
  const item = await prisma.courseComparisonItem.findUnique({
    where: { id: itemId },
    include: { column: true },
  });
  if (!item) throw new CourseLandingError('Comparison item not found', 404);
  if (item.columnId !== columnId || item.column.courseId !== courseId) {
    throw new CourseLandingError('Item does not belong to this course column', 403);
  }
  return prisma.courseComparisonItem.delete({ where: { id: itemId } });
}

async function moveComparisonItem(courseId, columnId, itemId, direction) {
  const item = await prisma.courseComparisonItem.findUnique({
    where: { id: itemId },
    include: { column: true },
  });
  if (!item) throw new CourseLandingError('Comparison item not found', 404);
  if (item.columnId !== columnId || item.column.courseId !== courseId) {
    throw new CourseLandingError('Item does not belong to this course column', 403);
  }
  return reorderItem(prisma.courseComparisonItem, { columnId }, itemId, direction);
}

// ============================================================================
// 12. How You Get Access Steps
// ============================================================================

async function addAccessStep(courseId, { title, description, icon, sortOrder = 0, isPublished = true }) {
  if (!title || !String(title).trim()) throw new CourseLandingError('Step title is required');
  const count = await prisma.courseAccessStep.count({ where: { courseId } });
  return prisma.courseAccessStep.create({
    data: {
      courseId,
      title: String(title).trim().slice(0, 300),
      description: description ? String(description).trim() : null,
      icon: icon ? String(icon).trim().slice(0, 50) : null,
      sortOrder: Number(sortOrder) || count * 10 + 10,
      isPublished: cleanBoolValue(isPublished),
    },
  });
}

async function updateAccessStep(courseId, stepId, { title, description, icon, isPublished }) {
  const step = await prisma.courseAccessStep.findUnique({ where: { id: stepId } });
  if (!step) throw new CourseLandingError('Access step not found', 404);
  if (step.courseId !== courseId) throw new CourseLandingError('Step does not belong to this course', 403);

  return prisma.courseAccessStep.update({
    where: { id: stepId },
    data: {
      ...(title !== undefined ? { title: String(title).trim().slice(0, 300) } : {}),
      ...(description !== undefined ? { description: description ? String(description).trim() : null } : {}),
      ...(icon !== undefined ? { icon: icon ? String(icon).trim().slice(0, 50) : null } : {}),
      ...(isPublished !== undefined ? { isPublished: cleanBoolValue(isPublished) } : {}),
    },
  });
}

async function deleteAccessStep(courseId, stepId) {
  const step = await prisma.courseAccessStep.findUnique({ where: { id: stepId } });
  if (!step) throw new CourseLandingError('Access step not found', 404);
  if (step.courseId !== courseId) throw new CourseLandingError('Step does not belong to this course', 403);
  return prisma.courseAccessStep.delete({ where: { id: stepId } });
}

async function moveAccessStep(courseId, stepId, direction) {
  const step = await prisma.courseAccessStep.findUnique({ where: { id: stepId } });
  if (!step) throw new CourseLandingError('Access step not found', 404);
  if (step.courseId !== courseId) throw new CourseLandingError('Step does not belong to this course', 403);
  return reorderItem(prisma.courseAccessStep, { courseId }, stepId, direction);
}

// ============================================================================
// 13. Dynamic Section Order System
// ============================================================================

async function ensureCourseLandingSections(courseId) {
  const existing = await prisma.courseLandingSection.findMany({
    where: { courseId },
    orderBy: { sortOrder: 'asc' },
  });

  const existingKeys = new Set(existing.map((e) => e.sectionKey));
  const missingKeys = DEFAULT_SECTION_ORDER.filter((k) => !existingKeys.has(k));

  if (missingKeys.length > 0) {
    let nextOrder = existing.length > 0 ? Math.max(...existing.map((e) => e.sortOrder)) + 10 : 10;
    for (const key of missingKeys) {
      await prisma.courseLandingSection.create({
        data: {
          courseId,
          sectionKey: key,
          sortOrder: nextOrder,
          isEnabled: true,
        },
      });
      nextOrder += 10;
    }
  }

  return prisma.courseLandingSection.findMany({
    where: { courseId },
    orderBy: { sortOrder: 'asc' },
  });
}

async function moveCourseSection(courseId, sectionKey, direction) {
  await ensureCourseLandingSections(courseId);
  const sections = await prisma.courseLandingSection.findMany({
    where: { courseId },
    orderBy: { sortOrder: 'asc' },
  });

  const currentIndex = sections.findIndex((s) => s.sectionKey === sectionKey);
  if (currentIndex === -1) throw new CourseLandingError('Section not found', 404);

  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= sections.length) return sections;

  const currentSec = sections[currentIndex];
  const targetSec = sections[targetIndex];

  await prisma.courseLandingSection.update({
    where: { id: currentSec.id },
    data: { sortOrder: targetSec.sortOrder },
  });
  await prisma.courseLandingSection.update({
    where: { id: targetSec.id },
    data: { sortOrder: currentSec.sortOrder },
  });

  return prisma.courseLandingSection.findMany({
    where: { courseId },
    orderBy: { sortOrder: 'asc' },
  });
}

async function toggleCourseSection(courseId, sectionKey, isEnabled) {
  await ensureCourseLandingSections(courseId);
  const sec = await prisma.courseLandingSection.findFirst({
    where: { courseId, sectionKey },
  });
  if (!sec) throw new CourseLandingError('Section not found', 404);

  return prisma.courseLandingSection.update({
    where: { id: sec.id },
    data: { isEnabled: cleanBoolValue(isEnabled) },
  });
}

// ============================================================================
// Helpers
// ============================================================================

function cleanBoolValue(val) {
  return val === true || val === 'true' || val === 'on' || val === 1 || val === '1';
}

async function reorderItem(modelDelegate, whereFilter, itemId, direction) {
  const items = await modelDelegate.findMany({
    where: whereFilter,
    orderBy: { sortOrder: 'asc' },
  });

  const currentIndex = items.findIndex((i) => i.id === itemId);
  if (currentIndex === -1) throw new CourseLandingError('Item not found', 404);

  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= items.length) return items;

  const currentItem = items[currentIndex];
  const targetItem = items[targetIndex];

  await modelDelegate.update({ where: { id: currentItem.id }, data: { sortOrder: targetItem.sortOrder } });
  await modelDelegate.update({ where: { id: targetItem.id }, data: { sortOrder: currentItem.sortOrder } });

  return modelDelegate.findMany({
    where: whereFilter,
    orderBy: { sortOrder: 'asc' },
  });
}

module.exports = {
  CourseLandingError,
  DEFAULT_SECTION_ORDER,
  SECTION_METADATA,
  getAdminLandingData,
  getDefaultLandingSettings,
  getPublicLandingData,
  upsertLandingSettings,
  resolveCourseStats,

  addHeroChip,
  updateHeroChip,
  deleteHeroChip,
  moveHeroChip,

  addTakeaway,
  updateTakeaway,
  deleteTakeaway,
  moveTakeaway,

  addQuestion,
  updateQuestion,
  deleteQuestion,
  moveQuestion,

  addAudienceItem,
  updateAudienceItem,
  deleteAudienceItem,
  moveAudienceItem,

  addCourseFaq,
  updateCourseFaq,
  deleteCourseFaq,
  moveCourseFaq,

  addFaq: addCourseFaq,
  updateFaq: updateCourseFaq,
  deleteFaq: deleteCourseFaq,
  moveFaq: moveCourseFaq,

  addWhyRegisterItem,
  updateWhyRegisterItem,
  deleteWhyRegisterItem,
  moveWhyRegisterItem,

  addHighlight,
  updateHighlight,
  deleteHighlight,
  moveHighlight,

  addTestimonial,
  updateTestimonial,
  deleteTestimonial,
  moveTestimonial,
  addReview: addTestimonial,
  updateReview: updateTestimonial,
  deleteReview: deleteTestimonial,
  moveReview: moveTestimonial,

  addAccessPlan,
  updateAccessPlan,
  deleteAccessPlan,
  moveAccessPlan,

  addCourseStat,
  updateCourseStat,
  deleteCourseStat,
  moveCourseStat,

  addComparisonColumn,
  updateComparisonColumn,
  deleteComparisonColumn,
  moveComparisonColumn,
  addComparisonItem,
  updateComparisonItem,
  deleteComparisonItem,
  moveComparisonItem,

  addAccessStep,
  updateAccessStep,
  deleteAccessStep,
  moveAccessStep,

  ensureCourseLandingSections,
  moveCourseSection,
  toggleCourseSection,
};
