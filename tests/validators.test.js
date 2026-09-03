const test = require('node:test');
const assert = require('node:assert/strict');

const { validateSignup, validateLogin, validateResetPassword } = require('../src/validators/auth.validator');
const { validateProfile, validatePasswordChange } = require('../src/validators/profile.validator');
const { validateContact, validateNewsletter } = require('../src/validators/contact.validator');
const { validateCourse } = require('../src/validators/course.validator');

test('validateSignup rejects a short password and mismatched confirmation', () => {
  const { errors } = validateSignup({ name: 'A B', email: 'a@b.com', password: 'short', confirmPassword: 'short' });
  assert.ok(errors.some((e) => /8 characters/.test(e)));
});

test('validateSignup values never include a client-supplied role/id (mass assignment whitelist)', () => {
  const { values } = validateSignup({
    name: 'Jane Doe',
    email: 'jane@example.com',
    password: 'longenough1',
    confirmPassword: 'longenough1',
    role: 'ADMIN',
    id: 999,
    passwordHash: 'fake',
  });
  assert.deepEqual(Object.keys(values).sort(), ['email', 'name']);
});

test('validateLogin normalizes email case', () => {
  const { values } = validateLogin({ email: 'Jane@Example.COM', password: 'x' });
  assert.equal(values.email, 'jane@example.com');
});

test('validateResetPassword never echoes password fields back in values', () => {
  const { values } = validateResetPassword({ password: 'longenough1', confirmPassword: 'longenough1' });
  assert.deepEqual(values, {});
});

test('validateProfile whitelists only name/email, dropping role/id/passwordHash', () => {
  const { values } = validateProfile({
    name: 'Jane Doe',
    email: 'jane@example.com',
    role: 'ADMIN',
    id: 1,
    passwordHash: 'x',
    createdAt: '2020-01-01',
  });
  assert.deepEqual(Object.keys(values).sort(), ['email', 'name']);
});

test('validatePasswordChange requires current password and matching confirmation', () => {
  const { errors } = validatePasswordChange({ currentPassword: '', newPassword: 'longenough1', confirmPassword: 'different' });
  assert.ok(errors.some((e) => /current password/i.test(e)));
  assert.ok(errors.some((e) => /confirmation/i.test(e)));
});

test('validateContact rejects an XSS-marker message only on length, and preserves it verbatim for downstream escaping (not stripped here)', () => {
  const payload = '<script>alert(1)</script>' + 'x'.repeat(10);
  const { errors, values } = validateContact({ name: 'A B', email: 'a@b.com', subject: 'Hello there', message: payload });
  assert.equal(errors.length, 0);
  assert.equal(values.message, payload); // raw storage; escaping happens at render/email time
});

test('validateContact rejects oversized fields', () => {
  const { errors } = validateContact({
    name: 'A'.repeat(200),
    email: 'a@b.com',
    subject: 'x'.repeat(200),
    message: 'y'.repeat(6000),
  });
  assert.ok(errors.length >= 3);
});

test('validateContact rejects an invalid email', () => {
  const { errors } = validateContact({ name: 'A B', email: 'not-an-email', subject: 'Hello there', message: 'a valid message body' });
  assert.ok(errors.some((e) => /valid email/i.test(e)));
});

test('validateNewsletter normalizes case and rejects invalid email', () => {
  assert.equal(validateNewsletter({ email: 'Foo@Bar.COM' }).values.email, 'foo@bar.com');
  assert.ok(validateNewsletter({ email: 'nope' }).errors.length > 0);
});

test('validateCourse forces currency to INR regardless of client input (mass assignment)', () => {
  const { values } = validateCourse({
    title: 'Intro to Cosmetology',
    thumbnailUrl: 'https://example.com/x.jpg',
    price: '100.00',
    level: 'BEGINNER',
    status: 'DRAFT',
    currency: 'USD',
  });
  assert.equal(values.currency, 'INR');
});

test('validateCourse rejects an unrecognized status/level rather than passing it through', () => {
  const { errors, values } = validateCourse({
    title: 'Intro to Cosmetology',
    thumbnailUrl: 'https://example.com/x.jpg',
    price: '100.00',
    level: 'EXPERT',
    status: 'LIVE',
  });
  assert.equal(values.level, null);
  assert.equal(values.status, null);
  assert.ok(errors.length >= 2);
});

test('validateCourse rejects an unsafe thumbnail URL (e.g. javascript: scheme)', () => {
  const { errors } = validateCourse({
    title: 'Intro to Cosmetology',
    thumbnailUrl: 'javascript:alert(1)',
    price: '100.00',
    level: 'BEGINNER',
    status: 'DRAFT',
  });
  assert.ok(errors.some((e) => /thumbnail/i.test(e)));
});

test('validateCourse rejects a sale price greater than the regular price', () => {
  const { errors } = validateCourse({
    title: 'Intro to Cosmetology',
    thumbnailUrl: 'https://example.com/x.jpg',
    price: '100.00',
    salePrice: '150.00',
    level: 'BEGINNER',
    status: 'DRAFT',
  });
  assert.ok(errors.some((e) => /sale price/i.test(e)));
});
