const { prisma } = require('../src/config/db');
const courseLandingService = require('../src/services/courseLanding.service');

async function verifyAll() {
  console.log('=== Production Dynamic Landing & Safety Verification ===\n');

  // 1. Course & Instructor Integrity
  const course = await prisma.course.findFirst({
    where: { slug: 'advanced-fmr-master-class' },
    include: {
      instructor: {
        include: { credentials: true },
      },
      modules: {
        include: { topics: { include: { lessons: true } } },
      },
      lessons: true,
      resources: true,
      testimonials: { where: { isPublished: true } },
    },
  });

  if (!course) {
    throw new Error('Course advanced-fmr-master-class not found!');
  }

  const courseId = course.id;
  const inst = course.instructor;

  console.log('1. FMR Course & Instructor:');
  console.log(`   - Course ID: ${courseId}`);
  console.log(`   - Title: ${course.title}`);
  console.log(`   - Price: ${course.price}`);
  console.log(`   - Instructor Name: ${inst ? inst.name : 'MISSING'}`);
  console.log(`   - Instructor Designation: ${inst ? inst.designation : 'MISSING'}`);
  console.log(`   - Instructor Organization: ${inst ? inst.organization : 'MISSING'}`);
  console.log(`   - Instructor Credentials count: ${inst ? inst.credentials.length : 0}`);
  console.log(`   - Modules: ${course.modules.length}`);
  const topicsCount = course.modules.reduce((sum, m) => sum + m.topics.length, 0);
  console.log(`   - Topics: ${topicsCount}`);
  const publishedLessons = course.lessons.filter(l => l.status === 'PUBLISHED');
  const draftLessons = course.lessons.filter(l => l.status === 'DRAFT');
  console.log(`   - Published Lessons: ${publishedLessons.length}`);
  console.log(`   - Draft Lessons: ${draftLessons.length}`);
  console.log(`   - Resources: ${course.resources.length}`);
  console.log(`   - Published Testimonials: ${course.testimonials.length}`);

  if (Number(course.price) !== 0) throw new Error('FMR price is not 0 / Free!');
  if (publishedLessons.length !== 15) throw new Error(`Expected 15 published lessons, found ${publishedLessons.length}`);
  if (draftLessons.length !== 8) throw new Error(`Expected 8 draft lessons, found ${draftLessons.length}`);
  if (course.resources.length !== 1) throw new Error(`Expected 1 resource, found ${course.resources.length}`);
  if (course.testimonials.length !== 0) throw new Error('Expected 0 published testimonials!');

  // 2. Auto Stats Verification
  console.log('\n2. Verifying Auto Stats Calculation:');
  const dummyStats = [
    { statType: 'PUBLISHED_VIDEO_COUNT', label: 'Video Lessons', sortOrder: 1 },
    { statType: 'TOTAL_VIDEO_DURATION', label: 'Total Duration', sortOrder: 2 },
    { statType: 'RESOURCE_COUNT', label: 'Clinical Forms', sortOrder: 3 },
    { statType: 'MODULE_COUNT', label: 'Modules', sortOrder: 4 },
    { statType: 'TOPIC_COUNT', label: 'Topics', sortOrder: 5 },
    { statType: 'REVIEW_COUNT', label: 'Reviews', sortOrder: 6 },
  ];
  const context = {
    videoCount: publishedLessons.length,
    resourceCount: course.resources.length,
    moduleCount: course.modules.length,
    topicCount: topicsCount,
    reviewCount: course.testimonials.length,
  };
  const resolved = courseLandingService.resolveCourseStats(dummyStats, context);
  resolved.forEach(s => {
    console.log(`   - ${s.statType}: displayValue="${s.displayValue}", label="${s.label}"`);
  });

  const videoStat = resolved.find(s => s.statType === 'PUBLISHED_VIDEO_COUNT');
  if (videoStat.displayValue !== '15') throw new Error(`Expected 15 videos, got ${videoStat.displayValue}`);
  const resourceStat = resolved.find(s => s.statType === 'RESOURCE_COUNT');
  if (resourceStat.displayValue !== '1') throw new Error(`Expected 1 resource, got ${resourceStat.displayValue}`);
  const moduleStat = resolved.find(s => s.statType === 'MODULE_COUNT');
  if (moduleStat.displayValue !== '4') throw new Error(`Expected 4 modules, got ${moduleStat.displayValue}`);
  const topicStat = resolved.find(s => s.statType === 'TOPIC_COUNT');
  if (topicStat.displayValue !== '9') throw new Error(`Expected 9 topics, got ${topicStat.displayValue}`);
  const reviewStat = resolved.find(s => s.statType === 'REVIEW_COUNT');
  if (reviewStat.displayValue !== '0') throw new Error(`Expected 0 reviews, got ${reviewStat.displayValue}`);
  console.log('   ✔ All auto stats match real DB data exactly.');

  // 3. Section Reordering Verification
  console.log('\n3. Verifying Section Reordering:');
  const initialSections = await courseLandingService.ensureCourseLandingSections(courseId);
  console.log(`   - Default ordered sections: ${initialSections.length} sections`);
  console.log(`   - Initial order: ${initialSections.map(s => s.sectionKey).join(' -> ')}`);

  // Move second section UP to first position
  const sec2 = initialSections[1];
  console.log(`   - Testing move '${sec2.sectionKey}' UP...`);
  await courseLandingService.moveCourseSection(courseId, sec2.sectionKey, 'up');

  const afterMove = await courseLandingService.ensureCourseLandingSections(courseId);
  console.log(`   - Order after move: ${afterMove.map(s => s.sectionKey).join(' -> ')}`);
  if (afterMove[0].sectionKey !== sec2.sectionKey) {
    throw new Error(`Move UP failed! Expected first section to be ${sec2.sectionKey}`);
  }
  console.log('   ✔ Move UP verified.');

  // Revert back
  console.log(`   - Reverting '${sec2.sectionKey}' back DOWN...`);
  await courseLandingService.moveCourseSection(courseId, sec2.sectionKey, 'down');
  const restored = await courseLandingService.ensureCourseLandingSections(courseId);
  console.log(`   - Restored order: ${restored.map(s => s.sectionKey).join(' -> ')}`);
  if (restored[0].sectionKey !== initialSections[0].sectionKey) {
    throw new Error('Revert move failed!');
  }
  console.log('   ✔ Section reordering verified and restored cleanly.');

  // 4. Access Plan CRUD Verification
  console.log('\n4. Verifying Access Plan CRUD:');
  const plan = await courseLandingService.addAccessPlan(courseId, {
    label: 'Test 365 Days Access',
    durationDays: 365,
    price: 4999,
    salePrice: 2999,
    isDefault: false,
    isPublished: true,
  });
  console.log(`   - Created test plan ID: ${plan.id}`);
  await courseLandingService.updateAccessPlan(courseId, plan.id, {
    label: 'Updated 365 Days Access',
    price: 3999,
  });
  await courseLandingService.deleteAccessPlan(courseId, plan.id);
  const remainingPlans = await prisma.courseAccessPlan.findMany({ where: { courseId, isPublished: true } });
  console.log(`   - Cleaned up test plan. Current published plans for FMR: ${remainingPlans.length}`);
  console.log('   ✔ Access Plan CRUD verified.');

  // 5. Comparison Section CRUD Verification
  console.log('\n5. Verifying Comparison Matrix CRUD:');
  const col = await courseLandingService.addComparisonColumn(courseId, {
    title: 'Masterclass Edition',
    subtitle: 'Comprehensive Access',
    badgeText: 'Recommended',
    isRecommended: true,
  });
  const colItem = await courseLandingService.addComparisonItem(courseId, col.id, {
    text: 'Full Access to 15 Clinical Modules',
  });
  await courseLandingService.deleteComparisonColumn(courseId, col.id);
  const remainingCols = await prisma.courseComparisonColumn.findMany({ where: { courseId } });
  console.log(`   - Cleaned up test comparison. Current columns for FMR: ${remainingCols.length}`);
  console.log('   ✔ Comparison matrix CRUD verified.');

  // 6. Access Steps CRUD Verification
  console.log('\n6. Verifying How You Get Access Steps CRUD:');
  const step = await courseLandingService.addAccessStep(courseId, {
    title: 'Instant Enrollment Step',
    description: 'Verify instant access upon registration',
    icon: 'bi-box-arrow-in-right',
  });
  await courseLandingService.deleteAccessStep(courseId, step.id);
  const remainingSteps = await prisma.courseAccessStep.findMany({ where: { courseId } });
  console.log(`   - Cleaned up test step. Current steps for FMR: ${remainingSteps.length}`);
  console.log('   ✔ Access steps CRUD verified.');

  // 7. Public Landing Data Aggregation Verification
  console.log('\n7. Verifying Public Landing Data Aggregation:');
  const publicData = await courseLandingService.getPublicLandingData(courseId, context);
  console.log(`   - Enabled ordered sections: ${publicData.landingSections.length}`);
  console.log(`   - Questions count: ${publicData.questions.length}`);
  console.log(`   - FAQs count: ${publicData.faqs.length}`);
  console.log(`   - Why Register items (Want: ${publicData.whyRegisterWant.length}, Get: ${publicData.whyRegisterGet.length})`);
  console.log(`   - Highlights count: ${publicData.highlights.length}`);
  console.log('   ✔ Public landing data aggregation verified.');

  console.log('\n=== ALL VERIFICATIONS PASSED SUCCESSFULLY ===');
}

verifyAll()
  .catch(err => {
    console.error('\n❌ Verification Failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
