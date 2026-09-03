const test = require('node:test');
const assert = require('node:assert/strict');
const mailer = require('../src/lib/mailer');

// This test environment has no SMTP_HOST set (see .env.example — SMTP is
// optional), so mailer.js must be using its jsonTransport fallback: no
// network call is made, and sendMail must resolve (never throw/hang) with
// a result that clearly says nothing was actually sent.

test('isConfigured() is false without SMTP env vars', () => {
  assert.equal(mailer.isConfigured(), false);
});

test('sendMail resolves without throwing when SMTP is not configured', async () => {
  const result = await mailer.sendMail({
    to: 'someone@example.com',
    subject: 'Test subject',
    html: '<p>hi</p>',
    text: 'hi',
  });
  assert.equal(result.sent, false);
  assert.equal(result.configured, false);
});

test('sendMail never rejects even with an unusual "to" address', async () => {
  // jsonTransport just serializes the message; this asserts the app-level
  // wrapper doesn't add validation that could throw on real-world input.
  await assert.doesNotReject(() =>
    mailer.sendMail({ to: 'a+tag@example.co.in', subject: 'x', html: '<p>x</p>', text: 'x' })
  );
});
