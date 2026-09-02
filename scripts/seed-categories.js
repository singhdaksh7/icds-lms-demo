/*
 * Production-safe structural seed: course categories only.
 *
 * Unlike prisma/seed.js (dev convenience data), this does NOT create demo
 * instructors, courses, or lessons — those in prisma/seed.js are placeholder
 * content (fake instructor names/bios, third-party hotlinked thumbnails,
 * invented pricing) that must never be presented on a real client site as
 * if genuine. Categories are pure taxonomy, not claims about any person or
 * price, so they're safe to seed ahead of real course content.
 *
 * Safe to re-run (upserts by slug).
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const categories = [
  { name: 'Cosmetology', slug: 'cosmetology' },
  { name: 'Aesthetics', slug: 'aesthetics' },
  { name: 'Dental Sciences', slug: 'dental-sciences' },
  { name: 'Skin & Hair', slug: 'skin-hair' },
];

async function main() {
  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name },
      create: { ...category, status: 'ACTIVE' },
    });
  }
  console.log(`Seeded ${categories.length} structural categories (no courses/instructors).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
