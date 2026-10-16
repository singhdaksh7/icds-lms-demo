process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTax, fromPaise } = require('../src/lib/tax');
const taxSettings = require('../src/services/taxSettings.service');
const { buildInvoicePdf, pdfSafe, invoiceNumber } = require('../src/services/invoice.service');
const { validateCourse } = require('../src/validators/course.validator');

test('GST inclusive: customer pays the listed price, tax is carved out and sums exactly', () => {
  const r = computeTax({ listPrice: '4999.00', rate: 18, inclusive: true });
  assert.equal(r.total, '4999.00');
  assert.equal(r.totalPaise, 499900);
  assert.equal(r.taxPaise + r.subtotalPaise, r.totalPaise);
  assert.equal(r.tax, '762.56');
  assert.equal(r.subtotal, '4236.44');
});

test('GST exclusive: tax is added on top of the listed price', () => {
  const r = computeTax({ listPrice: '4999.00', rate: 18, inclusive: false });
  assert.equal(r.subtotal, '4999.00');
  assert.equal(r.tax, '899.82');
  assert.equal(r.total, '5898.82');
  assert.equal(r.subtotalPaise + r.taxPaise, r.totalPaise);
});

test('zero rate or free price means no tax', () => {
  assert.equal(computeTax({ listPrice: '1000', rate: 0, inclusive: false }).tax, '0.00');
  const free = computeTax({ listPrice: '0.00', rate: 18, inclusive: false });
  assert.equal(free.total, '0.00');
  assert.equal(free.tax, '0.00');
  assert.equal(fromPaise(5), '0.05');
});

test('per-course GST rate overrides the site default; 0 means exempt; GST off means none', () => {
  const on = { enabled: true, rate: 18, inclusive: true };
  assert.equal(taxSettings.rateFor({ gstRate: null }, on), 18);
  assert.equal(taxSettings.rateFor({ gstRate: '5.00' }, on), 5);
  assert.equal(taxSettings.rateFor({ gstRate: '0' }, on), 0);
  assert.equal(taxSettings.rateFor({ gstRate: '5' }, { ...on, enabled: false }), 0);
});

test('tax settings validation: GSTIN format, colour, prefix, legal name required when enabled', () => {
  const good = taxSettings.validate({ enabled: '1', rate: '18', legalName: 'ICDS', gstin: '07ABCDE1234F1Z5', accent: '#112233', invoicePrefix: 'INV-' });
  assert.deepEqual(good.errors, []);
  assert.ok(taxSettings.validate({ rate: '150' }).errors.length);
  assert.ok(taxSettings.validate({ rate: '18', gstin: 'BAD' }).errors.length);
  assert.ok(taxSettings.validate({ rate: '18', accent: 'red' }).errors.length);
  assert.ok(taxSettings.validate({ rate: '18', invoicePrefix: 'a b!' }).errors.length);
  assert.ok(taxSettings.validate({ enabled: '1', rate: '18' }).errors.length);
});

test('course validator: GST rate optional, 0-100 only', () => {
  const base = { title: 'Valid Course', price: '1000', level: 'BEGINNER', status: 'DRAFT' };
  const ok = validateCourse({ ...base, gstRate: '5' });
  assert.ok(!ok.errors.some((e) => /GST/.test(e)));
  assert.equal(ok.values.gstRate, '5');
  assert.equal(validateCourse({ ...base, gstRate: '' }).values.gstRate, null);
  assert.ok(validateCourse({ ...base, gstRate: '120' }).errors.some((e) => /GST/.test(e)));
  assert.ok(validateCourse({ ...base, gstRate: 'abc' }).errors.some((e) => /GST/.test(e)));
});

const order = (over = {}) => ({
  id: 7,
  amount: '4999.00',
  subtotalAmount: '4236.44',
  taxAmount: '762.56',
  taxRate: '18',
  taxInclusive: true,
  currency: 'INR',
  status: 'PAID',
  providerPaymentId: 'pay_ABC123',
  paidAt: new Date('2026-10-16T10:00:00Z'),
  createdAt: new Date(),
  user: { name: 'Stu Dent', email: 's@example.com' },
  items: [{ price: '4236.44', course: { title: 'Advanced Course' } }],
  ...over,
});
const settings = { legalName: 'ICDS Pvt Ltd', gstin: '07ABCDE1234F1Z5', address: '12 Main Road\nNew Delhi', accent: '#565acf', invoiceTitle: 'TAX INVOICE', invoicePrefix: 'INV-', terms: 'No refunds.', note: '', signatory: 'Dr Tanu' };

