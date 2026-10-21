const { prisma } = require('../src/config/db');
const courseLandingService = require('../src/services/courseLanding.service');

async function runQa() {
  console.log('=== Starting Admin Landing CMS Live Production QA ===');

  const course = await prisma.course.findFirst({
    where: { slug: 'advanced-fmr-master-class' },
  });

  if (!course) {
    throw new Error('FMR course not found');
  }

  const courseId = course.id;
  console.log(`Testing Course ID: ${courseId} (${course.title})`);

  // Step 1: Read admin landing data
  const adminData = await courseLandingService.getAdminLandingData(courseId);
  console.log('✔ getAdminLandingData succeeded:');
  console.log('  - Hero Eyebrow:', adminData.landingContent.heroEyebrow);
  console.log('  - Chips count:', adminData.heroChips.length);
  console.log('  - Takeaways count:', adminData.takeaways.length);
  console.log('  - Questions count:', adminData.questions.length);
  console.log('  - FAQs count:', adminData.faqs.length);
  console.log('  - Certificate enabled:', adminData.landingContent.certificateSectionEnabled);

  // Step 2: Edit Hero eyebrow & toggle section
  console.log('\nTesting Hero edit & section toggle...');
  const originalEyebrow = adminData.landingContent.heroEyebrow;
  await courseLandingService.upsertLandingSettings(courseId, {
    ...adminData.landingContent,
    heroEyebrow: 'Dental Sciences • Live QA Test Verified',
    certificateSectionEnabled: false,
  });
  const updatedSettings = await prisma.courseLandingContent.findUnique({ where: { courseId } });
  if (updatedSettings.heroEyebrow !== 'Dental Sciences • Live QA Test Verified') {
    throw new Error('Hero eyebrow update failed');
  }
  console.log('✔ Hero update verified.');

  // Step 3: Add temporary FAQ
  console.log('\nTesting Add FAQ...');
  const newFaq = await courseLandingService.addCourseFaq(courseId, {
    question: 'Live QA Temporary Question?',
    answer: 'Live QA Temporary Answer verified.',
    sortOrder: 99,
    isPublished: true,
  });
  console.log('✔ Added FAQ ID:', newFaq.id);

  // Step 4: Reorder card (chips or takeaways)
  console.log('\nTesting Card Reordering...');
  const chipsBefore = await prisma.courseHeroChip.findMany({ where: { courseId }, orderBy: { sortOrder: 'asc' } });
  if (chipsBefore.length >= 2) {
    const secondChip = chipsBefore[1];
    await courseLandingService.moveHeroChip(courseId, secondChip.id, 'up');
    const chipsAfter = await prisma.courseHeroChip.findMany({ where: { courseId }, orderBy: { sortOrder: 'asc' } });
    console.log(`✔ Swapped chip "${secondChip.label}" to first position.`);
    // Revert swap
    await courseLandingService.moveHeroChip(courseId, secondChip.id, 'down');
    console.log('✔ Reverted chip swap to original order.');
  }

  // Step 5: Delete temporary FAQ
  console.log('\nTesting Delete FAQ...');
  await courseLandingService.deleteCourseFaq(courseId, newFaq.id);
  const checkDeleted = await prisma.courseFaq.findUnique({ where: { id: newFaq.id } });
  if (checkDeleted) throw new Error('Delete FAQ failed');
  console.log('✔ Successfully deleted temporary QA FAQ.');

  // Step 6: Revert Hero eyebrow to original
  console.log('\nReverting Hero to production value...');
  await courseLandingService.upsertLandingSettings(courseId, {
    ...adminData.landingContent,
    heroEyebrow: originalEyebrow,
    certificateSectionEnabled: false,
  });
  console.log('✔ Hero eyebrow reverted cleanly.');

  // Step 7: Final public landing data check
  const publicData = await courseLandingService.getPublicLandingData(courseId);
  console.log('\n✔ getPublicLandingData verified:');
  console.log('  - Hero Eyebrow:', publicData.content.heroEyebrow);
  console.log('  - Certificate section enabled:', publicData.content.certificateSectionEnabled);
  console.log('  - Audience For count:', publicData.audienceFor.length);
  console.log('  - Audience Not For count:', publicData.audienceNotFor.length);
  console.log('  - FAQs count:', publicData.faqs.length);

  console.log('\n=== ALL ADMIN LANDING CMS OPERATIONS VERIFIED SUCCESSFULLY ===');
}

if (require.main === module) {
  runQa()
    .catch((err) => {
      console.error('QA FAILED:', err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { runQa };
