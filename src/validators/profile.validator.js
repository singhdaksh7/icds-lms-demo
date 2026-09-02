function normalize(value) { return typeof value === 'string' ? value.trim() : ''; }
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validateProfile(body = {}) {
  const name = normalize(body.name);
  const email = normalize(body.email).toLowerCase();
  const errors = [];
  if (name.length < 2 || name.length > 120) errors.push('Name must be between 2 and 120 characters.');
  if (!validEmail(email) || email.length > 254) errors.push('Enter a valid email address.');
  return { errors, values: { name, email } };
}
function validatePasswordChange(body = {}) {
  const errors = [];
  if (typeof body.currentPassword !== 'string' || !body.currentPassword) errors.push('Current password is required.');
  if (typeof body.newPassword !== 'string' || body.newPassword.length < 8) errors.push('New password must be at least 8 characters.');
  if (body.newPassword !== body.confirmPassword) errors.push('New password confirmation does not match.');
  return { errors };
}
module.exports = { validateProfile, validatePasswordChange };
