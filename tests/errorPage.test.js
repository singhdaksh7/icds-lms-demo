const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const { defaultContent } = require('../src/services/settings.service');

// Regression test for the "csrfToken is not defined" 500-page crash: if the
// failure that triggered the 500 page happened before exposeCsrfToken ran
// (e.g. a session/DB error), csrfToken is never set on res.locals and the
// shared header/footer partials must not throw.
const site = {
  name: 'Institute of Cosmetology & Dental Sciences',
  copyrightName: 'Institute of Cosmetology & Dental Sciences',
  supportEmail: 'support@example.com',
  contactEmail: 'info@example.com',
  contactPhone: '',
  whatsappNumber: '',
  address: '',
  baseUrl: 'https://example.test',
  social: { facebook: '', instagram: '', youtube: '', linkedin: '' },
  gaMeasurementId: '',
  googleSiteVerification: '',
  phoneHref: '',
  whatsappHref: '',
  hasSocialLinks: false,
};

const viewPath = path.join(__dirname, '..', 'views', 'public', '500.ejs');

function renderErrorPage(locals) {
  return ejs.renderFile(viewPath, {
    pageTitle: 'Something Went Wrong',
    metaDescription: 'An error occurred.',
    message: 'Something went wrong. Please try again.',
    site,
    cms: defaultContent(),
    ...locals,
  });
}

test('500 page renders without csrfToken (session/DB failed before the CSRF middleware ran)', async () => {
  const html = await renderErrorPage({ currentUser: { name: 'A', role: 'STUDENT' } });
  assert.match(html, /Something Went Wrong/);
  // The logout form must silently drop the hidden CSRF field rather than
  // emit `value="undefined"` or throw a ReferenceError.
  assert.doesNotMatch(html, /name="_csrf"/);
});

test('500 page still includes a real CSRF token when one is available', async () => {
  const html = await renderErrorPage({ csrfToken: 'test-token-123', currentUser: { name: 'A', role: 'STUDENT' } });
  const matches = html.match(/name="_csrf" value="test-token-123"/g) || [];
  assert.equal(matches.length, 1);
});
