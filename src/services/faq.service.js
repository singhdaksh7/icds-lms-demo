const { prisma } = require('../config/db');

class FaqError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FaqError';
  }
}

async function listFaqsAdmin() {
  return prisma.faq.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
}

// Public homepage: active only, ordered by sortOrder.
async function listActiveFaqs() {
  return prisma.faq.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
}

async function createFaq(values) {
  return prisma.faq.create({ data: values });
}

async function updateFaq(id, values) {
  const existing = await prisma.faq.findUnique({ where: { id } });
  if (!existing) {
    throw new FaqError('FAQ entry not found.');
  }
  return prisma.faq.update({ where: { id }, data: values });
}

async function deleteFaq(id) {
  const existing = await prisma.faq.findUnique({ where: { id } });
  if (!existing) {
    throw new FaqError('FAQ entry not found.');
  }
  await prisma.faq.delete({ where: { id } });
}

// Sensible, truthful defaults describing the ACTUAL current system (manual
// enrollment requests, no live online payment) — never claims features that
// don't exist. Only ever inserted when the table is completely empty, and
// only once (guarded by a row count check), so this never duplicates
// entries on repeated app starts/deploys.
const DEFAULT_FAQS = [
  {
    question: 'How do I enroll in a course?',
    answer:
      "Create your student account and open the course you're interested in. Free courses give you instant access. For paid courses, submit a Request Enrollment and our team will contact you to complete enrollment — once confirmed, the course appears in your student dashboard.",
    sortOrder: 1,
  },
  {
    question: 'Can I access courses on mobile?',
    answer: 'Yes. The learning platform is designed to work across desktop, tablet and mobile devices.',
    sortOrder: 2,
  },
  {
    question: 'Do courses include certificates?',
    answer: 'Eligible courses provide a certificate once you complete every lesson in the course.',
    sortOrder: 3,
  },
  {
    question: 'How long can I access my enrolled course?',
    answer:
      'Course access duration can be configured by the institute. The course detail page displays the access period before you request enrollment.',
    sortOrder: 4,
  },
  {
    question: 'Can I watch lessons more than once?',
    answer: 'Yes. You can revisit any lesson you have access to as many times as you like.',
    sortOrder: 5,
  },
];

// Called once at server startup (see server.js). Never touches an existing
// row and never runs twice against the same non-empty table.
async function ensureDefaultFaqs() {
  const count = await prisma.faq.count();
  if (count > 0) return;
  await prisma.faq.createMany({ data: DEFAULT_FAQS.map((f) => ({ ...f, isActive: true })) });
}

module.exports = {
  FaqError,
  listFaqsAdmin,
  listActiveFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
  ensureDefaultFaqs,
  DEFAULT_FAQS,
};
