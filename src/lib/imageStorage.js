// Local course/instructor thumbnail image storage.
//
// Mirrors the persistence pattern used for lesson videos (see
// src/lib/videoStorage.js): a configurable root directory (so production can
// point it at a path that survives redeploys) served through a dedicated
// static route (see server.js `/uploads/thumbnails`) rather than the plain
// public/ static mount, so the storage location isn't hardcoded to public/.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_ROOT = process.env.THUMBNAIL_STORAGE_ROOT
  ? path.resolve(process.env.THUMBNAIL_STORAGE_ROOT)
  : path.join(__dirname, '..', '..', 'public', 'uploads', 'thumbnails');

// extension -> MIME type. Only these are ever accepted — never trust a
// client-supplied Content-Type/extension beyond this whitelist.
const ALLOWED_IMAGE_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB

function ensureDir() {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  return STORAGE_ROOT;
}

// Site-wide (non-course, non-instructor) images, e.g. the homepage "Why
// ICDS" section image, live in a "site/" subfolder of the SAME storage
// root — reusing the same persistent volume and the same
// /uploads/thumbnails static mount (express.static serves subdirectories),
// rather than inventing a second storage root that would need its own
// deployment/volume wiring.
const SITE_SUBDIR = 'site';

function ensureSiteDir() {
  const dir = path.join(STORAGE_ROOT, SITE_SUBDIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Stored DB value shape for site images is always "site/<uuid>.<ext>" — a
// safe relative reference, never an absolute path.
const SITE_IMAGE_PATTERN = /^site\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp))$/;

function siteImagePublicUrl(relPath) {
  if (typeof relPath !== 'string' || !SITE_IMAGE_PATTERN.test(relPath)) return null;
  return `/uploads/thumbnails/${relPath}`;
}

// Resolves a trusted, DB-originated "site/<uuid>.<ext>" reference to an
// absolute path, defending against traversal even though the value should
// already be safe.
function resolveSiteImagePath(relPath) {
  const match = typeof relPath === 'string' ? relPath.match(SITE_IMAGE_PATTERN) : null;
  if (!match) return null;
  const full = path.join(STORAGE_ROOT, SITE_SUBDIR, match[1]);
  const dir = path.join(STORAGE_ROOT, SITE_SUBDIR) + path.sep;
  if (!full.startsWith(dir)) return null;
  return full;
}

function deleteSiteImageIfOwned(relPath) {
  const full = resolveSiteImagePath(relPath);
  if (!full) return;
  fs.unlink(full, () => {}); // best-effort; never let cleanup fail the request
}

function isAllowedFile(originalname, mimetype) {
  const ext = path.extname(originalname).toLowerCase();
  const expectedMime = ALLOWED_IMAGE_TYPES[ext];
  if (!expectedMime) {
    return false;
  }
  return mimetype === expectedMime;
}

// Builds a server-generated filename for a freshly uploaded image — never
// derived from the original uploaded filename.
function buildFilename(extension) {
  if (!ALLOWED_IMAGE_TYPES[extension]) {
    throw new Error('Unsupported image extension.');
  }
  return `${crypto.randomUUID()}${extension}`;
}

// Public URL for a stored filename, served via the dedicated
// /uploads/thumbnails static route (works regardless of where STORAGE_ROOT
// physically points).
function publicUrlFor(filename) {
  if (!filename) return null;
  return `/uploads/thumbnails/${filename}`;
}

// Resolves a stored (trusted, DB-originated) filename to an absolute path,
// defending against traversal even though the value should already be safe.
function resolveFilename(filename) {
  if (
    typeof filename !== 'string' ||
    filename.length === 0 ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('..')
  ) {
    return null;
  }
  const full = path.join(STORAGE_ROOT, filename);
  const rootWithSep = STORAGE_ROOT + path.sep;
  if (full !== STORAGE_ROOT && !full.startsWith(rootWithSep)) {
    return null;
  }
  return full;
}

// Given a previously-stored thumbnail URL (as produced by publicUrlFor),
// extracts the bare filename so the old file can be safely removed after a
// replacement upload. Returns null for anything that isn't one of our own
// generated URLs (e.g. a manually-entered external URL) — never deletes
// anything we didn't create.
function filenameFromPublicUrl(url) {
  if (typeof url !== 'string') return null;
  const match = url.match(/^\/uploads\/thumbnails\/([^/]+)$/);
  return match ? match[1] : null;
}

function deleteIfOwned(url) {
  const filename = filenameFromPublicUrl(url);
  if (!filename) return;
  const full = resolveFilename(filename);
  if (!full) return;
  fs.unlink(full, () => {}); // best-effort; never let cleanup fail the request
}

module.exports = {
  STORAGE_ROOT,
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  ensureDir,
  isAllowedFile,
  buildFilename,
  publicUrlFor,
  resolveFilename,
  filenameFromPublicUrl,
  deleteIfOwned,
  ensureSiteDir,
  siteImagePublicUrl,
  resolveSiteImagePath,
  deleteSiteImageIfOwned,
};
