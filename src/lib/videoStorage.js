// Local (Hostinger-hosted) lesson video storage helpers.
//
// Videos live under STORAGE_ROOT/<course-slug>/<uuid>.<ext> — a directory
// outside the Express static root (public/), so nothing here is ever
// reachable by a direct URL. The only way to read a video's bytes is through
// the authorized /media/lessons/:lessonId/video route (see media.controller).
//
// STORAGE_ROOT itself defaults to <project root>/storage/videos for local
// dev, but MUST be overridden via VIDEO_STORAGE_ROOT to an absolute path
// OUTSIDE the deployment directory in production — Hostinger's Node.js
// build pipeline replaces the whole app directory (hbuilds/current/nodejs)
// on every redeploy, which would silently wipe any videos stored inside it.
// See README "Production Operations" for the exact path used.
//
// `videoPath` as stored in the DB is always a relative path of the exact
// shape built here (never taken verbatim from user input as a filesystem
// path) — see buildVideoPath / resolveVideoPath.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_ROOT = process.env.VIDEO_STORAGE_ROOT
  ? path.resolve(process.env.VIDEO_STORAGE_ROOT)
  : path.join(__dirname, '..', '..', 'storage', 'videos');

// extension -> MIME type. Only these are ever accepted or served — never
// trust a client-supplied Content-Type/extension beyond this whitelist.
const ALLOWED_VIDEO_TYPES = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200MB — see README "Video Upload" for why.

function isSafeSlugSegment(segment) {
  return typeof segment === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(segment);
}

// Builds a new, server-generated relative path for a freshly uploaded video.
// courseSlug must already be a valid slug (from the DB, never raw user
// input); the filename is always a random UUID, never derived from the
// original uploaded filename.
function buildVideoPath(courseSlug, extension) {
  if (!isSafeSlugSegment(courseSlug)) {
    throw new Error('Invalid course slug for video storage path.');
  }
  if (!ALLOWED_VIDEO_TYPES[extension]) {
    throw new Error('Unsupported video extension.');
  }
  const filename = `${crypto.randomUUID()}${extension}`;
  return path.posix.join(courseSlug, filename);
}

// Resolves a stored (trusted, DB-originated) relative videoPath to an
// absolute filesystem path, defending in depth against path traversal even
// though the value should already be server-generated and safe.
function resolveVideoPath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    return null;
  }
  const normalized = path.normalize(relativePath).replace(/^([/\\])+/, '');
  const absolute = path.resolve(STORAGE_ROOT, normalized);
  const rootWithSep = STORAGE_ROOT + path.sep;
  if (absolute !== STORAGE_ROOT && !absolute.startsWith(rootWithSep)) {
    return null; // escaped the storage root — reject
  }
  return absolute;
}

function mimeTypeFor(extension) {
  return ALLOWED_VIDEO_TYPES[extension] || null;
}

function ensureCourseDir(courseSlug) {
  if (!isSafeSlugSegment(courseSlug)) {
    throw new Error('Invalid course slug for video storage path.');
  }
  const dir = path.join(STORAGE_ROOT, courseSlug);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Used by the "register an existing file" admin flow (for videos placed
// directly via File Manager/SFTP — see README). Only accepts a bare
// filename already sitting inside storage/videos/<courseSlug>/, never an
// arbitrary path.
function findExistingFile(courseSlug, filename) {
  if (!isSafeSlugSegment(courseSlug)) {
    return null;
  }
  if (
    typeof filename !== 'string' ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('..')
  ) {
    return null;
  }
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_VIDEO_TYPES[ext]) {
    return null;
  }
  const dir = path.join(STORAGE_ROOT, courseSlug);
  const full = path.join(dir, filename);
  const dirWithSep = dir + path.sep;
  if (full !== dir && !full.startsWith(dirWithSep)) {
    return null;
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    return null;
  }
  return path.posix.join(courseSlug, filename);
}

module.exports = {
  STORAGE_ROOT,
  ALLOWED_VIDEO_TYPES,
  MAX_UPLOAD_BYTES,
  buildVideoPath,
  resolveVideoPath,
  mimeTypeFor,
  ensureCourseDir,
  findExistingFile,
};
