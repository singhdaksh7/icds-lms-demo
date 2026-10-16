// Invoice / receipt PDF generation (pdf-lib, already used for certificates).
// Layout details — title, accent colour, number prefix, seller name / GSTIN /
// address, terms, signatory — come from the admin Tax & Invoice settings.
// Pure function: takes an order (with user + items.course) and settings, so
// it is easy to test and has no I/O.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// Standard PDF fonts only encode WinAnsi; anything else (e.g. the rupee
// sign) would throw, so map the common ones and replace the rest.
function pdfSafe(value) {
  return String(value == null ? '' : value)
    .replace(/₹/g, 'Rs. ')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\r\t]/g, ' ')
    .replace(/[^\n\x20-\x7e\xa0-\xff]/g, '?');
}

function money(amount, currency) {
  const n = Number(amount);
  const formatted = n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency === 'INR' || !currency ? 'Rs. ' : `${currency} `}${formatted}`;
}

function invoiceNumber(order, settings) {
  return `${settings.invoicePrefix || ''}${String(order.id).padStart(6, '0')}`;
}

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  const v = m ? parseInt(m[1], 16) : 0x565acf;
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

function wrapText(text, font, size, maxWidth) {
  const lines = [];
  for (const para of pdfSafe(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines;
}

async function buildInvoicePdf({ order, settings, siteName }) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const accent = hexToRgb(settings.accent);
  const ink = rgb(0.08, 0.09, 0.17);
  const muted = rgb(0.4, 0.42, 0.5);
  const white = rgb(1, 1, 1);
  const { width, height } = page.getSize();
  const M = 48;

  const text = (t, x, y, { size = 10, font = regular, color = ink } = {}) =>
    page.drawText(pdfSafe(t), { x, y, size, font, color });
  const right = (t, xRight, y, opts = {}) => {
    const font = opts.font || regular;
    const size = opts.size || 10;
    text(t, xRight - font.widthOfTextAtSize(pdfSafe(t), size), y, opts);
  };

  const seller = settings.legalName || siteName || 'Invoice';
  const paidOn = order.paidAt || order.updatedAt || order.createdAt;
  const dateText = new Date(paidOn).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  // Header band
  page.drawRectangle({ x: 0, y: height - 110, width, height: 110, color: accent });
  text(seller, M, height - 52, { size: 20, font: bold, color: white });
  text(settings.invoiceTitle || 'INVOICE', M, height - 78, { size: 11, font: bold, color: white });
  right(`Invoice No: ${invoiceNumber(order, settings)}`, width - M, height - 52, { size: 11, font: bold, color: white });
  right(`Date: ${dateText}`, width - M, height - 70, { size: 10, color: white });
  right(`Order: ICDS-${order.id}`, width - M, height - 86, { size: 10, color: white });

  let y = height - 148;

  // Seller + buyer blocks
  text('FROM', M, y, { size: 8, font: bold, color: muted });
  text('BILLED TO', width / 2 + 10, y, { size: 8, font: bold, color: muted });
  let ly = y - 16;
  text(seller, M, ly, { font: bold });
  ly -= 14;
  for (const l of wrapText(settings.address || '', regular, 9, width / 2 - M - 20)) {
    if (l) {
      text(l, M, ly, { size: 9, color: muted });
      ly -= 12;
    }
  }
  if (settings.gstin) {
    text(`GSTIN: ${settings.gstin}`, M, ly, { size: 9, font: bold });
    ly -= 12;
  }
  let ry = y - 16;
  text(order.user.name, width / 2 + 10, ry, { font: bold });
  ry -= 14;
  text(order.user.email, width / 2 + 10, ry, { size: 9, color: muted });
  y = Math.min(ly, ry) - 28;

  // Line items table
  page.drawRectangle({ x: M, y: y - 6, width: width - 2 * M, height: 24, color: rgb(0.95, 0.95, 0.98) });
  text('Description', M + 10, y + 2, { size: 9, font: bold });
  right('Amount', width - M - 10, y + 2, { size: 9, font: bold });
  y -= 28;

  for (const item of order.items) {
    const lines = wrapText(item.course.title, regular, 10, width - 2 * M - 140);
    right(money(item.price, order.currency), width - M - 10, y);
    for (const l of lines) {
      text(l, M + 10, y);
      y -= 13;
    }
    y -= 6;
  }

  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 0.6, color: rgb(0.88, 0.88, 0.93) });
  y -= 20;

  const tax = Number(order.taxAmount) || 0;
  const subtotal = order.subtotalAmount != null ? order.subtotalAmount : order.amount;
  if (tax > 0) {
    const rows = [
      ['Subtotal', money(subtotal, order.currency)],
      [`GST @ ${Number(order.taxRate)}%${order.taxInclusive ? ' (included)' : ''}`, money(order.taxAmount, order.currency)],
    ];
    for (const [label, value] of rows) {
      text(label, width - M - 230, y, { size: 10, color: muted });
      right(value, width - M - 10, y);
      y -= 16;
    }
  }
  page.drawRectangle({ x: width - M - 240, y: y - 8, width: 240, height: 28, color: accent });
  text('Total paid', width - M - 230, y + 2, { size: 11, font: bold, color: white });
  right(money(order.amount, order.currency), width - M - 10, y + 2, { size: 11, font: bold, color: white });
  y -= 44;

  // Payment info
  text('PAYMENT', M, y, { size: 8, font: bold, color: muted });
  y -= 14;
  text(`Status: ${order.status === 'REFUNDED' ? 'Refunded' : 'Paid'}  |  Method: Razorpay (online)`, M, y, { size: 9 });
  y -= 13;
  if (order.providerPaymentId) {
    text(`Payment reference: ${order.providerPaymentId}`, M, y, { size: 9 });
    y -= 13;
  }
  y -= 14;

  for (const [label, body] of [['TERMS', settings.terms], ['NOTE', settings.note]]) {
    if (!body) continue;
    text(label, M, y, { size: 8, font: bold, color: muted });
    y -= 13;
    for (const l of wrapText(body, regular, 9, width - 2 * M)) {
      text(l, M, y, { size: 9, color: muted });
      y -= 12;
    }
    y -= 8;
  }

  if (settings.signatory) {
    page.drawLine({ start: { x: width - M - 160, y: 110 }, end: { x: width - M, y: 110 }, thickness: 0.6, color: muted });
    right(`For ${seller}`, width - M, 124, { size: 9, color: muted });
    right(settings.signatory, width - M, 96, { size: 9, font: bold });
  }
  text('This is a computer-generated invoice.', M, 40, { size: 8, color: muted });

  return pdf.save();
}

module.exports = { buildInvoicePdf, invoiceNumber, pdfSafe };
