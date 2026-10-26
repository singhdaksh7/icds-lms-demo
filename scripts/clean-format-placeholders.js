/*
 * One-off, idempotent repair: removes the literal "text" placeholder that an old admin
 * toolbar bug saved into Site Content values, keeping the author's intended formatting
 * ("STAY UPDATED [color=#fafafa]text[/color]" -> "[color=#fafafa]STAY UPDATED[/color]").
 * Touches only SiteSetting rows that contain the placeholder pattern. Safe to re-run.
 *   node scripts/clean-format-placeholders.js
 */
require('dotenv').config();
const { prisma } = require('../src/config/db');
const { fixStoredPlaceholders } = require('../src/lib/richText');

async function main() {
  const rows = await prisma.siteSetting.findMany({ where: { value: { contains: ']text[/' } } });
  let changed = 0;
  for (const row of rows) {
    const fixed = fixStoredPlaceholders(row.value);
    if (fixed !== row.value) {
      await prisma.siteSetting.update({ where: { key: row.key }, data: { value: fixed } });
      console.log(`Fixed ${row.key}: ${JSON.stringify(row.value)} -> ${JSON.stringify(fixed)}`);
      changed += 1;
    }
  }
  console.log(changed ? `Repaired ${changed} value(s).` : 'No placeholder values found.');
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
