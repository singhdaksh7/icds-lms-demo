/*
 * Targeted, idempotent initializer for the CMS-backed standalone pages and the
 * admin-managed navigation:
 *
 *   node scripts/init-site-pages-nav.js
 *
 *  - creates the default header/footer menu ONLY when navigation_items is empty
 *  - creates the about / faq / reviews / contact page rows (and the About
 *    sections) ONLY when missing; existing rows are never overwritten
 *  - starter copy is derived from the site's own admin-editable content (Site
 *    Content > Why ICDS / FAQ); no invented claims, phone numbers or addresses
 *
 * Not a seed: safe to run in production and safe to re-run.
 */
require('dotenv').config();
const { prisma } = require('../src/config/db');
const navigation = require('../src/services/navigation.service');
const sitePages = require('../src/services/sitePages.service');
const { getSettings } = require('../src/services/settings.service');

async function main() {
  const settings = await getSettings().catch(() => null);
  const cms = settings ? settings.cms : null;

  const nav = await navigation.ensureDefaultNav();
  console.log(nav.created ? `Navigation: created ${nav.created} default items.` : 'Navigation: already has items - left untouched.');

  for (const slug of sitePages.PAGE_SLUGS) {
    const { created } = await sitePages.ensurePage(slug, cms);
    console.log(created ? `Page "${slug}": created.` : `Page "${slug}": already exists - left untouched.`);
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
