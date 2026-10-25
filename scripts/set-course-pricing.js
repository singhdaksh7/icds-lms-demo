/*
 * Targeted, idempotent price setter for ONE course (never a seed).
 *
 *   node scripts/set-course-pricing.js <courseSlug> <regularPrice> [salePrice]
 *   e.g. node scripts/set-course-pricing.js advanced-fmr-master-class 24999 7999
 *
 * Goes through courseService.updateCoursePricing (same validation as the Admin
 * form) and patches only price / salePrice / saleEnabled. Prints the effective
 * price the storefront and Razorpay will use.
 */
require('dotenv').config();
const { prisma } = require('../src/config/db');
const courseService = require('../src/services/course.service');
const { getEffectiveCoursePrice } = require('../src/lib/pricing');
const { toPaise } = require('../src/lib/money');

async function main() {
  const [slug, price, salePrice] = process.argv.slice(2);
  if (!slug || price === undefined) throw new Error('Usage: node scripts/set-course-pricing.js <courseSlug> <regularPrice> [salePrice]');
  const course = await prisma.course.findUnique({ where: { slug }, select: { id: true, title: true } });
  if (!course) throw new Error(`Course not found for slug "${slug}"`);
  const updated = await courseService.updateCoursePricing(course.id, { price, salePrice });
  const p = getEffectiveCoursePrice(updated);
  console.log(`${course.title}: regular ${p.regularLabel}, effective ${p.effectiveLabel}${p.onSale ? ` (${p.badgeLabel})` : ''}; Razorpay amount (before GST) = ${toPaise(p.effectiveString)} paise`);
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
