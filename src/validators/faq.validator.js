const { parseFormBool } = require('../lib/formBool');

const MAX_CATEGORY = 100;

function validateFaq(body) {
  const errors = [];

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (question.length < 5 || question.length > 300) {
    errors.push('Question must be between 5 and 300 characters.');
  }

  const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
  if (answer.length < 5 || answer.length > 5000) {
    errors.push('Answer must be between 5 and 5000 characters.');
  }

  // Optional grouping used by the /faq page filter chips. Blank = uncategorised.
  const categoryRaw = typeof body.category === 'string' ? body.category.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
  if (categoryRaw.length > MAX_CATEGORY) {
    errors.push(`Category must be ${MAX_CATEGORY} characters or fewer.`);
  }
  const category = categoryRaw.length > MAX_CATEGORY ? null : categoryRaw || null;

  const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Math.trunc(Number(body.sortOrder)) : 0;
  // Checked => true; unchecked => false (hidden "false" input and/or absent field).
  const isActive = parseFormBool(body.isActive, false);

  return { errors, values: { question, answer, category, sortOrder, isActive } };
}

module.exports = { validateFaq, MAX_CATEGORY };
