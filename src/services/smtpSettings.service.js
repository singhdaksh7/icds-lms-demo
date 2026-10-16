// Effective SMTP configuration: an admin-saved row (smtp_settings) wins;
// otherwise the SMTP_* environment variables are used. The stored password
// is encrypted at rest and is never returned to views — only a boolean
// "a password is saved" flag.
const { prisma } = require('../config/db');
const env = require('../config/env');
const secretBox = require('../lib/secretBox');

const ROW_ID = 1;
const CACHE_MS = 60 * 1000;
const DB_TIMEOUT_MS = 3000;

let cache = null; // { at, row }

function invalidate() {
  cache = null;
}

async function loadRow() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.row;
  let row = null;
  try {
    row = await Promise.race([
      prisma.smtpSetting.findUnique({ where: { id: ROW_ID } }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), DB_TIMEOUT_MS).unref()),
    ]);
  } catch {
    // DB unreachable (or table not migrated yet) — fall back to env config
    // for this call, but don't cache the failure.
    return null;
  }
  cache = { at: Date.now(), row };
  return row;
}

// Returns { source: 'admin'|'env'|'none', host, port, secure, user, password, fromEmail, fromName }
async function getEffectiveConfig() {
  const row = await loadRow();
  if (row && row.host && row.fromEmail) {
    const password = row.passwordEnc ? secretBox.decrypt(row.passwordEnc) : '';
    if (!row.passwordEnc || password !== null) {
      return {
        source: 'admin',
        host: row.host,
        port: row.port,
        secure: row.secure,
        user: row.username || '',
        password: password || '',
        fromEmail: row.fromEmail,
        fromName: row.fromName || '',
      };
    }
    console.error('[email] stored SMTP password could not be decrypted (key changed?) — falling back to environment SMTP settings.');
  }
  if (env.SMTP_HOST && env.SMTP_FROM_EMAIL) {
    return {
      source: 'env',
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      fromEmail: env.SMTP_FROM_EMAIL,
      fromName: env.SMTP_FROM_NAME,
    };
  }
  return { source: 'none' };
}

// Safe-for-views snapshot: never includes the password.
async function getAdminView() {
  const row = await loadRow();
  const effective = await getEffectiveConfig();
  return {
    host: row ? row.host : '',
    port: row ? row.port : 587,
    secure: row ? row.secure : false,
    username: row ? row.username || '' : '',
    fromEmail: row ? row.fromEmail : '',
    fromName: row ? row.fromName || '' : '',
    hasPassword: Boolean(row && row.passwordEnc),
    savedByAdmin: Boolean(row),
    activeSource: effective.source,
  };
}

// `password` undefined/'' keeps the existing stored password.
async function save({ host, port, secure, username, password, fromEmail, fromName }) {
  const existing = await prisma.smtpSetting.findUnique({ where: { id: ROW_ID } });
  const data = {
    host,
    port,
    secure,
    username: username || null,
    fromEmail,
    fromName: fromName || null,
    passwordEnc: password ? secretBox.encrypt(password) : existing ? existing.passwordEnc : null,
  };
  await prisma.smtpSetting.upsert({ where: { id: ROW_ID }, update: data, create: { id: ROW_ID, ...data } });
  invalidate();
}

// Removes the admin override so the env SMTP_* values apply again.
async function clear() {
  await prisma.smtpSetting.deleteMany({ where: { id: ROW_ID } });
  invalidate();
}

module.exports = { getEffectiveConfig, getAdminView, save, clear, invalidate };
