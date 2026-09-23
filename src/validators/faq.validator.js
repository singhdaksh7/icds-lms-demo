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

  const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Math.trunc(Number(body.sortOrder)) : 0;
  const isActive = body.isActive === 'true' || body.isActive === true || body.isActive === 'on';

  return { errors, values: { question, answer, sortOrder, isActive } };
}

module.exports = { validateFaq };
