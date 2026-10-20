process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

const VIEWS = path.join(__dirname, '..', 'views');
const card = (course) =>
  ejs.renderFile(path.join(VIEWS, 'partials', 'course-card.ejs'), { course, fill: (s) => s, cms: require('../src/services/settings.service').defaultContent() }, { views: [VIEWS] });

const base = { id: 1, slug: 'c', title: 'T', shortDescription: 'd', level: 'ADVANCED', currency: 'INR', thumbnailUrl: null, duration: null, category: null, instructor: null, reviews: [], _count: { lessons: 3 }, salePrice: null };

test('a price-0 course card shows "Free" instead of the rupee amount', async () => {
  const html = await card({ ...base, price: 0 });
  const price = html.match(/<div class="course-price">([\s\S]*?)<\/div>/)[1];
  assert.match(price, /Free/);
  assert.doesNotMatch(price, /₹/);
});

test('paid course cards are unchanged (rupee price, sale price strike-through)', async () => {
  const paid = (await card({ ...base, price: 1500 })).match(/<div class="course-price">([\s\S]*?)<\/div>/)[1];
  assert.match(paid, /₹1,500/);
  assert.doesNotMatch(paid, /Free/);
  const sale = (await card({ ...base, price: 2000, salePrice: 1500 })).match(/<div class="course-price">([\s\S]*?)<\/div>/)[1];
  assert.match(sale, /₹1,500/);
  assert.match(sale, /<del>₹2,000<\/del>/);
});
