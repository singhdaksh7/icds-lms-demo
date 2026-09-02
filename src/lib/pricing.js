// Canonical, server-authoritative purchase price for a course. Never trust
// an amount/price/salePrice posted from the browser — every checkout path
// (checkout page render, order creation, free-enroll) must derive the
// payable amount by calling this with a freshly-fetched Course row.
//
// course.price / course.salePrice are Prisma Decimal instances (decimal.js)
// when read through Prisma Client — .toFixed(2) keeps this Decimal-safe
// instead of round-tripping through a JS float.
function getCoursePurchasePrice(course) {
  const price = course.price;
  const salePrice = course.salePrice;

  const hasValidSale =
    salePrice !== null &&
    salePrice !== undefined &&
    Number(salePrice) >= 0 &&
    Number(salePrice) < Number(price);

  const chosen = hasValidSale ? salePrice : price;
  return typeof chosen.toFixed === 'function' ? chosen.toFixed(2) : Number(chosen).toFixed(2);
}

module.exports = { getCoursePurchasePrice };
