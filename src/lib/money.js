// Decimal-safe money validation. Course price/salePrice are Prisma Decimal
// columns (Decimal(10,2)) — we validate the raw string with a regex and
// pass the string straight through to Prisma, never round-tripping through
// a JS float, so precision is never lost.
const DECIMAL_RE = /^\d{1,8}(\.\d{1,2})?$/;
const MAX_AMOUNT = 1000000; // sane ceiling for a single course price, in INR

// Returns a normalized amount string, or null if invalid.
function parseAmount(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!DECIMAL_RE.test(trimmed)) {
    return null;
  }
  const numeric = Number(trimmed);
  if (numeric < 0 || numeric > MAX_AMOUNT) {
    return null;
  }
  return trimmed;
}

// Converts a decimal amount string (e.g. "2499.00", "2499", "2499.5") into
// integer paise for Razorpay, via string manipulation only — never
// `price * 100` on a JS float, which can produce off-by-one paise on values
// that aren't exactly representable in binary floating point.
function toPaise(amountString) {
  const [wholePartRaw, fractionPartRaw = ''] = String(amountString).trim().split('.');
  const wholePart = wholePartRaw || '0';
  const fractionPart = (fractionPartRaw + '00').slice(0, 2);
  return parseInt(`${wholePart}${fractionPart}`, 10);
}

module.exports = { parseAmount, MAX_AMOUNT, toPaise };
