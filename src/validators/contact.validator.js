function clean(value) { return typeof value === 'string' ? value.trim() : ''; }
function emailOk(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validateContact(body = {}) {
  const values = { name: clean(body.name), email: clean(body.email).toLowerCase(), subject: clean(body.subject), message: clean(body.message) };
  const errors = [];
  if (values.name.length < 2 || values.name.length > 120) errors.push('Name must be between 2 and 120 characters.');
  if (!emailOk(values.email) || values.email.length > 254) errors.push('Enter a valid email address.');
  if (values.subject.length < 3 || values.subject.length > 180) errors.push('Subject must be between 3 and 180 characters.');
  if (values.message.length < 10 || values.message.length > 5000) errors.push('Message must be between 10 and 5,000 characters.');
  return { errors, values };
}
function validateNewsletter(body = {}) { const email = clean(body.email).toLowerCase(); return { errors: emailOk(email) ? [] : ['Enter a valid email address.'], values: { email } }; }
module.exports = { validateContact, validateNewsletter };
