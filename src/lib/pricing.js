// SINGLE SOURCE OF TRUTH for what a course costs right now.
//
// Every surface - landing page, course cards, sticky CTA, purchase card,
// checkout page, Razorpay order creation, free-enroll check and Admin preview -
// must derive prices from getEffectiveCoursePrice() (or getCoursePurchasePrice(),
// which delegates to it) using a freshly-fetched Course row. Never trust an
// amount/price/salePrice posted from the browser and never recompute sale logic
// in a template.
//
// Sale rules (all must hold for the sale price to apply):
//   - salePrice is set, >= 0 and strictly below the regular price
//   - saleEnabled is not false
//   - now is inside [saleStartsAt, saleEndsAt] (either bound may be empty)
// When a sale window expires the effective price automatically reverts to the
// regular price - nothing needs to be edited.
//
// course.price / course.salePrice are Prisma Decimal instances when read through
// Prisma Client - .toFixed(2) keeps this Decimal-safe instead of round-tripping
// the payable amount through a JS float.
const toFixed2 = (v) => (v && typeof v.toFixed === 'function' ? v.toFixed(2) : Number(v).toFixed(2));
const isSet = (v) => v !== null && v !== undefined && v !== '';

function isSaleActive(course, now = new Date()) {
  if (!course || !isSet(course.salePrice)) return false;
  const regular = Number(course.price);
  const sale = Number(course.salePrice);
  if (!Number.isFinite(regular) || !Number.isFinite(sale) || sale < 0 || sale >= regular) return false;
  if (course.saleEnabled === false) return false;
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (course.saleStartsAt && t < new Date(course.saleStartsAt).getTime()) return false;
  if (course.saleEndsAt && t > new Date(course.saleEndsAt).getTime()) return false;
  return true;
}

function currencySymbol(currency) {
  return !currency || currency === 'INR' ? '₹' : `${currency} `;
}

function formatAmount(currency, value) {
  return `${currencySymbol(currency)}${Number(value).toLocaleString('en-IN')}`;
}

/**
 * @returns {{
 *   currency: string, regular: number, effective: number,
 *   regularString: string, effectiveString: string,
 *   regularLabel: string, effectiveLabel: string,
 *   isFree: boolean, onSale: boolean, discountPercent: number,
 *   badgeLabel: string, saleEndsAt: Date|null
 * }}
 */
function getEffectiveCoursePrice(course, now = new Date()) {
  const currency = (course && course.currency) || 'INR';
  const regular = Number(course && course.price) || 0;
  const onSale = isSaleActive(course, now);
  const chosen = onSale ? course.salePrice : (course && course.price) || 0;
  const effective = Number(chosen) || 0;
  const regularString = toFixed2((course && course.price) || 0);
  const effectiveString = toFixed2(chosen);
  const discountPercent = onSale && regular > 0 ? Math.max(1, Math.round(((regular - effective) / regular) * 100)) : 0;
  const customBadge = onSale && course.saleBadgeLabel ? String(course.saleBadgeLabel).trim() : '';
  return {
    currency,
    regular,
    effective,
    regularString,
    effectiveString,
    regularLabel: formatAmount(currency, regular),
    effectiveLabel: formatAmount(currency, effective),
    isFree: effective === 0,
    onSale,
    discountPercent,
    badgeLabel: onSale ? (customBadge || `${discountPercent}% OFF`) : '',
    saleEndsAt: onSale && course.saleEndsAt ? new Date(course.saleEndsAt) : null,
  };
}

// Back-compat: the payable amount as a "7999.00" string.
function getCoursePurchasePrice(course, now = new Date()) {
  return getEffectiveCoursePrice(course, now).effectiveString;
}

module.exports = { getEffectiveCoursePrice, getCoursePurchasePrice, isSaleActive, formatAmount };
