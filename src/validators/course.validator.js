const { isSafeMediaUrl } = require('../lib/url');
const { parseAmount } = require('../lib/money');

const LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];
const STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

// Validates + normalizes an admin course create/update submission. Never
// trusts client-provided currency/status blindly — both are whitelisted.
function validateCourse(body) {
  const errors = [];

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length < 3 || title.length > 200) {
    errors.push('Title must be between 3 and 200 characters.');
  }

  const slugInput = typeof body.slug === 'string' ? body.slug.trim() : '';

  const shortDescription =
    typeof body.shortDescription === 'string' ? body.shortDescription.trim().slice(0, 500) : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';

  const thumbnailUrl = typeof body.thumbnailUrl === 'string' ? body.thumbnailUrl.trim() : '';
  if (!isSafeMediaUrl(thumbnailUrl)) {
    errors.push('Thumbnail URL must be a valid http(s) link.');
  }

  const categoryId = body.categoryId ? parseInt(body.categoryId, 10) : null;
  if (body.categoryId && !Number.isInteger(categoryId)) {
    errors.push('Invalid category.');
  }

  const instructorId = body.instructorId ? parseInt(body.instructorId, 10) : null;
  if (body.instructorId && !Number.isInteger(instructorId)) {
    errors.push('Invalid instructor.');
  }

  const isFreeChecked = (Array.isArray(body.isFree) ? body.isFree[body.isFree.length - 1] : body.isFree) === 'on';
  const price = isFreeChecked ? '0' : parseAmount(typeof body.price === 'string' ? body.price.trim() : '');
  if (price === null) {
    errors.push('Price must be a valid amount (0 or more).');
  }

  let salePrice = null;
  const salePriceRaw = !isFreeChecked && typeof body.salePrice === 'string' ? body.salePrice.trim() : '';
  if (salePriceRaw) {
    salePrice = parseAmount(salePriceRaw);
    if (salePrice === null) {
      errors.push('Sale price must be a valid amount (0 or more).');
    } else if (price !== null && Number(salePrice) > Number(price)) {
      errors.push('Sale price cannot be greater than the regular price.');
    } else if (price !== null && Number(price) > 0 && Number(salePrice) === Number(price)) {
      errors.push('Sale price must be lower than the regular price to create a discount (or leave it blank).');
    }
  }

  // Sale window + badge. These fields are only applied when the form submitted
  // them (saleEnabled is always posted by the Admin form: hidden "false" + checkbox).
  let saleFields = {};
  if (body.saleEnabled !== undefined) {
    const enabledRaw = Array.isArray(body.saleEnabled) ? body.saleEnabled[body.saleEnabled.length - 1] : body.saleEnabled;
    const saleEnabled = enabledRaw === 'on' || enabledRaw === 'true' || enabledRaw === true;
    const parseDate = (raw, label) => {
      const v = typeof raw === 'string' ? raw.trim() : '';
      if (!v) return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) { errors.push(`${label} is not a valid date/time.`); return null; }
      return d;
    };
    const saleStartsAt = parseDate(body.saleStartsAt, 'Sale start');
    const saleEndsAt = parseDate(body.saleEndsAt, 'Sale end');
    if (saleStartsAt && saleEndsAt && saleEndsAt <= saleStartsAt) errors.push('Sale end must be after the sale start.');
    const saleBadgeLabel = typeof body.saleBadgeLabel === 'string' ? body.saleBadgeLabel.trim().slice(0, 40) : '';
    saleFields = { saleEnabled, saleStartsAt, saleEndsAt, saleBadgeLabel: saleBadgeLabel || null };
  }

  // GST: blank = use the site default; 0 = exempt; otherwise 0-100.
  let gstRate = null;
  const gstRaw = typeof body.gstRate === 'string' ? body.gstRate.trim() : '';
  if (gstRaw) {
    gstRate = /^\d{1,3}(\.\d{1,2})?$/.test(gstRaw) && Number(gstRaw) <= 100 ? gstRaw : null;
    if (gstRate === null) errors.push('GST rate must be a number between 0 and 100 (or blank for the site default).');
  }

  const level = LEVELS.includes(body.level) ? body.level : null;
  if (!level) {
    errors.push('Please choose a valid course level.');
  }

  const status = STATUSES.includes(body.status) ? body.status : null;
  if (!status) {
    errors.push('Please choose a valid course status.');
  }

  const featured = body.featured === 'on' || body.featured === true;

  const duration = typeof body.duration === 'string' ? body.duration.trim().slice(0, 50) : '';

  return {
    errors,
    values: {
      title,
      slugInput,
      shortDescription,
      description,
      thumbnailUrl,
      categoryId,
      instructorId,
      price,
      salePrice,
      ...saleFields,
      gstRate,
      currency: 'INR', // fixed for now — never accepted from the client
      level,
      status,
      featured,
      duration,
    },
  };
}

module.exports = { validateCourse, LEVELS, STATUSES };
