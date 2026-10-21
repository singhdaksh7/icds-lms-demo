const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function migrateFmrHierarchy() {
  console.log('[FMR-MIGRATION] Starting FMR Hierarchy & Resource Migration...');

  // 1. Find Course 6 / advanced-fmr-master-class
  const course = await prisma.course.findFirst({
    where: {
      OR: [{ id: 6 }, { slug: 'advanced-fmr-master-class' }],
    },
  });

  if (!course) {
    throw new Error('Course "advanced-fmr-master-class" (id 6) not found.');
  }

  console.log(`[FMR-MIGRATION] Found course id=${course.id}, title="${course.title}"`);

  // 2. Set Course Business State (₹0 / Free, no fake instructor, PUBLISHED)
  await prisma.course.update({
    where: { id: course.id },
    data: {
      price: 0.0,
      salePrice: null,
      instructorId: null,
      status: 'PUBLISHED',
    },
  });
  console.log('[FMR-MIGRATION] Updated course business state: Price ₹0 / Free, instructor null, status PUBLISHED.');

  // 3. Define Modules & Topics structure
  const modulesDef = [
    {
      title: 'FMR Foundations & Occlusal Principles',
      sortOrder: 10,
      description: 'Core concepts of Full Mouth Rehabilitation and occlusal tooth wear mechanics.',
      topics: [
        {
          title: 'Introduction & Core Philosophy',
          sortOrder: 10,
          description: 'Overview of clinical full mouth rehabilitation and core principles.',
          lessonSlugs: ['introductory-video', '3-s-in-fmr'],
        },
        {
          title: 'Tooth Wear and Collapsed Bite',
          sortOrder: 20,
          description: 'Etiology, diagnostics, anterior attrition, and treatment approaches.',
          lessonSlugs: [
            'tooth-wear-and-collapsed-bite-ep-1-introduction',
            'tooth-wear-and-collapsed-bite-ep-2-difference-between-bruxer-and-clencher',
            'tooth-wear-and-collapsed-bite-ep-3-anterior-attrition',
            'tooth-wear-and-collapsed-bite-ep-4-treatment-approaches-of-different-tooth-wear-conditions',
          ],
        },
      ],
    },
    {
      title: 'Facebow & Articulators',
      sortOrder: 20,
      description: 'Cranial references, facebow transfer protocols, and articulator programming.',
      topics: [
        {
          title: 'Facebow Protocols',
          sortOrder: 10,
          description: 'Theory and clinical demonstration of facebow transfer.',
          lessonSlugs: [
            'facebow-ep-1-theory-of-facebow',
            'facebow-ep-2-video-demonstration-of-how-to-use-facebow',
          ],
        },
        {
          title: 'Semi-Adjustable Articulators',
          sortOrder: 20,
          description: 'Understanding instrument geometry and learning the Hanau articulator.',
          lessonSlugs: [
            'articulators-ep-1-introduction',
            'articulators-ep-2-requirement-of-a-semi-adjustable-articulator',
            'articulators-ep-3-learning-hanau-articulator',
          ],
        },
        {
          title: 'Articulator Preparation & Programming',
          sortOrder: 30,
          description: 'Zeroing, calibration, mechanical anatomy, and dynamic programming.',
          lessonSlugs: [
            'articulators-ep-4a-zeroing-of-articulator',
            'articulators-ep-4b-video-demonstration-of-programming-of-articulator',
            'articulators-ep-5-video-demonstration-of-parts-of-articulators',
          ],
        },
      ],
    },
    {
      title: 'Temporomandibular Joint',
      sortOrder: 30,
      description: 'Anatomy, biomechanics, clinical muscle examination, and joint diagnostics.',
      topics: [
        {
          title: 'Foundations & Biomechanics',
          sortOrder: 10,
          description: 'Normal anatomy of TMJ, ligaments, and masticatory musculature.',
          lessonSlugs: [
            'tmj-temporomandibular-joint-ep-1-normal-anatomy-of-tmj-and-biomechanics',
            'tmj-temporomandibular-joint-ep-2-ligaments',
            'tmj-temporomandibular-joint-ep-3-muscles-of-mastication',
          ],
        },
        {
          title: 'Clinical Examination & Diagnostics',
          sortOrder: 20,
          description: 'Systematic muscle examination, Rocabado pain mapping, and range of motion.',
          lessonSlugs: [
            'tmj-temporomandibular-joint-ep-4-muscle-examination',
            'tmj-temporomandibular-joint-ep-5-tmj-examination-and-rocabado-pain-map',
            'tmj-temporomandibular-joint-ep-6-range-of-motion',
          ],
        },
        {
          title: 'Clinical Demonstrations & Palpation',
          sortOrder: 30,
          description: 'Five joint positions, palpation demonstrations, and neck movement evaluation.',
          lessonSlugs: [
            'tmj-temporomandibular-joint-ep-7-five-joint-positions-used-in-dentistry-today',
            'tmj-temporomandibular-joint-ep-8-video-demonstration-of-muscle-palpation',
            'tmj-temporomandibular-joint-ep-9-video-demonstration-of-joint-palpation-and-neck-movements',
          ],
        },
      ],
    },
    {
      title: 'Case History & Clinical Resources',
      sortOrder: 40,
      description: 'Comprehensive clinical forms, examination protocols, and data collection tools.',
      topics: [
        {
          title: 'Case History Forms',
          sortOrder: 10,
          description: 'Dental case history documentation package for clinical practice.',
          lessonSlugs: [],
        },
      ],
    },
  ];

  let caseHistoryTopicId = null;

  for (const mDef of modulesDef) {
    // Find or create module
    let mod = await prisma.courseModule.findFirst({
      where: {
        courseId: course.id,
        title: mDef.title,
      },
    });

    if (!mod) {
      mod = await prisma.courseModule.create({
        data: {
          courseId: course.id,
          title: mDef.title,
          description: mDef.description,
          sortOrder: mDef.sortOrder,
          isPublished: true,
        },
      });
      console.log(`[FMR-MIGRATION] Created module: ${mod.title} (id=${mod.id})`);
    } else {
      mod = await prisma.courseModule.update({
        where: { id: mod.id },
        data: {
          sortOrder: mDef.sortOrder,
          description: mDef.description,
          isPublished: true,
        },
      });
      console.log(`[FMR-MIGRATION] Updated module: ${mod.title} (id=${mod.id})`);
    }

    for (const tDef of mDef.topics) {
      let topic = await prisma.courseTopic.findFirst({
        where: {
          moduleId: mod.id,
          title: tDef.title,
        },
      });

      if (!topic) {
        topic = await prisma.courseTopic.create({
          data: {
            moduleId: mod.id,
            title: tDef.title,
            description: tDef.description,
            sortOrder: tDef.sortOrder,
            isPublished: true,
          },
        });
        console.log(`  [FMR-MIGRATION] Created topic: ${topic.title} (id=${topic.id})`);
      } else {
        topic = await prisma.courseTopic.update({
          where: { id: topic.id },
          data: {
            sortOrder: tDef.sortOrder,
            description: tDef.description,
            isPublished: true,
          },
        });
        console.log(`  [FMR-MIGRATION] Updated topic: ${topic.title} (id=${topic.id})`);
      }

      if (mDef.title === 'Case History & Clinical Resources' && tDef.title === 'Case History Forms') {
        caseHistoryTopicId = topic.id;
      }

      // Assign lessons
      let lIdx = 1;
      for (const slug of tDef.lessonSlugs) {
        const lesson = await prisma.lesson.findFirst({
          where: {
            courseId: course.id,
            slug: slug,
          },
        });

        if (lesson) {
          await prisma.lesson.update({
            where: { id: lesson.id },
            data: {
              topicId: topic.id,
              sortOrder: lIdx * 10,
            },
          });
          console.log(`    [FMR-MIGRATION] Bound lesson "${lesson.title}" (id=${lesson.id}, status=${lesson.status}) -> Topic id=${topic.id}`);
          lIdx++;
        } else {
          console.warn(`    [FMR-MIGRATION] Warning: lesson with slug "${slug}" not found in course ${course.id}`);
        }
      }
    }
  }

  // 4. Attach Single Existing Clinical PDF Resource
  const existingResourceKey = 'courses/advanced-fmr-master-class/resources/dental-case-history-forms.pdf';
  let resource = await prisma.courseResource.findFirst({
    where: {
      courseId: course.id,
      objectKey: existingResourceKey,
    },
  });

  if (!resource) {
    resource = await prisma.courseResource.create({
      data: {
        courseId: course.id,
        topicId: caseHistoryTopicId,
        title: 'Dental Case History Forms',
        objectKey: existingResourceKey,
        contentType: 'application/pdf',
        sizeBytes: 1010253,
        sortOrder: 10,
        isPublished: true,
      },
    });
    console.log(`[FMR-MIGRATION] Attached CourseResource: "${resource.title}" (id=${resource.id}) -> Topic id=${caseHistoryTopicId}`);
  } else {
    resource = await prisma.courseResource.update({
      where: { id: resource.id },
      data: {
        topicId: caseHistoryTopicId,
        title: 'Dental Case History Forms',
        sizeBytes: 1010253,
        isPublished: true,
      },
    });
    console.log(`[FMR-MIGRATION] Verified existing CourseResource id=${resource.id}`);
  }

  // 5. Verification Check
  const totalLessons = await prisma.lesson.count({ where: { courseId: course.id } });
  const publishedLessons = await prisma.lesson.count({ where: { courseId: course.id, status: 'PUBLISHED' } });
  const draftLessons = await prisma.lesson.count({ where: { courseId: course.id, status: 'DRAFT' } });
  const modulesCount = await prisma.courseModule.count({ where: { courseId: course.id } });
  const topicsCount = await prisma.courseTopic.count({ where: { module: { courseId: course.id } } });
  const resourcesCount = await prisma.courseResource.count({ where: { courseId: course.id } });

  console.log('==================================================');
  console.log('[FMR-MIGRATION] VERIFICATION SUMMARY:');
  console.log(`Modules: ${modulesCount} (Expected 4)`);
  console.log(`Topics: ${topicsCount} (Expected 7)`);
  console.log(`Total Lessons: ${totalLessons} (Expected 23)`);
  console.log(`Published Lessons: ${publishedLessons} (Expected 15)`);
  console.log(`Draft Lessons: ${draftLessons} (Expected 8)`);
  console.log(`Resources: ${resourcesCount} (Expected 1)`);
  console.log('==================================================');
}

if (require.main === module) {
  migrateFmrHierarchy()
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[FMR-MIGRATION-ERROR]', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}

module.exports = { migrateFmrHierarchy };
