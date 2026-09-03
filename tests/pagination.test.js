const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePage, buildPagination } = require('../src/lib/pagination');

test('parsePage clamps non-numeric input to page 1', () => {
  assert.equal(parsePage('abc'), 1);
  assert.equal(parsePage(undefined), 1);
  assert.equal(parsePage(null), 1);
});

test('parsePage clamps zero/negative input to page 1', () => {
  assert.equal(parsePage('0'), 1);
  assert.equal(parsePage('-5'), 1);
});

test('parsePage accepts a valid positive integer string', () => {
  assert.equal(parsePage('3'), 3);
});

test('buildPagination clamps a requested page beyond the last page', () => {
  const result = buildPagination(999, 10, 25); // 3 pages total
  assert.equal(result.page, 3);
  assert.equal(result.pageCount, 3);
  assert.equal(result.hasNext, false);
  assert.equal(result.hasPrev, true);
});

test('buildPagination clamps a requested page below 1', () => {
  const result = buildPagination(-1, 10, 25);
  assert.equal(result.page, 1);
  assert.equal(result.hasPrev, false);
});

test('buildPagination handles zero total rows without dividing by zero / negative page counts', () => {
  const result = buildPagination(1, 10, 0);
  assert.equal(result.pageCount, 1);
  assert.equal(result.page, 1);
  assert.equal(result.hasNext, false);
  assert.equal(result.hasPrev, false);
});

test('buildPagination computes skip correctly for a mid-range page', () => {
  const result = buildPagination(2, 10, 45);
  assert.equal(result.skip, 10);
  assert.equal(result.hasPrev, true);
  assert.equal(result.hasNext, true);
});
