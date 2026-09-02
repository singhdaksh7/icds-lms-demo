/*
 * Development seed data.
 *
 * IMPORTANT: every category/instructor/course record below is taken
 * verbatim from the placeholder marketing copy that was hardcoded into the
 * original static HTML (see backup/original/). None of this is verified
 * client content — names, bios, prices and thumbnail URLs are all demo
 * data, and the thumbnail URLs point at unrelated third-party sites that
 * must be replaced with licensed/owned images before production (see the
 * audit's "Hardcoded & Dummy Data" section and README "Asset Handling").
 *
 * This script is safe to re-run: it upserts by unique slug/email instead of
 * blindly inserting duplicates.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // ---------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------
  const categories = [
    { name: 'Cosmetology', slug: 'cosmetology' },
    { name: 'Aesthetics', slug: 'aesthetics' },
    { name: 'Dental Sciences', slug: 'dental-sciences' },
    { name: 'Skin & Hair', slug: 'skin-hair' },
  ];

  const categoryBySlug = {};
  for (const category of categories) {
    categoryBySlug[category.slug] = await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name },
      create: { ...category, status: 'ACTIVE' },
    });
  }

  // ---------------------------------------------------------------------
  // Instructors (demo bios/photos — see file header note)
  // ---------------------------------------------------------------------
  const instructors = [
    {
      name: 'Dr. Ananya Sharma',
      slug: 'dr-ananya-sharma',
      title: 'Aesthetic Medicine Educator',
      photoUrl:
        'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=700&q=85',
    },
    {
      name: 'Dr. Rahul Mehta',
      slug: 'dr-rahul-mehta',
      title: 'Dental Sciences Faculty',
      photoUrl:
        'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&w=700&q=85',
    },
    {
      name: 'Neha Kapoor',
      slug: 'neha-kapoor',
      title: 'Cosmetology Specialist',
      photoUrl:
        'https://images.unsplash.com/photo-1594824476967-48c8b964273f?auto=format&fit=crop&w=700&q=85',
    },
    {
      name: 'Dr. Priya Verma',
      slug: 'dr-priya-verma',
      title: 'Skin & Aesthetics Faculty',
      photoUrl:
        'https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=700&q=85',
    },
  ];

  const instructorBySlug = {};
  for (const instructor of instructors) {
    instructorBySlug[instructor.slug] = await prisma.instructor.upsert({
      where: { slug: instructor.slug },
      update: { name: instructor.name, title: instructor.title, photoUrl: instructor.photoUrl },
      create: { ...instructor, status: 'ACTIVE' },
    });
  }

  // ---------------------------------------------------------------------
  // Courses (prices/thumbnails carried over as-is from the static demo)
  // ---------------------------------------------------------------------
  const courses = [
    {
      title: 'Professional Cosmetology Fundamentals',
      slug: 'professional-cosmetology-fundamentals',
      categorySlug: 'cosmetology',
      instructorSlug: 'neha-kapoor',
      price: 4999,
      salePrice: 2499,
      duration: '8h 30m',
      thumbnailUrl:
        'https://www.ssfkz.si/wp-content/gallery/splosno/program_kt/kozmeticni_tehnik_ssfkz_08.jpg',
    },
    {
      title: 'Advanced Skin Care & Facial Techniques',
      slug: 'advanced-skin-care-facial-techniques',
      categorySlug: 'aesthetics',
      instructorSlug: 'dr-ananya-sharma',
      price: 5499,
      salePrice: 2999,
      duration: '7h 15m',
      thumbnailUrl: 'https://eiei.cl/carreras/cosmetologia-2.jpg',
    },
    {
      title: 'Dental Clinical Skills & Patient Care',
      slug: 'dental-clinical-skills-patient-care',
      categorySlug: 'dental-sciences',
      instructorSlug: 'dr-rahul-mehta',
      price: 6999,
      salePrice: 3499,
      duration: '9h 10m',
      thumbnailUrl:
        'https://images.unsplash.com/photo-1609840114035-3c981b782dfe?auto=format&fit=crop&w=1000&q=85',
    },
    {
      title: 'Clinical Aesthetic Procedures',
      slug: 'clinical-aesthetic-procedures',
      categorySlug: 'aesthetics',
      instructorSlug: 'dr-priya-verma',
      price: 5200,
      salePrice: 2799,
      duration: '6h 40m',
      thumbnailUrl:
        'https://studia.uj.edu.pl/documents/144324303/145837864/DSC_7333-1024x683.jpg',
    },
    {
      title: 'Professional Beauty & Makeup Masterclass',
      slug: 'professional-beauty-makeup-masterclass',
      categorySlug: 'cosmetology',
      instructorSlug: 'neha-kapoor',
      price: 4499,
      salePrice: 2199,
      duration: '10h 20m',
      thumbnailUrl:
        'https://frpyol0mhkke.compat.objectstorage.eu-frankfurt-1.oraclecloud.com/blogcms-assets/thumbnail/68e4fa4a760b7ca6cc35c33c437b1cd4/kosmetologia-praca-po-studiach-jak-uniknac-bledow-w-karierze.webp',
    },
    {
      title: 'Advanced Skin, Hair & Beauty Care',
      slug: 'advanced-skin-hair-beauty-care',
      categorySlug: 'skin-hair',
      instructorSlug: 'dr-priya-verma',
      price: 5299,
      salePrice: 2599,
      duration: '7h 55m',
      thumbnailUrl: 'https://www.caizhen.com.tw/uploads/picture/202411/480_480/20241217161305d238.jpg',
    },
  ];

  for (const course of courses) {
    const created = await prisma.course.upsert({
      where: { slug: course.slug },
      update: {
        title: course.title,
        price: course.price,
        salePrice: course.salePrice,
        duration: course.duration,
        thumbnailUrl: course.thumbnailUrl,
      },
      create: {
        title: course.title,
        slug: course.slug,
        shortDescription: `${course.title} — professional online video course.`,
        price: course.price,
        salePrice: course.salePrice,
        currency: 'INR',
        duration: course.duration,
        thumbnailUrl: course.thumbnailUrl,
        level: 'BEGINNER',
        status: 'PUBLISHED',
        featured: true,
        publishedAt: new Date(),
        categoryId: categoryBySlug[course.categorySlug].id,
        instructorId: instructorBySlug[course.instructorSlug].id,
      },
    });

    // A couple of placeholder lessons per course so the lesson-count shown
    // on the homepage isn't just zero. Real lesson content comes later.
    const existingLessons = await prisma.lesson.count({ where: { courseId: created.id } });
    if (existingLessons === 0) {
      await prisma.lesson.createMany({
        data: [
          { courseId: created.id, title: 'Introduction', slug: 'introduction', sortOrder: 1, preview: true, status: 'PUBLISHED' },
          { courseId: created.id, title: 'Core Techniques', slug: 'core-techniques', sortOrder: 2, status: 'PUBLISHED' },
        ],
      });
    }
  }

  console.log('Seed complete:', {
    categories: categories.length,
    instructors: instructors.length,
    courses: courses.length,
  });

  // -----------------------------------------------------------------------
  // Optional dev-only admin user.
  // No production backdoor: this block is skipped entirely when
  // NODE_ENV === 'production', and requires both DEV_ADMIN_EMAIL and
  // DEV_ADMIN_PASSWORD to be explicitly set — no default admin is ever
  // created automatically. Uses the same bcryptjs hashing as real
  // authentication (src/lib/password.js); if you seeded an admin before
  // Phase 3 with the old scrypt placeholder hash, delete/recreate that user
  // — old scrypt hashes will not verify against the bcrypt-based login.
  // -----------------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    const devAdminEmail = process.env.DEV_ADMIN_EMAIL;
    const devAdminPassword = process.env.DEV_ADMIN_PASSWORD;

    if (devAdminEmail && devAdminPassword) {
      const { hashPassword } = require('../src/lib/password');
      const passwordHash = await hashPassword(devAdminPassword);

      await prisma.user.upsert({
        where: { email: devAdminEmail },
        update: { passwordHash, role: 'ADMIN', status: 'ACTIVE' },
        create: {
          name: 'Dev Admin',
          email: devAdminEmail,
          passwordHash,
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });

      console.log(`Dev admin ensured: ${devAdminEmail}`);
    } else {
      console.log(
        'Skipping dev admin creation (set DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD in .env to create one).'
      );
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
