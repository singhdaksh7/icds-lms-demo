// Shared helpers for temporary Hostinger↔TiDB network diagnostics (see
// src/routes/internal.routes.js and the timeout wrapper in
// src/config/db.js). Kept in one place so the sanitization rules are
// applied consistently everywhere a raw error might otherwise leak into a
// log line or an HTTP response.
const dns = require('dns');

// Strips anything that looks like a credential or connection string from
// an error message before it's logged or returned. Defensive-in-depth:
// none of the diagnostic calls this module supports are ever given
// DATABASE_URL directly, but driver/library error messages can echo back
// arbitrary parts of what they were given.
function sanitizeMessage(message) {
  if (typeof message !== 'string') return '';
  return message
    .replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s'"]+/g, '[redacted-url]')
    .replace(/password\s*[:=]\s*\S+/gi, 'password=[redacted]');
}

// Summarizes any thrown value into a small, log/response-safe object.
// Never includes the original error's full message unsanitized, and never
// includes anything beyond name/code/message/cause.code.
function summarizeError(err) {
  if (!err) return { name: null, code: null, causeCode: null, message: null };
  return {
    name: err.name || (err.constructor && err.constructor.name) || 'Error',
    code: err.code || null,
    causeCode: (err.cause && err.cause.code) || null,
    message: sanitizeMessage(err.message),
  };
}

// Races a promise against a timeout, resolving to a tagged result instead
// of ever leaving the caller hanging indefinitely. `label` is echoed back
// so callers can log a fixed marker (e.g. TIDB_HEALTH_TIMEOUT) on timeout.
async function withTimeout(promiseFactory, ms, label) {
  const start = Date.now();
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, timedOut: true, label }), ms);
  });

  try {
    const attempt = Promise.resolve()
      .then(() => promiseFactory())
      .then((value) => ({ ok: true, value }))
      .catch((err) => ({ ok: false, timedOut: false, error: summarizeError(err) }));
    const result = await Promise.race([attempt, timeout]);
    return { ...result, elapsedMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

function dnsLookup(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, (err, address, family) => {
      if (err) return reject(err);
      resolve({ address, family });
    });
  });
}

module.exports = { sanitizeMessage, summarizeError, withTimeout, dnsLookup };
