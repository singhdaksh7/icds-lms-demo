const crypto = require('crypto');

// The raw token is what goes in the reset URL/email; only its SHA-256 hash
// is ever persisted, so a leaked/stolen database dump can't be replayed as
// a valid reset link.
function generateRawToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

module.exports = { generateRawToken, hashToken };
