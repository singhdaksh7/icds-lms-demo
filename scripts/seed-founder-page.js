/*
 * Idempotent seed for the public Founder page (/founder).
 * Uses ONLY owner-supplied facts. Safe to re-run: existing rows are matched
 * by natural key (title/question/label) and updated, never duplicated.
 * Instructor bio/photo/intro/qualificationsLine are only filled when empty,
 * so admin edits are not overwritten.
 *
 * Usage (explicit opt-in required):
 *   node scripts/seed-founder-page.js --confirm
 * Refuses under NODE_ENV=production. It targets whatever DATABASE_URL points
 * to, so check your .env before running.
 */
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run: NODE_ENV=production.');
  process.exit(1);
}
if (!process.argv.includes('--confirm')) {
  console.error('Refusing to run without --confirm. Usage: node scripts/seed-founder-page.js --confirm');
  process.exit(1);
}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BIO = [
  'Dr. Tanu Raghav is a highly accomplished Prosthodontist and Implantologist with over a decade of experience in the field of dentistry.',
  'She completed her MDS from Prosthodontics and Implantology from Subharti Dental College, following her BDS from Ghaziabad in 2014. She has completed further fellowship training in clinical cosmetology (FFA) and micropigmentation.',
  'She has contributed to dental research with several articles published in national and international journals. She has been providing private clinical dental care for the past 10 years.',
  'She is the founder and director of ICDS — Institute of Comprehensive Dental Studies / Institute of Cosmetology and Dental Sciences. Over the last two years she has trained more than 50 doctors across different dental specializations.',
].join('\n\n');

const INTRO = 'Prosthodontist and Implantologist with over a decade of experience, and founder and director of ICDS, where she has trained more than 50 doctors across different dental specializations over the last two years.';

const QUALIFICATIONS = [
  { title: 'BDS', subtitle: 'Ghaziabad, 2014' },
  { title: 'MDS — Prosthodontics and Implantology', subtitle: 'Subharti Dental College' },
  { title: 'FFA (USA)', subtitle: null },
  { title: 'Clinical Cosmetology', subtitle: 'Fellowship training' },
  { title: 'Micropigmentation', subtitle: 'Fellowship training' },
];

const TIMELINE = [
  { yearLabel: '2014', title: 'BDS completed', description: 'Completed BDS in Ghaziabad.' },
  { yearLabel: 'MDS', title: 'Prosthodontics and Implantology', description: 'Subharti Dental College.' },
  { yearLabel: '10+ Years', title: 'Private clinical practice', description: null },
  { yearLabel: 'Last 2 Years', title: '50+ doctors trained through ICDS', description: null },
];

const INITIATIVES = [
  {
    title: 'ICDS',
    description: 'Institute of Comprehensive Dental Studies / Institute of Cosmetology and Dental Sciences — education and training for dental professionals.',
    iconKey: 'mortarboard',
    ctaLabel: 'Explore courses',
    ctaUrl: '/courses',
  },
];

const RESEARCH = [
  { kind: 'JOURNAL_NATIONAL', title: 'Articles published in national journals', description: null },
  { kind: 'JOURNAL_INTERNATIONAL', title: 'Articles published in international journals', description: null },
  { kind: 'TEACHING', title: 'Clinical teaching', description: null },
  { kind: 'TRAINING', title: 'Professional training of dental practitioners', description: null },
];

const STATS = [
  { valueText: '50+', label: 'Doctors Trained' },
  { valueText: '10+', label: 'Years Clinical Experience' },
];

const FAQS = [
  { question: 'Who is Dr. Tanu Raghav?', answer: 'Dr. Tanu Raghav is a Prosthodontist and Implantologist with over a decade of experience in dentistry, and the founder and director of ICDS.' },
  { question: 'What are her qualifications?', answer: 'BDS, MDS in Prosthodontics and Implantology, and FFA (USA). She has also completed fellowship training in clinical cosmetology and micropigmentation.' },
  { question: 'What is ICDS?', answer: 'ICDS stands for Institute of Comprehensive Dental Studies / Institute of Cosmetology and Dental Sciences, founded by Dr. Tanu Raghav.' },
  { question: 'What does ICDS teach?', answer: 'ICDS provides education and training for dental professionals across different specializations. Please see the Courses page for what is currently offered.' },
  { question: 'Where did she complete her MDS?', answer: 'She completed her MDS in Prosthodontics and Implantology from Subharti Dental College, following her BDS from Ghaziabad in 2014.' },
];

async function upsertBy(model, where, data) {
  const existing = await model.findFirst({ where });
  if (existing) return model.update({ where: { id: existing.id }, data });
  return model.create({ data: { ...where, ...data } });
}

async function main() {
  const instructor = await prisma.instructor.findFirst({
    where: { OR: [{ slug: 'dr-tanu-raghav' }, { name: { contains: 'Tanu Raghav' } }] },
    orderBy: { id: 'asc' },
  });
  if (!instructor) {
    console.error('No existing Dr. Tanu Raghav instructor found; refusing to create a duplicate or guess. Create it first.');
    process.exit(1);
  }

  const empty = (v) => v == null || String(v).trim() === '';
  await prisma.instructor.update({
    where: { id: instructor.id },
    data: {
      isFounder: true,
      qualificationsLine: empty(instructor.qualificationsLine) ? 'BDS · MDS · FFA (USA)' : instructor.qualificationsLine,
      founderIntro: empty(instructor.founderIntro) ? INTRO : instructor.founderIntro,
      bio: empty(instructor.bio) ? BIO : instructor.bio,
      title: empty(instructor.title) ? 'Founder & Prosthodontist' : instructor.title,
      designation: empty(instructor.designation) ? 'Founder, ICDS' : instructor.designation,
    },
  });

  for (const [idx, q] of QUALIFICATIONS.entries()) {
    await upsertBy(prisma.founderQualification, { title: q.title }, { subtitle: q.subtitle, sortOrder: idx, isPublished: true });
  }
  for (const [idx, t] of TIMELINE.entries()) {
    await upsertBy(prisma.founderTimelineEntry, { instructorId: instructor.id, yearLabel: t.yearLabel }, { title: t.title, description: t.description, sortOrder: idx, isPublished: true });
  }
  for (const [idx, n] of INITIATIVES.entries()) {
    await upsertBy(prisma.founderInitiative, { title: n.title }, { description: n.description, iconKey: n.iconKey, ctaLabel: n.ctaLabel, ctaUrl: n.ctaUrl, sortOrder: idx, isPublished: true });
  }
  for (const [idx, r] of RESEARCH.entries()) {
    await upsertBy(prisma.founderResearchItem, { instructorId: instructor.id, kind: r.kind }, { title: r.title, description: r.description, sortOrder: idx, isPublished: true });
  }
  for (const [idx, s] of STATS.entries()) {
    await upsertBy(prisma.founderStat, { label: s.label }, { valueText: s.valueText, sortOrder: idx, isPublished: true });
  }
  for (const [idx, f] of FAQS.entries()) {
    await upsertBy(prisma.founderFaq, { question: f.question }, { answer: f.answer, sortOrder: idx, isPublished: true });
  }

  console.log(`Founder page seeded for instructor #${instructor.id}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
