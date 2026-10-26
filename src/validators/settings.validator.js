const { SAFE_CTA_TARGETS, TABS, FIELD_BY_KEY } = require('../config/siteContent');

// Registry-driven validation for Admin > Site Content. Every field is
// length-capped and coerced to a safe type. Nothing here ever accepts HTML,
// script or a free-form URL: link targets come from a fixed list and all
// values are escaped again when rendered.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9+()\-.\s]*$/;

// Anything that looks like an HTML tag/comment, or a script-ish URL scheme.
// Admin copy is plain text, so rejecting these outright is safer than trying
// to "clean" them.
const TAG_PATTERN = /<\/?[a-z!][^>]*>?/i;
const UNSAFE_SCHEME_PATTERN = /(?:javascript|vbscript)\s*:|data\s*:\s*text\/html/i;

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function clean(raw, { multiline, max }) {
  const value = typeof raw === 'string' ? raw : '';
  let out = value.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '');
  if (!multiline) out = out.replace(/\s*\n\s*/g, ' ');
  return out.trim().slice(0, max);
}

function isRealIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function unsafeContent(value) {
  return TAG_PATTERN.test(value) || UNSAFE_SCHEME_PATTERN.test(value);
}

// Validates the submitted fields of ONE form definition. Fields not in the
// form are ignored entirely (a form can never write another form's keys).
// Image fields are not handled here - uploads go through the multer
// middleware and the controller.
function validateForm(form, body = {}) {
  const errors = [];
  const values = {};

  for (const field of form.fields) {
    if (field.heading || field.type === 'image') continue;
    const raw = body[field.key];
    const name = field.label;

    if (field.type === 'bool') {
      values[field.key] = raw === 'true' || raw === 'on' || raw === true ? 'true' : 'false';
      continue;
    }

    if (field.type === 'target') {
      const chosen = typeof raw === 'string' ? raw.trim() : '';
      if (chosen && !SAFE_CTA_TARGETS.includes(chosen)) {
        errors.push(`${name} must be one of the predefined page links.`);
        values[field.key] = field.def;
      } else {
        values[field.key] = chosen || field.def;
      }
      continue;
    }

    const multiline = field.type === 'textarea' || field.type === 'longtext';
    const max = field.max || (field.type === 'url' ? 300 : field.type === 'email' ? 254 : field.type === 'phone' ? 30 : field.type === 'date' ? 10 : 150);
    const value = clean(raw, { multiline, max });
    values[field.key] = value;

    if (!value) continue;

    if (field.type === 'email' && !EMAIL_PATTERN.test(value)) {
      errors.push(`${name} must be a valid email address.`);
    } else if (field.type === 'phone' && (!PHONE_PATTERN.test(value) || value.length < 5)) {
      errors.push(`${name} may contain only digits, spaces and + ( ) - . (at least 5 characters).`);
    } else if (field.type === 'url' && !/^https:\/\/[^\s"'<>]+$/i.test(value)) {
      errors.push(`${name} must be a full https:// link.`);
    } else if (field.type === 'date' && !isRealIsoDate(value)) {
      errors.push(`${name} must be a valid date (YYYY-MM-DD).`);
    } else if (unsafeContent(value)) {
      errors.push(`${name}: HTML tags and script links are not allowed - use plain text only.`);
    }
  }

  return { errors, values };
}

// Compatibility wrapper: validates every known field present in `body`
// (absent text fields become blank = default, absent toggles become off).
function validateSettings(body = {}) {
  const errors = [];
  const values = {};
  for (const tab of TABS) {
    for (const form of tab.forms) {
      const result = validateForm(form, body);
      errors.push(...result.errors);
      Object.assign(values, result.values);
    }
  }
  return { errors, values };
}

module.exports = { validateForm, validateSettings, SAFE_CTA_TARGETS, FIELD_BY_KEY };
