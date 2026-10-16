// Persistent storage for admin-uploaded certificate PDFs.
//
// Files live under CERTIFICATE_STORAGE_ROOT (production: /data/certificates,
// a bind mount of /opt/icds/data/certificates - never inside the Docker
// image) and are NEVER web-served directly. The only way to read one is the
// authorised certificate download routes. The DB (`certificates.fileUrl`)
// stores just the generated filename, never a path, so nothing here can be
// steered to an arbitrary file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_ROOT = process.env.CERTIFICATE_STORAGE_ROOT
  ? path.resolve(process.env.CERTIFICATE_STORAGE_ROOT)
  : path.join(__dirname, '..', '..', 'storage', 'certificates');

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB
const FILENAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;
const PDF_MAGIC = Buffer.from('%PDF-');

function ensureDir() {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  return STORAGE_ROOT;
}

function buildFilename() {
  return `${crypto.randomUUID()}.pdf`;
}

function isAllowedFile(originalname, mimetype) {
  return path.extname(String(originalname || '')).toLowerCase() === '.pdf' && mimetype === 'application/pdf';
}

// Resolves a DB-originated stored name to an absolute path, or null when it
// is not exactly one of our generated filenames.
function resolveStoredFile(name) {
  if (typeof name !== 'string' || !FILENAME_PATTERN.test(name)) return null;
  const full = path.join(STORAGE_ROOT, name);
  return full.startsWith(STORAGE_ROOT + path.sep) ? full : null;
}

// True when the file starts with the "%PDF-" signature. Extension and the
// browser-declared MIME type are attacker-controlled, so the real bytes are
// checked too.
async function hasPdfSignature(filePath) {
  let handle;
  try {
    handle = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(PDF_MAGIC.length);
    const { bytesRead } = await handle.read(buf, 0, PDF_MAGIC.length, 0);
    return bytesRead === PDF_MAGIC.length && buf.equals(PDF_MAGIC);
  } catch (err) {
    return false;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function deleteStoredFile(name) {
  const full = resolveStoredFile(name);
  if (full) fs.unlink(full, () => {});
}

async function readStoredFile(name) {
  const full = resolveStoredFile(name);
  if (!full) return null;
  try {
    return await fs.promises.readFile(full);
  } catch (err) {
    return null;
  }
}

module.exports = {
  STORAGE_ROOT,
  MAX_UPLOAD_BYTES,
  ensureDir,
  buildFilename,
  isAllowedFile,
  resolveStoredFile,
  hasPdfSignature,
  deleteStoredFile,
  readStoredFile,
};
