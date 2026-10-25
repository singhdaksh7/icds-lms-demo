// Safe link destinations for admin-managed navigation / CTA buttons.
// Accepted: an internal path ("/about", "/courses?category=x", "/#faq") or an
// absolute https:// URL. Everything else (javascript:, data:, vbscript:,
// protocol-relative "//host", bare words, control characters) is rejected.
const MAX_LENGTH = 300;

// Returns { ok: true, value, external } or { ok: false, error }.
function validateLinkUrl(raw, { allowEmpty = false } = {}) {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return allowEmpty ? { ok: true, value: '', external: false } : { ok: false, error: 'A link URL is required.' };
  if (v.length > MAX_LENGTH) return { ok: false, error: `Link URL must be ${MAX_LENGTH} characters or fewer.` };
  if (/[\u0000-\u001f\u007f\s"'<>\\`]/.test(v)) return { ok: false, error: 'Link URL contains characters that are not allowed.' };
  if (v.startsWith('//')) return { ok: false, error: 'Protocol-relative URLs are not allowed. Use /path or https://.' };
  if (v.startsWith('/')) return { ok: true, value: v, external: false };
  if (/^https:\/\/[^/?#]+/i.test(v)) {
    try {
      const u = new URL(v);
      if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) throw new Error('bad');
      return { ok: true, value: v, external: true };
    } catch (_e) {
      return { ok: false, error: 'Enter a valid https:// URL.' };
    }
  }
  return { ok: false, error: 'Link must be an internal path starting with / or a full https:// URL.' };
}

// Path portion used to match a nav URL to a managed page ("/faq?x" -> "/faq").
function normalizePath(url) {
  const v = String(url || '').trim();
  if (!v.startsWith('/')) return '';
  const p = v.split(/[?#]/)[0].replace(/\/+$/, '');
  return p === '' ? '/' : p.toLowerCase();
}

module.exports = { validateLinkUrl, normalizePath, MAX_LENGTH };
