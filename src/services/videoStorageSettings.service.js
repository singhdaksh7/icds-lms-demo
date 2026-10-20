// Admin-configurable video storage provider (LOCAL or CLOUDFLARE_R2).
//
// Persisted in the existing key/value `site_settings` table under the
// `videoStorage.` prefix. The R2 Secret Access Key is stored AES-256-GCM
// encrypted (key: SETTINGS_ENCRYPTION_KEY env var) and is never returned to
// any view - the admin UI only learns whether one is configured.
const { prisma } = require('../config/db');
const secretBox = require('../lib/secretBox');

const PREFIX = 'videoStorage.';
const KEYS = {
  provider: `${PREFIX}provider`,
  accountId: `${PREFIX}r2.accountId`,
  accessKeyId: `${PREFIX}r2.accessKeyId`,
  secret: `${PREFIX}r2.secretEnc`,
  bucket: `${PREFIX}r2.bucket`,
  endpoint: `${PREFIX}r2.endpoint`,
};
const PROVIDERS = ['LOCAL', 'CLOUDFLARE_R2'];

let cache = { data: null, expiresAt: 0 };
const CACHE_TTL_MS = 15 * 1000;

function invalidateCache() {
  cache = { data: null, expiresAt: 0 };
}

async function readRows() {
  const rows = await prisma.siteSetting.findMany({ where: { key: { startsWith: PREFIX } } });
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// Server-side config including the decrypted secret. NEVER pass this to a
// view or serialize it into a response.
async function getConfig() {
  if (cache.data && Date.now() < cache.expiresAt) return cache.data;

  const rows = await readRows();
  const provider = PROVIDERS.includes(rows[KEYS.provider]) ? rows[KEYS.provider] : 'LOCAL';
  const r2 = {
    accountId: rows[KEYS.accountId] || '',
    accessKeyId: rows[KEYS.accessKeyId] || '',
    bucket: rows[KEYS.bucket] || '',
    endpoint: rows[KEYS.endpoint] || '',
    secretAccessKey: '',
  };
  let secretConfigured = Boolean(rows[KEYS.secret]);
  let secretError = null;
  if (rows[KEYS.secret]) {
    const plain = secretBox.decrypt(rows[KEYS.secret]);
    if (plain === null) {
      // Encryption key changed/rotated: the stored secret is unusable.
      secretConfigured = false;
      secretError = 'The stored secret could not be decrypted (encryption key changed). Re-enter the Secret Access Key.';
    } else {
      r2.secretAccessKey = plain;
    }
  }
  const r2Complete = Boolean(r2.accessKeyId && r2.secretAccessKey && r2.bucket && (r2.accountId || r2.endpoint));
  const data = {
    provider,
    r2,
    secretConfigured,
    secretError,
    r2Complete,
    // The provider that new uploads actually use. Falls back to LOCAL if R2
    // is selected but not usable, so uploads never silently go nowhere.
    activeProvider: provider === 'CLOUDFLARE_R2' && r2Complete ? 'CLOUDFLARE_R2' : 'LOCAL',
  };
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

// R2 config for playback / cleanup of existing R2 lessons, regardless of
// which provider new uploads currently use. Null when not usable.
async function getR2ConfigOrNull() {
  const cfg = await getConfig();
  return cfg.r2Complete ? cfg.r2 : null;
}

function maskAccessKey(id) {
  if (!id) return '';
  if (id.length <= 8) return '••••';
  return `${id.slice(0, 4)}••••••••${id.slice(-4)}`;
}

// Safe-to-render view model.
async function getAdminView() {
  const cfg = await getConfig();
  return {
    provider: cfg.provider,
    activeProvider: cfg.activeProvider,
    accountId: cfg.r2.accountId,
    bucket: cfg.r2.bucket,
    endpoint: cfg.r2.endpoint,
    accessKeyMasked: maskAccessKey(cfg.r2.accessKeyId),
    secretConfigured: cfg.secretConfigured,
    secretError: cfg.secretError,
    r2Complete: cfg.r2Complete,
  };
}

const ACCOUNT_RE = /^[a-f0-9]{32}$/i;
const ACCESS_KEY_RE = /^[A-Za-z0-9]{16,128}$/;
const BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const SECRET_RE = /^[\x21-\x7e]{16,256}$/;

function validateEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // SSRF guard: the app will only ever talk to Cloudflare's R2 S3 endpoint.
  if (url.protocol !== 'https:' || !/\.r2\.cloudflarestorage\.com$/i.test(url.hostname) || url.pathname !== '/' || url.search || url.username) {
    return null;
  }
  return `https://${url.hostname.toLowerCase()}`;
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// Validates a settings submission. A blank secret keeps the existing one.
function validate(body, current) {
  const errors = [];
  const provider = PROVIDERS.includes(body.provider) ? body.provider : null;
  if (!provider) errors.push('Choose a storage provider.');

  const accountId = str(body.accountId);
  const accessKeyId = str(body.accessKeyId);
  const bucket = str(body.bucket);
  const secret = typeof body.secretAccessKey === 'string' ? body.secretAccessKey.trim() : '';
  let endpoint = str(body.endpoint);

  if (accountId && !ACCOUNT_RE.test(accountId)) errors.push('Account ID must be the 32-character hex ID from your Cloudflare dashboard.');
  if (accessKeyId && !ACCESS_KEY_RE.test(accessKeyId)) errors.push('Access Key ID looks invalid.');
  if (bucket && !BUCKET_RE.test(bucket)) errors.push('Bucket name must be 3-63 characters: lowercase letters, numbers and hyphens.');
  if (secret && !SECRET_RE.test(secret)) errors.push('Secret Access Key looks invalid.');
  if (endpoint) {
    endpoint = validateEndpoint(endpoint);
    if (!endpoint) errors.push('Endpoint must be an https://<account>.r2.cloudflarestorage.com URL.');
  }

  if (provider === 'CLOUDFLARE_R2') {
    if (!(accountId || endpoint)) errors.push('Account ID (or endpoint) is required for Cloudflare R2.');
    if (!accessKeyId) errors.push('Access Key ID is required for Cloudflare R2.');
    if (!bucket) errors.push('Bucket name is required for Cloudflare R2.');
    if (!secret && !(current && current.secretConfigured)) errors.push('Secret Access Key is required for Cloudflare R2.');
  }

  return { errors, values: { provider, accountId, accessKeyId, bucket, endpoint: endpoint || '', secret } };
}

async function save(values) {
  const writes = [];
  const put = (key, value) =>
    writes.push(
      value === ''
        ? prisma.siteSetting.deleteMany({ where: { key } })
        : prisma.siteSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
    );
  put(KEYS.provider, values.provider);
  put(KEYS.accountId, values.accountId);
  put(KEYS.accessKeyId, values.accessKeyId);
  put(KEYS.bucket, values.bucket);
  put(KEYS.endpoint, values.endpoint);
  // Blank secret = keep the stored one.
  if (values.secret) put(KEYS.secret, secretBox.encrypt(values.secret));
  await prisma.$transaction(writes);
  invalidateCache();
}

module.exports = {
  KEYS,
  PROVIDERS,
  getConfig,
  getR2ConfigOrNull,
  getAdminView,
  validate,
  save,
  invalidateCache,
  maskAccessKey,
};
