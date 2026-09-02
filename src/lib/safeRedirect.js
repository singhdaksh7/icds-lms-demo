// Only allow internal, relative redirect targets (returnTo / intended page).
// Rejects absolute URLs (https://evil-site.com) and protocol-relative ones
// (//evil-site.com) to prevent open-redirect vulnerabilities.
function safeRedirectPath(candidate, fallback = '/') {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return fallback;
  }

  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/\\')) {
    return fallback;
  }

  // Reject anything that looks like it carries a scheme, e.g. "/\evil.com"
  // or encoded variants some browsers still normalize into a host change.
  if (/^\/\s*[\\/]/i.test(candidate) || /^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    return fallback;
  }

  return candidate;
}

module.exports = { safeRedirectPath };
