const { prisma } = require('../src/config/db');

// Bootstrap-only by default: this script creates MISSING content and never
// touches anything the owner has already saved through the admin CMS. Pass
// --force to deliberately wipe and re-seed the FMR landing content.
const FORCE = process.argv.includes('--force');

// Returns true when the section should be (re)seeded: always under --force
// (after clearing it), otherwise only when the course has no rows yet.
async function claimSection(delegate, courseId, label) {
  const existing = await delegate.count({ where: { courseId } });
  if (existing === 0) return true;
  if (FORCE) {
    await delegate.deleteMany({ where: { courseId } });
    return true;
  }
  console.log(`Skipping ${label}: ${existing} existing item(s) preserved (use --force to overwrite).`);
  return false;
}

async function seedFmrLandingContent() {
  console.log(`--- Seeding FMR Landing Page CMS Content${FORCE ? ' (FORCE)' : ' (create-missing only)'} ---`);

  const course = await prisma.course.findFirst({
    where: { slug: 'advanced-fmr-master-class' },
  });

  if (!course) {
    console.error('Course "advanced-fmr-master-class" not found in database.');
    return;
  }

  console.log(`Found course: "${course.title}" (ID: ${course.id})`);

  // 1. Upsert Landing Content Settings
  const landingContent = await prisma.courseLandingContent.upsert({
    where: { courseId: course.id },
    create: {
      courseId: course.id,
      heroEyebrow: 'Dental Sciences • Online Clinical Course',
      heroTitleOverride: null,
      heroAccentText: 'Master Class',
      heroDescription: 'Comprehensive clinical masterclass covering foundational principles, occlusion, case diagnostics, treatment sequencing, and hands-on clinical workflows.',
      heroMediaType: 'THUMBNAIL',
      heroMediaUrl: null,
      heroMediaCaption: '100% Verified Clinical Curriculum',
      secondaryCtaLabel: 'Explore Curriculum',
      secondaryCtaTarget: '#curriculum',
      priceSubtitle: 'Full Free Access',

      aboutEnabled: true,
      aboutEyebrow: 'Clinical Fundamentals',
      aboutHeading: 'About This Masterclass',
      aboutBody: 'This masterclass provides a comprehensive, logically sequenced clinical curriculum designed to help practitioners understand diagnosis, treatment sequencing, and hands-on execution with clarity and confidence.',

      takeawaysEnabled: true,
      takeawaysEyebrow: 'Masterclass Learning Outcomes',
      takeawaysHeading: 'What clinicians will learn in this master class',
      takeawaysDescription: 'A practical, evidence-based clinical framework designed to help you master treatment planning logically before you attempt complex clinical cases.',

      sneakPeekEnabled: false, // OFF until client provides a trailer
      sneakPeekEyebrow: 'A Sneak Peek',
      sneakPeekHeading: 'See the learning experience before you enroll',
      sneakPeekDescription: 'Watch this high-definition clinical preview to experience the depth, clarity, and systematic presentation style of the course.',
      sneakPeekMediaUrl: null,

      questionsEnabled: true,
      questionsEyebrow: 'Clinical Fundamentals',
      questionsHeading: 'Core clinical questions this masterclass helps you answer',

      curriculumEnabled: true,
      curriculumEyebrow: 'Course Curriculum',
      curriculumHeading: '4 structured modules for dentists',
      curriculumIntro: 'Learn the essential clinical workflow through structured modules covering occlusal foundations, centric relation, facebow transfer, articulators, vertical dimension, and comprehensive case planning.',
      curriculumDefaultExpanded: true,
      showLessonDuration: true,
      showLockIcon: true,
      showPreviewBadge: true,

      // CRITICAL: Certificate section strictly OFF by default
      certificateSectionEnabled: false,
      certificateEyebrow: 'E-Certificate',
      certificateHeading: `Recognize your progress in ${course.title}`,
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
      finalCtaBody: 'Immediate online access to all 15 structured video lessons, clinical demonstrations, and downloadable forms.',
      finalCtaButtonLabel: 'Enroll Free →',
      finalCtaBadgeText: '✓ 100% Free · Structured Clinical Curriculum',

      stickyCtaEnabled: true,
      stickyCtaText: '15 Structured Video Lessons',
      stickyCtaButtonLabel: 'Enroll Free →',
    },
    update: FORCE ? {
      heroEyebrow: 'Dental Sciences • Online Clinical Course',
      heroAccentText: 'Master Class',
      heroDescription: 'Comprehensive clinical masterclass covering foundational principles, occlusion, case diagnostics, treatment sequencing, and hands-on clinical workflows.',
      priceSubtitle: 'Full Free Access',
      aboutEnabled: true,
      takeawaysEnabled: true,
      sneakPeekEnabled: false, // OFF
      questionsEnabled: true,
      curriculumEnabled: true,
      certificateSectionEnabled: false, // strictly OFF
      audienceEnabled: true,
      faqEnabled: true,
      finalCtaEnabled: true,
      stickyCtaEnabled: true,
      stickyCtaText: '15 Structured Video Lessons',
    } : {},
  });
  console.log('Upserted landing content settings for course ID:', landingContent.courseId);

  // 2. Hero Chips
  const doChips = await claimSection(prisma.courseHeroChip, course.id, 'chips');
  const chips = [
    { label: '15 Structured Video Lessons', sortOrder: 1 },
    { label: 'Self-Paced Learning', sortOrder: 2 },
    { label: 'Downloadable Clinical Forms', sortOrder: 3 },
    { label: 'Private Streaming', sortOrder: 4 },
  ];
  for (const chip of (doChips ? chips : [])) {
    await prisma.courseHeroChip.create({
      data: { courseId: course.id, label: chip.label, sortOrder: chip.sortOrder, isPublished: true },
    });
  }
  console.log(`Seeded ${chips.length} hero chips.`);

  // 3. Takeaways
  const doTakeaways = await claimSection(prisma.courseTakeaway, course.id, 'takeaways');
  const takeaways = [
    {
      icon: '01',
      title: 'Foundational Occlusal Philosophy',
      description: 'Understand the foundational principles of Full Mouth Rehabilitation, tooth wear mechanisms, and core occlusal relationships.',
      sortOrder: 1,
    },
    {
      icon: '02',
      title: 'Tooth Wear & Bite Collapse',
      description: 'Accurately differentiate bruxers from clenchers, manage severe anterior attrition, and stabilize collapsed vertical dimension.',
      sortOrder: 2,
    },
    {
      icon: '03',
      title: 'Facebow Records & Protocols',
      description: 'Master clinical Facebow transfer theory and execute real-world patient demonstration protocols with repeatable precision.',
      sortOrder: 3,
    },
    {
      icon: '04',
      title: 'Articulator Programming & TMJ',
      description: 'Master semi-adjustable Hanau articulators, zeroing, calibration, programming, condylar guidance, and diagnostic TMJ evaluation.',
      sortOrder: 4,
    },
  ];
  for (const t of (doTakeaways ? takeaways : [])) {
    await prisma.courseTakeaway.create({
      data: {
        courseId: course.id,
        icon: t.icon,
        title: t.title,
        description: t.description,
        sortOrder: t.sortOrder,
        isPublished: true,
      },
    });
  }
  console.log(`Seeded ${takeaways.length} takeaways.`);

  // 4. Clinical Questions
  const doQuestions = await claimSection(prisma.courseQuestion, course.id, 'clinical questions');
  const questions = [
    'How to systematically assess, plan, and execute an FMR case',
    'What sequential workflow steps to follow from diagnostics to delivery',
    'How to stabilize, deprogram, and restore a collapsed bite',
    'How to establish and verify the correct vertical dimension (VDO)',
    'How to capture a precise, verifiable centric relation (CR) record',
    'How to identify and eliminate damaging occlusal interferences',
    'Why, when, and how to execute a clinical Facebow transfer record',
    'How to zero, calibrate, and program semi-adjustable articulators',
    'How to ensure long-term structural and biological success of restorative cases',
  ];
  for (let i = 0; doQuestions && i < questions.length; i++) {
    await prisma.courseQuestion.create({
      data: {
        courseId: course.id,
        question: questions[i],
        sortOrder: i + 1,
        isPublished: true,
      },
    });
  }
  console.log(`Seeded ${questions.length} clinical questions.`);

  // 5. Target Audience
  const doAudience = await claimSection(prisma.courseAudienceItem, course.id, 'audience items');
  const forItems = [
    'Ambitious dentists aiming to excel in functional and restorative dentistry',
    'Clinicians seeking stronger mastery and predictable occlusal outcomes',
    'Dental professionals dedicated to disciplined clinical protocols',
    'Dentists who prioritize long-term patient function, comfort, and stability',
  ];
  for (let i = 0; doAudience && i < forItems.length; i++) {
    await prisma.courseAudienceItem.create({
      data: { courseId: course.id, type: 'FOR', title: forItems[i], sortOrder: i + 1, isPublished: true },
    });
  }

  const notForItems = [
    'Those unwilling to invest effort in learning foundational occlusion principles',
    'Dentists completely content with intuitive or non-standardized restorative guesswork',
    'Clinicians resistant to systematic clinical documentation and articulator programming',
    'Anyone seeking superficial cosmetic quick-fixes without functional stability',
  ];
  for (let i = 0; doAudience && i < notForItems.length; i++) {
    await prisma.courseAudienceItem.create({
      data: { courseId: course.id, type: 'NOT_FOR', title: notForItems[i], sortOrder: i + 1, isPublished: true },
    });
  }
  console.log(`Seeded ${forItems.length} FOR and ${notForItems.length} NOT_FOR audience items.`);

  // 6. Course FAQs
  const doFaqs = await claimSection(prisma.courseFaq, course.id, 'course FAQs');
  const faqs = [
    {
      question: 'Is this masterclass suitable for general dentists?',
      answer: 'Yes. The curriculum begins with foundational occlusal principles and progresses step-by-step into diagnostic mounting, facebow transfers, and complex restorative rehabilitation.',
    },
    {
      question: 'Do I need special equipment to follow the demonstrations?',
      answer: 'The demonstrations feature standard semi-adjustable Hanau articulators and Springbow facebows commonly found in clinical practice and dental labs.',
    },
    {
      question: 'Are clinical case documentation forms included?',
      answer: 'Yes. Enrolled practitioners have direct access to downloadable clinical forms including the Dental Case History protocol.',
    },
    {
      question: 'How long do I have access to the video lessons?',
      answer: 'Once enrolled, you receive online access to all published structured video lessons to learn at your own pace.',
    },
  ];
  for (let i = 0; doFaqs && i < faqs.length; i++) {
    await prisma.courseFaq.create({
      data: {
        courseId: course.id,
        question: faqs[i].question,
        answer: faqs[i].answer,
        sortOrder: i + 1,
        isPublished: true,
      },
    });
  }
  console.log(`Seeded ${faqs.length} course FAQs.`);
  console.log('--- Finished seeding FMR landing content ---');
}

if (require.main === module) {
  seedFmrLandingContent()
    .catch((err) => {
      console.error('Error seeding FMR landing content:', err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { seedFmrLandingContent };
