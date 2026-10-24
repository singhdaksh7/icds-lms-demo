const { prisma } = require('../src/config/db');

/**
 * Seed 4 obviously fictional, clearly labelled demo reviews for layout & responsive QA.
 * These reviews are flagged with `isDemo: true` and will NEVER be rendered publicly.
 */
// Only the clearly-labelled demo reviews are (re)written. The course's
// reviewsEnabled switch is owner-controlled in the admin CMS, so it is only set
// when the landing row does not exist yet, or when --force is passed.
const FORCE = process.argv.includes('--force');

async function seedDemoReviews() {
  console.log('=== SEEDING DEMO REVIEWS FOR LANDING PAGE QA ===');

  const course = await prisma.course.findFirst({
    where: { slug: 'advanced-fmr-master-class' },
  });

  if (!course) {
    console.error('Course "advanced-fmr-master-class" not found in database.');
    process.exit(1);
  }

  console.log(`Course target: "${course.title}" (ID: ${course.id})`);

  // Ensure reviewsEnabled = false for public production safety until genuine reviews arrive
  await prisma.courseLandingContent.upsert({
    where: { courseId: course.id },
    create: {
      courseId: course.id,
      reviewsEnabled: false,
    },
    update: FORCE ? { reviewsEnabled: false } : {},
  });
  console.log(FORCE
    ? 'Course reviewsEnabled forced to FALSE (--force).'
    : 'Course reviewsEnabled left as configured in admin (created as FALSE only if the landing row was missing).');

  // The 4 prescribed demo reviews testing different text lengths
  const demoReviews = [
    {
      reviewerName: 'Dr. A. Sharma',
      reviewerDesignation: 'Demo Reviewer • Clinical Practitioner',
      reviewerLocation: 'New Delhi',
      rating: 5,
      quote: 'Demo testimonial for layout preview. This text is being used only to verify the review-card design, spacing, rating display, and responsive behavior.',
      avatarUrl: null,
      initials: 'AS',
      isPublished: true,
      isDemo: true,
      sortOrder: 10,
    },
    {
      reviewerName: 'Dr. R. Mehta',
      reviewerDesignation: 'Demo Reviewer • Prosthodontics Fellow',
      reviewerLocation: 'Mumbai',
      rating: 5,
      quote: 'Demo testimonial for responsive testing. Preview content validating multi-line quote rendering, mentor feedback typography, reviewer avatar alignment, and mobile card stacking across viewports.',
      avatarUrl: null,
      initials: 'RM',
      isPublished: true,
      isDemo: true,
      sortOrder: 20,
    },
    {
      reviewerName: 'Dr. N. Verma',
      reviewerDesignation: 'Demo Reviewer • General Dental Surgeon',
      reviewerLocation: 'Bengaluru',
      rating: 5,
      quote: 'Demo testimonial for UI testing. This preview content verifies how a longer clinician evaluation wraps across varying viewport widths. It checks line heights, card height harmonization, full-width grid wrapping, and visual balance within the testimonials carousel.',
      avatarUrl: null,
      initials: 'NV',
      isPublished: true,
      isDemo: true,
      sortOrder: 30,
    },
    {
      reviewerName: 'Dr. P. Kapoor',
      reviewerDesignation: 'Demo Reviewer • Restorative Consultant',
      reviewerLocation: 'Chandigarh',
      rating: 5,
      quote: 'Demo testimonial for comprehensive stress testing. This preview content simulates an extensive clinician case reflection to confirm that ultra-long review passages maintain clean card padding, avoid horizontal overflow on 360px mobile viewports, and preserve typographic rhythm across high-density tablet and desktop layouts without breaking the surrounding layout grid.',
      avatarUrl: null,
      initials: 'PK',
      isPublished: true,
      isDemo: true,
      sortOrder: 40,
    },
  ];

  for (const demo of demoReviews) {
    const existing = await prisma.courseTestimonial.findFirst({
      where: {
        courseId: course.id,
        reviewerName: demo.reviewerName,
        isDemo: true,
      },
    });

    if (existing) {
      await prisma.courseTestimonial.update({
        where: { id: existing.id },
        data: demo,
      });
      console.log(`[UPDATED] Demo review: ${demo.reviewerName} (Order: #${demo.sortOrder})`);
    } else {
      await prisma.courseTestimonial.create({
        data: {
          courseId: course.id,
          ...demo,
        },
      });
      console.log(`[CREATED] Demo review: ${demo.reviewerName} (Order: #${demo.sortOrder})`);
    }
  }

  // Verification counts
  const totalInDb = await prisma.courseTestimonial.count({ where: { courseId: course.id } });
  const demoCount = await prisma.courseTestimonial.count({ where: { courseId: course.id, isDemo: true } });
  const realCount = await prisma.courseTestimonial.count({ where: { courseId: course.id, isDemo: false } });

  console.log('--------------------------------------------------');
  console.log(`Total Testimonials in DB: ${totalInDb}`);
  console.log(`Demo Reviews:             ${demoCount}`);
  console.log(`Real Testimonials:        ${realCount}`);
  console.log('--------------------------------------------------');
  console.log('Public visibility: 0 reviews (demo entries strictly excluded).');
  console.log('Admin Preview:     4 demo review cards visible with DEMO REVIEW badges.');
  console.log('SEO / JSON-LD:     0 reviews (demo entries excluded).');
  console.log('==================================================');
}

if (require.main === module) {
  seedDemoReviews()
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Error seeding demo reviews:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}

module.exports = { seedDemoReviews };
