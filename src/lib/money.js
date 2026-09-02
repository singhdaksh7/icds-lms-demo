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

module.exports = { parseAmount, MAX_AMOUNT };
