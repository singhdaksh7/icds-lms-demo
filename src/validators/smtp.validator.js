// Excludes whitespace, quotes, angle brackets, list separators and
// backslashes (header-injection / display-name spoofing vectors).
const EMAIL_RE = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]+$/;
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,253}[A-Za-z0-9])?$/;
const HAS_CTRL = /[\r\n\0]/;

function clean(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validateSmtpSettings(body = {}) {
  const errors = [];
  const values = {
    host: clean(body.host, 255),
    port: Number(clean(body.port, 6)),
    secure: body.secure === '1' || body.secure === 'on' || body.secure === 'true',
    username: clean(body.username, 255),
    password: typeof body.password === 'string' ? body.password.slice(0, 512) : '',
    fromEmail: clean(body.fromEmail, 255),
    fromName: clean(body.fromName, 100),
  };

  if (!values.host || !HOST_RE.test(values.host)) errors.push('Enter a valid SMTP host name (e.g. smtp.gmail.com).');
  if (!Number.isInteger(values.port) || values.port < 1 || values.port > 65535) errors.push('Port must be a number between 1 and 65535.');
  if (!EMAIL_RE.test(values.fromEmail) || HAS_CTRL.test(values.fromEmail)) errors.push('Enter a valid "From" email address.');
  if (HAS_CTRL.test(values.fromName)) errors.push('From name contains invalid characters.');
  if (HAS_CTRL.test(values.username) || HAS_CTRL.test(values.password)) errors.push('Username/password contain invalid characters.');
  return { errors, values };
}

module.exports = { validateSmtpSettings };
