const STATUSES = ['ACTIVE', 'INACTIVE'];

function validateCategory(body) {
  const errors = [];

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 2 || name.length > 100) {
    errors.push('Category name must be between 2 and 100 characters.');
  }

  const slugInput = typeof body.slug === 'string' ? body.slug.trim() : '';
  const description =
    typeof body.description === 'string' ? body.description.trim().slice(0, 500) : '';

  const status = STATUSES.includes(body.status) ? body.status : 'ACTIVE';

  return { errors, values: { name, slugInput, description, status } };
}

module.exports = { validateCategory, STATUSES };
