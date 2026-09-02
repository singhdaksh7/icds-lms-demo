// Validates external media URLs (course thumbnails, instructor photos,
// lesson videos) before they're persisted. Only http(s) is ever accepted —
// this blocks javascript:, data:, and every other scheme that could be used
// for stored XSS if the value is ever reflected back into an href/src.
function isSafeMediaUrl(value) {
  if (value === undefined || value === null || value === '') {
    return true; // optional field
  }

  if (typeof value !== 'string' || value.length > 500) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

module.exports = { isSafeMediaUrl };
