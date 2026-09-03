const test = require('node:test');
const assert = require('node:assert/strict');
const templates = require('../src/lib/emailTemplates');

test('escapeHtml neutralizes HTML-significant characters', () => {
  assert.equal(templates.escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(templates.escapeHtml(`O'Brien & "Sons"`), 'O&#39;Brien &amp; &quot;Sons&quot;');
});

test('escapeHtml handles null/undefined without throwing', () => {
  assert.equal(templates.escapeHtml(null), '');
  assert.equal(templates.escapeHtml(undefined), '');
});

test('passwordReset embeds the reset URL in both html and text', () => {
  const { subject, html, text } = templates.passwordReset({ resetUrl: 'https://example.com/reset-password/abc123' });
  assert.ok(subject.length > 0);
  assert.ok(html.includes('https://example.com/reset-password/abc123'));
  assert.ok(text.includes('https://example.com/reset-password/abc123'));
});

test('enrollmentApproved escapes a student name containing HTML', () => {
  const { html } = templates.enrollmentApproved({
    studentName: '<b>Hacker</b>',
    courseTitle: 'Intro to XSS',
    myCoursesUrl: 'https://example.com/student/dashboard',
  });
  assert.ok(!html.includes('<b>Hacker</b>'), 'raw HTML from a student name must never appear unescaped');
  assert.ok(html.includes('&lt;b&gt;Hacker&lt;/b&gt;'));
});

test('contactNotification escapes a message body containing HTML', () => {
  const { html, text } = templates.contactNotification({
    name: 'Visitor',
    email: 'visitor@example.com',
    subject: 'Hello',
    message: '<img src=x onerror=alert(1)>',
  });
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(html.includes('&lt;img'));
  // Plain-text part is never HTML-escaped — it's not rendered as markup.
  assert.ok(text.includes('<img src=x onerror=alert(1)>'));
});

test('certificateIssued includes the course title and a certificates link', () => {
  const { subject, html } = templates.certificateIssued({
    studentName: 'Jane',
    courseTitle: 'Advanced Skin Care',
    certificatesUrl: 'https://example.com/student/certificates',
  });
  assert.ok(subject.includes('Advanced Skin Care'));
  assert.ok(html.includes('https://example.com/student/certificates'));
});
