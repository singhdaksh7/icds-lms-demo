const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

// Regression test for the "csrfToken is not defined" 500-page crash: the
// footer's login/signup modals are always rendered (they're not gated behind
// currentUser), so if the failure that triggered the 500 page happened
// before exposeCsrfToken ran (e.g. a session/DB error), csrfToken is never
// set on res.locals and the shared footer partial must not throw.
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
    ...locals,
  });
}

test('500 page renders without csrfToken (session/DB failed before the CSRF middleware ran)', async () => {
  const html = await renderErrorPage({});
  assert.match(html, /Something Went Wrong/);
  // The login/signup forms must silently drop the hidden CSRF field rather
  // than emit `value="undefined"` or throw a ReferenceError.
  assert.doesNotMatch(html, /name="_csrf"/);
});

test('500 page still includes a real CSRF token when one is available', async () => {
  const html = await renderErrorPage({ csrfToken: 'test-token-123' });
  const matches = html.match(/name="_csrf" value="test-token-123"/g) || [];
  // Login and signup modal forms both carry the token.
  assert.equal(matches.length, 2);
});
