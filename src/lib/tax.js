// GST arithmetic in integer paise — never floats on money.
//
// `inclusive`: the course's listed price already contains GST, so the
//   customer pays exactly the listed price and tax is carved out of it.
// exclusive:   GST is added on top of the listed price.
//
// Returns paise integers plus 2-decimal strings for storing/rendering.
const { toPaise } = require('./money');

function fromPaise(paise) {
  const n = Math.round(Number(paise));
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// listPrice: "4999.00"-style string (what getCoursePurchasePrice returns).
// rate: percent, e.g. 18 or "5.5".
function computeTax({ listPrice, rate, inclusive }) {
  const listPaise = toPaise(listPrice);
  const bps = Math.round(Number(rate) * 100); // basis points; 18% -> 1800
  if (!Number.isFinite(bps) || bps <= 0 || listPaise <= 0) {
    return build(listPaise, 0, listPaise, 0, Boolean(inclusive));
  }
  if (inclusive) {
    const tax = Math.round((listPaise * bps) / (10000 + bps));
    return build(listPaise - tax, tax, listPaise, bps / 100, true);
  }
  const tax = Math.round((listPaise * bps) / 10000);
  return build(listPaise, tax, listPaise + tax, bps / 100, false);
}

function build(subtotalPaise, taxPaise, totalPaise, rate, inclusive) {
  return {
    subtotalPaise,
    taxPaise,
    totalPaise,
    rate,
    inclusive,
    subtotal: fromPaise(subtotalPaise),
    tax: fromPaise(taxPaise),
    total: fromPaise(totalPaise),
  };
}

module.exports = { computeTax, fromPaise };
