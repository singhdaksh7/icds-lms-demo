/*
 * Targeted, idempotent initializer for the premium Contact page:
 *
 *   node scripts/init-contact-page.js
 *
 * Fills ONLY the empty hero eyebrow / closing-CTA fields of the existing contact
 * SitePage row (or creates the row if missing) with the starter copy, so the page
 * looks finished on first load. Fields that already hold a value are never
 * overwritten. Contact details (email, phone, WhatsApp, address, hours, map) are
 * NOT touched or invented - they come only from Admin > Site Content.
 *
 * Not a seed: safe in production and safe to re-run (run it once after deploy;
 * re-running later would re-fill a field an admin deliberately cleared).
 */
require('dotenv').config();
const { prisma } = require('../src/config/db');
const sitePages = require('../src/services/sitePages.service');
const { getSettings } = require('../src/services/settings.service');

const FIELDS = ['eyebrow', 'ctaHeading', 'ctaText', 'ctaLabel', 'ctaUrl'];

async function main() {
  const settings = await getSettings().catch(() => null);
  const cms = settings ? settings.cms : null;
  const { row, created } = await sitePages.ensurePage('contact', cms);
  if (created) {
    console.log('Contact page: created with starter copy.');
    return;
  }
  const starter = sitePages.starterDefaults('contact', cms);
  const data = {};
  for (const f of FIELDS) {
    const current = row[f];
    if ((current === null || current === undefined || String(current).trim() === '') && starter[f]) data[f] = starter[f];
  }
  if (!Object.keys(data).length) {
    console.log('Contact page: all starter fields already set - left untouched.');
    return;
  }
  await prisma.sitePage.update({ where: { slug: 'contact' }, data });
  console.log(`Contact page: filled empty fields: ${Object.keys(data).join(', ')}.`);
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
