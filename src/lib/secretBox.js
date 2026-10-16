// Authenticated encryption (AES-256-GCM) for the few secrets an admin may
// enter through the UI (currently only the SMTP password). The key comes
// from SETTINGS_ENCRYPTION_KEY, or — if unset — is derived from
// SESSION_SECRET, so no extra setup is required. Rotating the key makes
// stored values undecryptable (decrypt returns null) and the admin must
// re-enter them; the app then falls back to environment SMTP_* values.
const crypto = require('crypto');
const { SETTINGS_ENCRYPTION_KEY, SESSION_SECRET } = require('../config/env');

const VERSION = 'v1';

function getKey() {
  const material = SETTINGS_ENCRYPTION_KEY || SESSION_SECRET;
  return Buffer.from(crypto.hkdfSync('sha256', material, 'icds-settings-salt', 'icds-smtp-secret', 32));
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

function decrypt(payload) {
  try {
    const [version, iv, tag, data] = String(payload || '').split(':');
    if (version !== VERSION || !iv || !tag || !data) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { encrypt, decrypt };