test('invoice PDF builds a valid PDF, with configurable number prefix', async () => {
  const bytes = await buildInvoicePdf({ order: order(), settings, siteName: 'ICDS' });
  assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length > 1500);
  assert.equal(invoiceNumber(order(), settings), 'INV-000007');
  assert.equal(invoiceNumber(order(), { ...settings, invoicePrefix: 'ICDS/26/' }), 'ICDS/26/000007');
});

test('invoice PDF never throws on hostile or non-Latin text, rupee sign or missing optional settings', async () => {
  const weird = order({ user: { name: 'Zoë हिन्दी <b>x</b> ₹', email: 'z@example.com' }, items: [{ price: '100', course: { title: '— Course “quoted” ₹ ' + 'x'.repeat(300) } }] });
  const bytes = await buildInvoicePdf({ order: weird, settings: { accent: 'nonsense' }, siteName: 'ICDS' });
  assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), '%PDF-');
  const noTax = await buildInvoicePdf({ order: order({ taxAmount: '0', taxRate: '0', subtotalAmount: null }), settings, siteName: 'ICDS' });
  assert.equal(Buffer.from(noTax).subarray(0, 5).toString(), '%PDF-');
  assert.equal(pdfSafe('₹500 – ok'), 'Rs. 500 - ok');
});

// --- download access control -------------------------------------------------
const { prisma } = require('../src/config/db');
const orderService = require('../src/services/order.service');
const invoiceController = require('../src/controllers/invoice.controller');

function call(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      status(c) { this.statusCode = c; return this; },
      set(h) { Object.assign(this.headers, h); return this; },
      send(body) { resolve({ status: this.statusCode, headers: this.headers, body }); },
      render(view) { resolve({ status: this.statusCode, view }); },
    };
    handler(req, res, reject).catch(reject);
  });
}

test('student can download only their own PAID invoice; others and unpaid orders get 404', async () => {
  prisma.siteSetting = { findMany: async () => [] };
  taxSettings.invalidate();
  const rows = [order({ id: 7, userId: 1 }), order({ id: 8, userId: 1, status: 'PENDING' }), order({ id: 9, userId: 2 })];
  orderService.getOrderForUserWithUser = async (id, userId) => rows.find((o) => o.id === id && o.userId === userId) || null;

  const own = await call(invoiceController.studentInvoice, { params: { id: '7' }, currentUser: { id: 1 } });
  assert.equal(own.status, 200);
  assert.equal(own.headers['Content-Type'], 'application/pdf');
  assert.match(own.headers['Content-Disposition'], /attachment; filename="invoice-INV-000007\.pdf"/);
  assert.equal(own.body.subarray(0, 5).toString(), '%PDF-');

  assert.equal((await call(invoiceController.studentInvoice, { params: { id: '9' }, currentUser: { id: 1 } })).status, 404);
  assert.equal((await call(invoiceController.studentInvoice, { params: { id: '8' }, currentUser: { id: 1 } })).status, 404);
  assert.equal((await call(invoiceController.studentInvoice, { params: { id: 'abc' }, currentUser: { id: 1 } })).status, 404);
});

test('admin invoice download works for paid orders and the design preview works with no orders', async () => {
  orderService.getOrderByIdAdmin = async (id) => (id === 7 ? order() : null);
  const ok = await call(invoiceController.adminInvoice, { params: { id: '7' } });
  assert.equal(ok.status, 200);
  assert.equal((await call(invoiceController.adminInvoice, { params: { id: '99' } })).status, 404);
  const preview = await call(invoiceController.adminPreview, { params: {} });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.subarray(0, 5).toString(), '%PDF-');
});

test('REFUNDED orders keep their invoice (marked Refunded); PENDING/FAILED/CANCELLED never get one', async () => {
  const bytesFor = async (status) => {
    orderService.getOrderByIdAdmin = async () => order({ status });
    return call(invoiceController.adminInvoice, { params: { id: '7' } });
  };
  assert.equal((await bytesFor('REFUNDED')).status, 200);
  assert.equal((await bytesFor('PAID')).status, 200);
  for (const s of ['PENDING', 'FAILED', 'CANCELLED']) assert.equal((await bytesFor(s)).status, 404, s);
  const pdf = await buildInvoicePdf({ order: order({ status: 'REFUNDED' }), settings, siteName: 'ICDS' });
  assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), '%PDF-');
});
