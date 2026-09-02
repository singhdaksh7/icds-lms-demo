// Server-side validation for auth forms. Never trust HTML `required`/`type`
// attributes alone. Each function returns { errors, values } where `errors`
// is an array of human-readable messages and `values` are the non-sensitive
// fields worth re-populating on the form after a failed submission.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function validateSignup(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

  const errors = [];

  if (name.length < 2 || name.length > 100) {
    errors.push('Please enter your full name (2-100 characters).');
  }

  if (!EMAIL_RE.test(email)) {
    errors.push('Please enter a valid email address.');
  }

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long.');
  }

  if (password !== confirmPassword) {
    errors.push('Passwords do not match.');
  }

  // Password fields are never re-populated after a failed submission.
  return { errors, values: { name, email } };
}

function validateLogin(body) {
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  const errors = [];

  if (!EMAIL_RE.test(email)) {
    errors.push('Please enter a valid email address.');
  }

  if (!password) {
    errors.push('Please enter your password.');
  }

  return { errors, values: { email } };
}

function validateForgotPassword(body) {
  const email = normalizeEmail(body.email);
  const errors = [];

  if (!EMAIL_RE.test(email)) {
    errors.push('Please enter a valid email address.');
  }

  return { errors, values: { email } };
}

function validateResetPassword(body) {
  const password = typeof body.password === 'string' ? body.password : '';
  const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

  const errors = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long.');
  }

  if (password !== confirmPassword) {
    errors.push('Passwords do not match.');
  }

  return { errors, values: {} };
}

module.exports = {
  normalizeEmail,
  validateSignup,
  validateLogin,
  validateForgotPassword,
  validateResetPassword,
};
