const test = require('node:test');
const assert = require('node:assert/strict');
const { validateFaq } = require('../src/validators/faq.validator');

test('validateFaq rejects a too-short question and answer', () => {
  const { errors } = validateFaq({ question: 'Hi', answer: 'No' });
  assert.equal(errors.length, 2);
});

test('validateFaq accepts a well-formed entry and trims whitespace', () => {
  const { errors, values } = validateFaq({
    question: '  How do I enroll?  ',
    answer: '  Submit a request and our team will follow up.  ',
    sortOrder: '3',
    isActive: 'on',
  });
  assert.equal(errors.length, 0);
  assert.equal(values.question, 'How do I enroll?');
  assert.equal(values.answer, 'Submit a request and our team will follow up.');
  assert.equal(values.sortOrder, 3);
  assert.equal(values.isActive, true);
});

test('validateFaq defaults isActive to false when the checkbox is unchecked (field absent)', () => {
  const { values } = validateFaq({ question: 'A valid question?', answer: 'A valid answer.' });
  assert.equal(values.isActive, false);
});

test('validateFaq defaults sortOrder to 0 on invalid input', () => {
  const { values } = validateFaq({ question: 'A valid question?', answer: 'A valid answer.', sortOrder: 'not-a-number' });
  assert.equal(values.sortOrder, 0);
});
