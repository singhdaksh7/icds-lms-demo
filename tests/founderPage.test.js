const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const { resolveSectionOrder, buildFounderViewModel, buildFaqJsonLd } = require('../src/services/founder.service');

test('resolveSectionOrder honours order, hidden, drops junk, appends missing', () => {
  assert.deepEqual(resolveSectionOrder(null, null).length, 9);
  const r = resolveSectionOrder('["FAQ","HERO","BOGUS","FAQ"]', '["CTA","HERO"]');
  assert.equal(r[0], 'FAQ');
  assert.ok(!r.includes('HERO') && !r.includes('CTA') && !r.includes('BOGUS'));
  assert.deepEqual(resolveSectionOrder('not json', '{}').length, 9);
});

test('buildFounderViewModel hides empty sections', () => {
  const vm = buildFounderViewModel({ instructor: { name: 'A', bio: 'One\n\nTwo' }, settings: {} });
  assert.deepEqual(vm.sections, ['HERO', 'BIOGRAPHY', 'CTA']);
  assert.equal(vm.instructor.bioParagraphs.length, 2);
  assert.deepEqual(buildFounderViewModel({}).sections, []);
});

test('faq json-ld only from supplied rows', () => {
  assert.equal(buildFaqJsonLd([]), null);
  assert.equal(buildFaqJsonLd([{ question: 'q', answer: 'a' }]).mainEntity.length, 1);
});

test('founder-content renders', async () => {
  const vm = buildFounderViewModel({
    instructor: { name: 'Dr. X', title: 'Founder', bio: 'p1', qualificationsLine: 'BDS', founderIntro: 'hi', linkedinUrl: 'javascript:x' },
    qualifications: [{ title: 'BDS' }],
    timeline: [{ yearLabel: '2014', title: 'T' }],
    initiatives: [{ title: 'I', description: 'd', ctaLabel: 'Go', ctaUrl: '/courses' }],
    research: [{ kind: 'TEACHING', title: 'Teach' }],
    stats: [{ valueText: '50+', label: 'L' }],
    faqs: [{ question: 'Q', answer: 'A' }],
  });
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'public', 'founder-content.ejs'), { vm });
  for (const s of ['Dr. X', 'Teaching'.length ? 'Clinical Teaching' : '', 'fp-faq-q', '/contact', 'fp-stat']) assert.ok(html.includes(s), s);
  assert.ok(!html.includes('javascript:'));
});
