const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Configuring ICDS Course Content Sections & Dr. Tanu Raghav ---');

  // 1. Locate or create Instructor: Dr. Tanu Raghav
  let instructor = await prisma.instructor.findFirst({
    where: {
      OR: [
        { name: { contains: 'Tanu' } },
        { slug: 'dr-tanu-raghav' },
      ],
    },
  });

  if (!instructor) {
    console.log('Creating instructor record for Dr. Tanu Raghav...');
    instructor = await prisma.instructor.create({
      data: {
        name: 'Dr. Tanu Raghav',
        slug: 'dr-tanu-raghav',
        designation: 'Course Director & Clinical Mentor',
        organization: 'Institute of Cosmetology & Dental Sciences',
        shortBio: 'Specialist in full mouth rehabilitation, occlusal diagnosis, and clinical prosthodontic workflows.',
        status: 'ACTIVE',
      },
    });
    console.log('Created instructor:', instructor.id, instructor.name);
  } else {
    console.log('Found existing instructor:', instructor.id, instructor.name);
    // Ensure designation, organization, and shortBio are populated if null
    instructor = await prisma.instructor.update({
      where: { id: instructor.id },
      data: {
        designation: instructor.designation || 'Course Director & Clinical Mentor',
        organization: instructor.organization || 'Institute of Cosmetology & Dental Sciences',
        shortBio: instructor.shortBio || 'Specialist in full mouth rehabilitation, occlusal diagnosis, and clinical prosthodontic workflows.',
        status: 'ACTIVE',
      },
    });
  }

  // 2. Locate Course: Advanced FMR Master Class
  const fmrCourse = await prisma.course.findFirst({
    where: { slug: 'advanced-fmr-master-class' },
    include: {
      lessons: true,
      resources: true,
      landingContent: true,
    },
  });

  if (!fmrCourse) {
    throw new Error('Course "advanced-fmr-master-class" not found!');
  }

  console.log('Found FMR Course:', {
    id: fmrCourse.id,
    title: fmrCourse.title,
    price: fmrCourse.price,
    currentInstructorId: fmrCourse.instructorId,
    lessonCount: fmrCourse.lessons.length,
    resourceCount: fmrCourse.resources.length,
  });

  // Assign Dr. Tanu Raghav as Course Instructor
  await prisma.course.update({
    where: { id: fmrCourse.id },
    data: {
      instructorId: instructor.id,
    },
  });
  console.log(`Assigned course ${fmrCourse.id} to instructor ${instructor.id} (${instructor.name})`);

  // 3. Configure Course Landing Content
  const landing = await prisma.courseLandingContent.upsert({
    where: { courseId: fmrCourse.id },
    update: {
      accessLabel: 'Self-Paced Access',
      // Section 1: Why Register
      whyRegisterEnabled: true,
      whyRegisterEyebrow: 'WHY REGISTER FOR THIS COURSE',
      whyRegisterHeading: 'Why Register For This Masterclass?',
      whyRegisterIntro: 'Designed specifically for dental practitioners who want to master Full Mouth Rehabilitation diagnostics, articulators, and clinical forms with complete clinical confidence.',
      whyRegisterEmphasisText: 'Gain systematic, step-by-step clarity on complex restorative and occlusal rehabilitation.',
      whyRegisterWantHeading: 'This course is for you if you want to:',
      whyRegisterGetHeading: 'What you get:',
      whyRegisterClosingText: 'Take command of your full mouth rehabilitation cases with structured, evidence-based workflows.',
      // Section 2: Highlights
      highlightsEnabled: true,
      highlightsHeading: 'Course Highlights',
      highlightsDescription: 'Key clinical competencies and demonstrated procedures included in the curriculum.',
      // Section 3: Reviews (Must remain strictly disabled unless genuine reviews exist)
      reviewsEnabled: false,
      reviewsEyebrow: 'Verified Reviews',
      reviewsHeading: 'Reviews from Clinicians',
      // Section 4: Meet Your Mentor
      mentorSectionEnabled: true,
      mentorEyebrow: 'Meet Your Mentor',
      mentorHeading: 'Learn from Dr. Tanu Raghav',
    },
    create: {
      courseId: fmrCourse.id,
      accessLabel: 'Self-Paced Access',
      whyRegisterEnabled: true,
      whyRegisterEyebrow: 'WHY REGISTER FOR THIS COURSE',
      whyRegisterHeading: 'Why Register For This Masterclass?',
      whyRegisterIntro: 'Designed specifically for dental practitioners who want to master Full Mouth Rehabilitation diagnostics, articulators, and clinical forms with complete clinical confidence.',
      whyRegisterEmphasisText: 'Gain systematic, step-by-step clarity on complex restorative and occlusal rehabilitation.',
      whyRegisterWantHeading: 'This course is for you if you want to:',
      whyRegisterGetHeading: 'What you get:',
      whyRegisterClosingText: 'Take command of your full mouth rehabilitation cases with structured, evidence-based workflows.',
      highlightsEnabled: true,
      highlightsHeading: 'Course Highlights',
      highlightsDescription: 'Key clinical competencies and demonstrated procedures included in the curriculum.',
      reviewsEnabled: false,
      reviewsEyebrow: 'Verified Reviews',
      reviewsHeading: 'Reviews from Clinicians',
      mentorSectionEnabled: true,
      mentorEyebrow: 'Meet Your Mentor',
      mentorHeading: 'Learn from Dr. Tanu Raghav',
    },
  });
  console.log('Configured CourseLandingContent for course:', fmrCourse.id);

  // 4. Seed Truthful Why Register Items (WANT & GET)
  const existingWhyItems = await prisma.courseWhyRegisterItem.findMany({
    where: { courseId: fmrCourse.id },
  });

  if (existingWhyItems.length === 0) {
    console.log('Seeding truthful Why Register items...');
    const wantItems = [
      {
        type: 'WANT',
        title: 'Develop clinical confidence in Full Mouth Rehabilitation workflows',
        description: 'Systematic approach to complex restorative planning and occlusion.',
        sortOrder: 10,
      },
      {
        type: 'WANT',
        title: 'Master diagnosis of Tooth Wear, Bruxer vs Clencher, and Collapsed Bite',
        description: 'Clear differential diagnosis between attrition, erosion, and vertical collapse.',
        sortOrder: 20,
      },
      {
        type: 'WANT',
        title: 'Understand TMJ and masticatory muscle clinical examination protocols',
        description: 'Hands-on palpation and joint diagnostics before rehabilitation.',
        sortOrder: 30,
      },
      {
        type: 'WANT',
        title: 'Integrate systematic occlusal analysis into everyday dental practice',
        description: 'Prevent restorative failures through precise occlusal records.',
        sortOrder: 40,
      },
    ];

    const getItems = [
      {
        type: 'GET',
        title: 'Facebow kinematic registration and transfer protocols',
        description: 'Step-by-step clinical demonstration of kinematic facebow transfer.',
        sortOrder: 10,
      },
      {
        type: 'GET',
        title: 'Semi-adjustable articulator mounting and Hanau concepts',
        description: 'Mounting maxillary and mandibular casts in centric relation.',
        sortOrder: 20,
      },
      {
        type: 'GET',
        title: 'Articulator zeroing and programming demonstrations',
        description: 'Condylar guidance and Bennett angle programming methods.',
        sortOrder: 30,
      },
      {
        type: 'GET',
        title: 'Downloadable comprehensive Dental Case History Forms',
        description: 'Verified clinical documentation form for structured patient workups.',
        sortOrder: 40,
      },
    ];

    for (const item of [...wantItems, ...getItems]) {
      await prisma.courseWhyRegisterItem.create({
        data: {
          courseId: fmrCourse.id,
          type: item.type,
          title: item.title,
          description: item.description,
          icon: 'bi-check2-circle',
          sortOrder: item.sortOrder,
          isPublished: true,
        },
      });
    }
    console.log(`Seeded ${wantItems.length + getItems.length} Why Register items.`);
  } else {
    console.log(`Found ${existingWhyItems.length} existing Why Register items.`);
  }

  // 5. Seed Truthful Highlights
  const existingHighlights = await prisma.courseHighlight.findMany({
    where: { courseId: fmrCourse.id },
  });

  if (existingHighlights.length === 0) {
    console.log('Seeding truthful Highlights...');
    const highlights = [
      { title: 'Structured Full Mouth Rehabilitation curriculum (23 clinical lessons)', sortOrder: 10 },
      { title: 'Tooth Wear, Bruxer vs Clencher, and Collapsed Bite concepts', sortOrder: 20 },
      { title: 'Facebow clinical theory and demonstration', sortOrder: 30 },
      { title: 'Semi-adjustable articulator and Hanau concepts', sortOrder: 40 },
      { title: 'Articulator zeroing and programming demonstrations', sortOrder: 50 },
      { title: 'TMJ examination and muscle examination curriculum', sortOrder: 60 },
      { title: 'Self-paced online learning access', sortOrder: 70 },
      { title: 'Downloadable Dental Case History Forms PDF', sortOrder: 80 },
    ];

    for (const h of highlights) {
      await prisma.courseHighlight.create({
        data: {
          courseId: fmrCourse.id,
          title: h.title,
          icon: 'bi-check-circle-fill',
          sortOrder: h.sortOrder,
          isPublished: true,
        },
      });
    }
    console.log(`Seeded ${highlights.length} Highlights.`);
  } else {
    console.log(`Found ${existingHighlights.length} existing Highlights.`);
  }

  // 6. Configure SiteContent for Homepage Mentor Spotlight
  const homeSettings = [
    { key: 'mentor.enabled', value: 'true' },
    { key: 'mentor.instructorId', value: String(instructor.id) },
    { key: 'mentor.eyebrow', value: 'MEET YOUR MENTOR' },
    { key: 'mentor.heading', value: 'Learn directly from our lead clinical mentor' },
    { key: 'mentor.credentialLimit', value: '5' },
    { key: 'mentor.ctaLabel', value: 'View Courses' },
    { key: 'mentor.ctaTarget', value: '#courses' },
  ];

  for (const s of homeSettings) {
    await prisma.siteSetting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: { key: s.key, value: s.value },
    });
  }
  console.log('Configured Homepage Mentor spotlight in siteSettings.');

  // Final verification
  const verifyFmr = await prisma.course.findUnique({
    where: { id: fmrCourse.id },
    include: {
      instructor: true,
      landingContent: true,
      whyRegisterItems: true,
      highlights: true,
      testimonials: true,
    },
  });

  console.log('\n--- VERIFICATION SUMMARY ---');
  console.log('Course:', verifyFmr.title, `(ID: ${verifyFmr.id}, Price: ${verifyFmr.price})`);
  console.log('Assigned Instructor:', verifyFmr.instructor ? verifyFmr.instructor.name : 'NONE');
  console.log('Why Register Enabled:', verifyFmr.landingContent?.whyRegisterEnabled, `(${verifyFmr.whyRegisterItems.length} items)`);
  console.log('Highlights Enabled:', verifyFmr.landingContent?.highlightsEnabled, `(${verifyFmr.highlights.length} items)`);
  console.log('Reviews Enabled:', verifyFmr.landingContent?.reviewsEnabled, `(${verifyFmr.testimonials.length} reviews - strictly disabled)`);
  console.log('Mentor Section Enabled:', verifyFmr.landingContent?.mentorSectionEnabled);
}

main()
  .catch((err) => {
    console.error('Configuration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
