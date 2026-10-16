// Effective Razorpay configuration: an admin-saved row (razorpay_settings)
// wins; otherwise the RAZORPAY_* environment variables are used. Secrets are
// encrypted at rest and never returned to views — only booleans saying a
// secret is saved.
const { prisma } = require('../config/db');
const env = require('../config/env');
const secretBox = require('../lib/secretBox');

const ROW_ID = 1;
const CACHE_MS = 30 * 1000;
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
      prisma.razorpaySetting.findUnique({ where: { id: ROW_ID } }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), DB_TIMEOUT_MS).unref()),
    ]);
  } catch {
    return null; // DB unreachable / not migrated: fall back to env, don't cache
  }
  cache = { at: Date.now(), row };
  return row;
}

function modeOf(keyId) {
  if (/^rzp_live_/.test(keyId || '')) return 'live';
  if (/^rzp_test_/.test(keyId || '')) return 'test';
  return 'unknown';
}

// { source: 'admin'|'env', enabled, keyId, keySecret, webhookSecret, mode }
async function getEffectiveConfig() {
  const row = await loadRow();
  if (row) {
    const keySecret = secretBox.decrypt(row.keySecretEnc);
    const webhookSecret = row.webhookSecretEnc ? secretBox.decrypt(row.webhookSecretEnc) : '';
    if (keySecret !== null && webhookSecret !== null) {
      return { source: 'admin', enabled: row.enabled, keyId: row.keyId, keySecret, webhookSecret, mode: modeOf(row.keyId) };
    }
    console.error('[payment] stored Razorpay secrets could not be decrypted (key changed?) — falling back to environment settings.');
  }
  return {
    source: 'env',
    enabled: env.RAZORPAY_ENABLED,
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    mode: modeOf(env.RAZORPAY_KEY_ID),
  };
}

// Safe-for-views snapshot: never includes either secret.
async function getAdminView() {
  const row = await loadRow();
  const effective = await getEffectiveConfig();
  return {
    enabled: row ? row.enabled : false,
    keyId: row ? row.keyId : '',
    hasKeySecret: Boolean(row && row.keySecretEnc),
    hasWebhookSecret: Boolean(row && row.webhookSecretEnc),
    savedByAdmin: Boolean(row),
    activeSource: effective.source,
    activeEnabled: Boolean(effective.enabled && effective.keyId && effective.keySecret),
    activeMode: effective.keyId ? effective.mode : 'none',
    envHasKeys: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
  };
}

// Blank secret keeps the existing stored one.
async function save({ enabled, keyId, keySecret, webhookSecret }) {
  const existing = await prisma.razorpaySetting.findUnique({ where: { id: ROW_ID } });
  const keySecretEnc = keySecret ? secretBox.encrypt(keySecret) : existing ? existing.keySecretEnc : null;
  if (!keySecretEnc) throw new Error('A Key Secret is required the first time you save.');
  const data = {
    enabled: Boolean(enabled),
    keyId,
    keySecretEnc,
    webhookSecretEnc: webhookSecret ? secretBox.encrypt(webhookSecret) : existing ? existing.webhookSecretEnc : null,
  };
  await prisma.razorpaySetting.upsert({ where: { id: ROW_ID }, update: data, create: { id: ROW_ID, ...data } });
  invalidate();
}

async function clear() {
  await prisma.razorpaySetting.deleteMany({ where: { id: ROW_ID } });
  invalidate();
}

module.exports = { getEffectiveConfig, getAdminView, save, clear, invalidate, modeOf };
