const test = require('node:test');
const assert = require('node:assert');
const { buildSectionRenderList, DEFAULT_SECTION_ORDER } = require('../src/services/courseLanding.service');

test('default order puts REVIEWS immediately before FAQ', () => {
  assert.strictEqual(DEFAULT_SECTION_ORDER.indexOf('REVIEWS') + 1, DEFAULT_SECTION_ORDER.indexOf('FAQ'));
});

test('every block renders once, takeaways emitted a single time even with QUESTIONS and WHY_REGISTER', () => {
  const list = buildSectionRenderList([...DEFAULT_SECTION_ORDER, 'QUESTIONS', 'CURRICULUM']);
  assert.strictEqual(new Set(list).size, list.length);
  assert.strictEqual(list.filter((k) => k === 'TAKEAWAYS').length, 1);
  assert.strictEqual(list[list.indexOf('QUESTIONS') + 1], 'TAKEAWAYS');
});
