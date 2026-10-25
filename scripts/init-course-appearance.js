/*
 * Targeted, idempotent initializer for per-course landing appearance rows.
 *
 *   node scripts/init-course-appearance.js [courseSlug] [presetKey]
 *
 * Defaults: advanced-fmr-master-class + fmr-navy (the exact production FMR look).
 * Creates the row ONLY if the course has none - an existing row is never
 * overwritten - and touches nothing else (no content, lessons, prices ...).
 * It is deliberately NOT a seed: safe to run in production, safe to re-run.
 */
require('dotenv').config();
const { prisma } = require('../src/config/db');
const appearance = require('../src/services/courseAppearance.service');

async function main() {
  const slug = process.argv[2] || 'advanced-fmr-master-class';
  const preset = process.argv[3] || 'fmr-navy';
  const course = await prisma.course.findUnique({ where: { slug }, select: { id: true, title: true } });
  if (!course) throw new Error(`Course not found for slug "${slug}"`);
  const { appearance: row, created } = await appearance.ensureDefaultAppearance(course.id, preset);
  console.log(
    created
      ? `Created appearance for "${course.title}" (id ${course.id}) with preset ${preset}.`
      : `Appearance already exists for "${course.title}" (id ${course.id}) [${row.themePreset}] - left untouched.`
  );
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
