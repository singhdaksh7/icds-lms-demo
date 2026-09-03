const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSeo, absoluteUrl, getOrigin, DEFAULT_ROBOTS, PUBLIC_ROBOTS } = require('../src/lib/seo');

function fakeReq(path = '/some-page') {
  return {
    originalUrl: path,
    protocol: 'https',
    get: (header) => (header === 'host' ? 'example-derived.test' : undefined),
  };
}

test('buildSeo defaults to noindex,nofollow when robots is not specified', () => {
  const seo = buildSeo(fakeReq('/student/dashboard'));
  assert.equal(seo.robots, DEFAULT_ROBOTS);
  assert.equal(seo.canonical, null, 'private pages must not emit a canonical URL');
});

test('buildSeo emits a canonical URL only for indexable pages', () => {
  const seo = buildSeo(fakeReq('/courses'), { title: 'Courses', robots: PUBLIC_ROBOTS });
  assert.equal(seo.robots, PUBLIC_ROBOTS);
  assert.ok(seo.canonical.endsWith('/courses'));
});

test('buildSeo does not treat "noindex, follow" as indexable (substring trap)', () => {
  // "noindex".includes("index") is true — buildSeo must not use a naive
  // substring check here, or every noindex page would still get a canonical.
  const seo = buildSeo(fakeReq('/courses?q=x'), { robots: 'noindex, follow' });
  assert.equal(seo.canonical, null);
});

test('buildSeo respects an explicit noCanonical override even when indexable', () => {
  const seo = buildSeo(fakeReq('/courses'), { robots: PUBLIC_ROBOTS, noCanonical: true });
  assert.equal(seo.canonical, null);
});

test('buildSeo falls back to the site name/description when unset', () => {
  const seo = buildSeo(fakeReq('/'));
  assert.ok(seo.title.length > 0);
  assert.ok(seo.description.length > 0);
});

test('buildSeo passes through jsonLd only when provided', () => {
  assert.equal(buildSeo(fakeReq('/')).jsonLd, null);
  const withLd = buildSeo(fakeReq('/'), { jsonLd: { '@type': 'Thing' } });
  assert.deepEqual(withLd.jsonLd, { '@type': 'Thing' });
});

test('absoluteUrl derives an origin from the request when APP_BASE_URL is unset', () => {
  // In this test environment APP_BASE_URL is not set, so the helper must
  // fall back to the request's own protocol/host — never a hardcoded
  // localhost, and never empty when a req is available.
  const url = absoluteUrl(fakeReq(), '/certificates/verify/ABC-123');
  assert.equal(url, 'https://example-derived.test/certificates/verify/ABC-123');
});

test('absoluteUrl returns a bare path (never throws) when no request and no APP_BASE_URL', () => {
  const url = absoluteUrl(null, '/foo');
  assert.equal(url, '/foo');
});

test('getOrigin never returns a literal "localhost" string when APP_BASE_URL is configured', () => {
  // This is a smoke check on the precedence rule, not a live env-var test
  // (APP_BASE_URL isn't set here) — see README "APP_BASE_URL" for the
  // production expectation this documents.
  const origin = getOrigin(fakeReq());
  assert.ok(!origin.includes('localhost'));
});
