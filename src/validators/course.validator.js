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

  const price = parseAmount(typeof body.price === 'string' ? body.price.trim() : '');
  if (price === null) {
    errors.push('Price must be a valid amount (0 or more).');
  }

  let salePrice = null;
  const salePriceRaw = typeof body.salePrice === 'string' ? body.salePrice.trim() : '';
  if (salePriceRaw) {
    salePrice = parseAmount(salePriceRaw);
    if (salePrice === null) {
      errors.push('Sale price must be a valid amount (0 or more).');
    } else if (price !== null && Number(salePrice) > Number(price)) {
      errors.push('Sale price cannot be greater than the regular price.');
    }
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
      currency: 'INR', // fixed for now — never accepted from the client
      level,
      status,
      featured,
      duration,
    },
  };
}

module.exports = { validateCourse, LEVELS, STATUSES };
