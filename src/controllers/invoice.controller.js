// Invoice PDF downloads. Students can only download invoices for their own
// orders; admins can download any. Only orders whose payment was confirmed
// (PAID, or REFUNDED which keeps its invoice) have an invoice.
const orderService = require('../services/order.service');
const taxSettings = require('../services/taxSettings.service');
const site = require('../config/site');
const { buildInvoicePdf, invoiceNumber } = require('../services/invoice.service');

const INVOICEABLE = ['PAID', 'REFUNDED'];

async function sendInvoice(res, order) {
  const settings = await taxSettings.get();
  const pdf = await buildInvoicePdf({ order, settings, siteName: site.name });
  const filename = `invoice-${invoiceNumber(order, settings)}.pdf`.replace(/[^a-z0-9.-]/gi, '-');
  res
    .status(200)
    .set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    })
    .send(Buffer.from(pdf));
}

function notFound(res) {
  return res.status(404).render('public/404', { pageTitle: 'Invoice Not Found' });
}

async function studentInvoice(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return notFound(res);
    const order = await orderService.getOrderForUserWithUser(id, req.currentUser.id);
    if (!order || !INVOICEABLE.includes(order.status)) return notFound(res);
    await sendInvoice(res, order);
  } catch (err) {
    next(err);
  }
}

async function adminInvoice(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return notFound(res);
    const order = await orderService.getOrderByIdAdmin(id);
    if (!order || !INVOICEABLE.includes(order.status)) return notFound(res);
    await sendInvoice(res, order);
  } catch (err) {
    next(err);
  }
}

// Sample invoice so an admin can preview the design before any real sale.
async function adminPreview(req, res, next) {
  try {
    const now = new Date();
    const sample = {
      id: 1,
      amount: '4999.00',
      subtotalAmount: '4236.44',
      taxAmount: '762.56',
      taxRate: '18',
      taxInclusive: true,
      currency: 'INR',
      status: 'PAID',
      providerPaymentId: 'pay_SAMPLE000000',
      paidAt: now,
      createdAt: now,
      user: { name: 'Sample Student', email: 'student@example.com' },
      items: [{ price: '4236.44', course: { title: 'Sample Course Title' } }],
    };
    await sendInvoice(res, sample);
  } catch (err) {
    next(err);
  }
}

module.exports = { studentInvoice, adminInvoice, adminPreview };
