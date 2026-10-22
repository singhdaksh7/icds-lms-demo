const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const ejs = require('ejs');
const banner = require('../src/services/homeBanner.service');
const founder = require('../src/services/founderAdmin.service');

test('validateBannerInput accepts a valid banner and rejects unsafe urls', () => {
  const ok = banner.validateBannerInput({ imageUrl: '/uploads/thumbnails/a.jpg', ctaLabel: 'Go', ctaUrl: '/courses', overlayEnabled: 'true' });
  assert.deepStrictEqual(ok.errors, []);
  assert.strictEqual(ok.values.overlayEnabled, true);
  for (const bad of ['javascript:alert(1)', '//evil.com', 'data:text/html,x', 'ftp://x.com/a']) {
    assert.ok(banner.validateBannerInput({ imageUrl: '/a.jpg', ctaLabel: 'x', ctaUrl: bad }).errors.length, bad);
  }
  assert.ok(banner.validateBannerInput({}).errors.length);
  assert.ok(banner.validateBannerInput({ imageUrl: '/a.jpg', startAt: '2026-02-02', endAt: '2026-01-01' }).errors.length);
  assert.ok(banner.validateBannerInput({ imageUrl: '/a.jpg', title: 'x'.repeat(256) }).errors.length);
});

test('founder validators', () => {
  assert.ok(founder.validateFaqInput({ question: 'q' }).errors.length);
  assert.deepStrictEqual(founder.validateFaqInput({ question: 'q', answer: 'a' }).errors, []);
  assert.ok(founder.validateResearchInput({ title: 't', kind: 'BAD' }).errors.length);
  assert.ok(founder.validateInitiativeInput({ title: 't', description: 'd', ctaUrl: 'javascript:x', ctaLabel: 'a' }).errors.length);
  assert.ok(founder.validateStatInput({ valueText: '5+' }).errors.length);
  assert.ok(founder.validateTimelineInput({ yearLabel: '2020' }).errors.length);
  assert.ok(founder.validateQualificationInput({ title: '' }).errors.length);
});

const base = { csrfToken: 't', currentUser: { name: 'A' }, site: {}, flash: {} };
const render = (view, data) => ejs.renderFile(path.join(__dirname, '..', 'views', view), { ...base, metaDescription: '', ...data });

test('admin views render', async () => {
  const b = { id: 1, title: '<script>x</script>', imageUrl: '/a.jpg', isActive: true, overlayEnabled: true, startAt: null, endAt: null };
  let html = await render('admin/homepage/banners.ejs', { pageTitle: 'x', banners: [b], now: new Date() });
  assert.ok(!html.includes('<script>x</script>'));
  await render('admin/homepage/banner-form.ejs', { pageTitle: 'x', banner: b, values: b, errors: ['e'] });
  await render('admin/homepage/banner-form.ejs', { pageTitle: 'x', banner: null, values: {}, errors: [] });
  html = await render('admin/homepage/reviews.ejs', {
    pageTitle: 'x', settings: { enabled: true, heading: 'H', subheading: '', sourceMode: 'FEATURED' },
    genuine: [{ id: 1, reviewerName: 'R', rating: 5, quote: 'q', featuredOnHome: true, course: { title: 'C' } }],
    demo: [{ id: 2, reviewerName: 'D', course: { title: 'C' } }],
  });
  assert.ok(html.includes('DEMO REVIEW'));
  const data = { founder: { id: 1, name: 'F' }, qualifications: [{ id: 1, title: 'T', isPublished: true }], timeline: [], initiatives: [], research: [], stats: [], faqs: [] };
  html = await render('admin/founder/index.ejs', {
    pageTitle: 'x', data, instructors: [{ id: 1, name: 'F', isFounder: true }],
    sections: { order: founder.SECTION_KEYS, hidden: ['FAQ'] }, researchKinds: founder.RESEARCH_KINDS,
  });
  assert.ok(html.includes('Founder profile'));
});
