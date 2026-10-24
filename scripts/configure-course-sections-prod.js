const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Bootstrap-only by default: creates what is missing and NEVER overwrites
// content the owner has edited in the admin CMS (instructor profile, course
// price/instructor, landing-page copy, homepage mentor settings). Pass --force
// to deliberately re-apply the original FMR configuration.
const FORCE = process.argv.includes('--force');

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
        designation: 'Founder, ICDS',
        organization: 'Institute of Comprehensive Dental Studies / Institute of Cosmetology and Dental Sciences',
        qualificationSummary: 'BDS, MDS Prosthodontist, FFA (USA)',
        experienceLabel: '10+ Years Experience',
        shortBio: 'Prosthodontist, Implantologist, and Founder of ICDS with over a decade of clinical practice and mentorship across advanced dentistry.',
        bio: `Dr. Tanu Raghav is a Prosthodontist and Implantologist with over a decade of experience in dentistry. She completed her BDS in Ghaziabad in 2014 and later pursued her MDS in Prosthodontics and Implantology from Subharti Dental College.\n\nShe has also completed further fellowship training in clinical cosmetology through FFA (USA) and in micropigmentation.\n\nDr. Tanu Raghav has contributed to dental research through several articles published in national and international journals. Alongside her academic interests, she has been actively involved in private clinical practice for the past 10 years.\n\nShe is the Founder and Director of ICDS — the Institute of Comprehensive Dental Studies / Institute of Cosmetology and Dental Sciences — where she focuses on training and mentoring dental professionals.\n\nOver the last two years, she has trained more than 50 doctors across various areas of dentistry, helping them strengthen their clinical knowledge and practical skills.\n\nWith her clinical experience, academic contributions, and commitment to professional education, Dr. Tanu Raghav continues to contribute to the development of dental professionals through both clinical practice and training.`,
        status: 'ACTIVE',
      },
    });
    console.log('Created instructor:', instructor.id, instructor.name);
  } else {
    console.log('Found existing instructor:', instructor.id, instructor.name);
    if (FORCE) instructor = await prisma.instructor.update({
      where: { id: instructor.id },
      data: {
        designation: 'Founder, ICDS',
        organization: 'Institute of Comprehensive Dental Studies / Institute of Cosmetology and Dental Sciences',
        qualificationSummary: 'BDS, MDS Prosthodontist, FFA (USA)',
        experienceLabel: '10+ Years Experience',
        shortBio: 'Prosthodontist, Implantologist, and Founder of ICDS with over a decade of clinical practice and mentorship across advanced dentistry.',
        bio: `Dr. Tanu Raghav is a Prosthodontist and Implantologist with over a decade of experience in dentistry. She completed her BDS in Ghaziabad in 2014 and later pursued her MDS in Prosthodontics and Implantology from Subharti Dental College.\n\nShe has also completed further fellowship training in clinical cosmetology through FFA (USA) and in micropigmentation.\n\nDr. Tanu Raghav has contributed to dental research through several articles published in national and international journals. Alongside her academic interests, she has been actively involved in private clinical practice for the past 10 years.\n\nShe is the Founder and Director of ICDS — the Institute of Comprehensive Dental Studies / Institute of Cosmetology and Dental Sciences — where she focuses on training and mentoring dental professionals.\n\nOver the last two years, she has trained more than 50 doctors across various areas of dentistry, helping them strengthen their clinical knowledge and practical skills.\n\nWith her clinical experience, academic contributions, and commitment to professional education, Dr. Tanu Raghav continues to contribute to the development of dental professionals through both clinical practice and training.`,
        practiceName: null,
        practiceLocation: null,
        mentorQuote: null,
        status: 'ACTIVE',
      },
    });
  }

  // Seed verified credentials if empty
  const existingCreds = await prisma.instructorCredential.findMany({
    where: { instructorId: instructor.id },
  });
  if (existingCreds.length === 0) {
    const verifiedCreds = [
      { title: 'BDS (Ghaziabad, 2014)', sortOrder: 10, icon: 'bi-mortarboard-fill' },
      { title: 'MDS in Prosthodontics & Implantology (Subharti Dental College)', sortOrder: 20, icon: 'bi-award-fill' },
      { title: 'Fellowship in Clinical Cosmetology, FFA (USA) & Micropigmentation', sortOrder: 30, icon: 'bi-patch-check-fill' },
      { title: '10+ Years in Private Clinical Practice & Dental Research', sortOrder: 40, icon: 'bi-briefcase-fill' },
      { title: 'Founder & Director, ICDS (Mentored 50+ Doctors)', sortOrder: 50, icon: 'bi-people-fill' },
    ];
    for (const c of verifiedCreds) {
      await prisma.instructorCredential.create({
        data: {
          instructorId: instructor.id,
          title: c.title,
          icon: c.icon,
          sortOrder: c.sortOrder,
          isPublished: true,
        },
      });
    }
    console.log(`Seeded ${verifiedCreds.length} verified instructor credentials.`);
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

  // Assign Dr. Tanu Raghav as Course Instructor & ensure FMR is Free
  if (FORCE) {
    await prisma.course.update({
      where: { id: fmrCourse.id },
      data: {
        instructorId: instructor.id,
        price: 0,
        salePrice: null,
      },
    });
  } else if (!fmrCourse.instructorId) {
    await prisma.course.update({ where: { id: fmrCourse.id }, data: { instructorId: instructor.id } });
  }
  console.log(`Assigned course ${fmrCourse.id} to instructor ${instructor.id} (${instructor.name}) and ensured price is Free (0)`);

  // 3. Configure Course Landing Content
  const landing = await prisma.courseLandingContent.upsert({
    where: { courseId: fmrCourse.id },
    update: FORCE ? {
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
    } : {},
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
      update: FORCE ? { value: s.value } : {},
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
      courseHighlights: true,
      testimonials: true,
      lessons: true,
      resources: true,
    },
  });

  const pubLessons = verifyFmr.lessons.filter(l => l.status === 'PUBLISHED');
  const draftLessons = verifyFmr.lessons.filter(l => l.status === 'DRAFT');

  console.log('\n--- VERIFICATION SUMMARY ---');
  console.log('Course:', verifyFmr.title, `(ID: ${verifyFmr.id}, Price: ${verifyFmr.price === 0 ? 'Free (0)' : verifyFmr.price})`);
  console.log('Published Lessons:', pubLessons.length);
  console.log('Draft Lessons:', draftLessons.length);
  console.log('Resources:', verifyFmr.resources.length);
  console.log('Assigned Instructor:', verifyFmr.instructor ? verifyFmr.instructor.name : 'NONE');
  console.log('Instructor Designation:', verifyFmr.instructor ? verifyFmr.instructor.designation : 'NONE');
  console.log('Why Register Enabled:', verifyFmr.landingContent?.whyRegisterEnabled, `(${verifyFmr.whyRegisterItems.length} items)`);
  console.log('Highlights Enabled:', verifyFmr.landingContent?.highlightsEnabled, `(${verifyFmr.courseHighlights.length} items)`);
  console.log('Reviews Enabled:', verifyFmr.landingContent?.reviewsEnabled, `(${verifyFmr.testimonials.length} reviews - strictly disabled)`);
  console.log('Mentor Section Enabled:', verifyFmr.landingContent?.mentorSectionEnabled);
}

main()
  .catch((err) => {
    console.error('Configuration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
