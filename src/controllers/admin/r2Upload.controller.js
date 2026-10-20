// Direct browser -> Cloudflare R2 multipart upload (admin only).
//
//   start      validate + CreateMultipartUpload, return a signed session token
//   part-urls  presigned UploadPart URLs (browser PUTs the bytes to R2 itself)
//   complete   CompleteMultipartUpload, verify size + file signature, THEN link
//              the lesson in the DB, THEN delete the previous video
//   abort      AbortMultipartUpload
//
// The session token is an HMAC over lesson/key/uploadId/size, so a client can
// only continue an upload this server started for that exact lesson, and can
// never make the server touch an arbitrary object key.
const crypto = require('crypto');
const path = require('path');

const { prisma } = require('../../config/db');
const { SESSION_SECRET } = require('../../config/env');
const r2 = require('../../lib/r2');
const { isAllowedVideoFile, mimeTypeFor, hasVideoSignature } = require('../../lib/videoStorage');
const videoStorageSettings = require('../../services/videoStorageSettings.service');
const lessonService = require('../../services/lesson.service');

const MAX_BYTES = Number(process.env.R2_MAX_UPLOAD_BYTES) || 5 * 1024 * 1024 * 1024;
const PART_SIZE = 32 * 1024 * 1024;
const MAX_PARTS = 10000;

function sign(lessonId, key, uploadId, size) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(`r2up|${lessonId}|${key}|${uploadId}|${size}`).digest('hex');
}

function tokenOk(lessonId, key, uploadId, size, token) {
  if (typeof token !== 'string' || token.length !== 64) return false;
  const expected = Buffer.from(sign(lessonId, key, uploadId, size));
  const got = Buffer.from(token);
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

const fail = (res, status, error) => res.status(status).json({ ok: false, error });

async function loadContext(req, res) {
  const lessonId = parseInt(req.params.id, 10);
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, include: { course: true } });
  if (!lesson || !lesson.course) {
    fail(res, 404, 'Lesson not found.');
    return null;
  }
  const config = await videoStorageSettings.getR2ConfigOrNull();
  if (!config) {
    fail(res, 503, 'Cloudflare R2 is not configured.');
    return null;
  }
  return { lesson, config };
}

async function start(req, res, next) {
  try {
    const ctx = await loadContext(req, res);
    if (!ctx) return undefined;
    const { lesson, config } = ctx;

    const filename = typeof req.body.filename === 'string' ? req.body.filename : '';
    const contentType = typeof req.body.contentType === 'string' ? req.body.contentType : '';
    const size = Number(req.body.size);
    if (!isAllowedVideoFile(filename, contentType || 'application/octet-stream')) {
      return fail(res, 400, 'Unsupported video file type. Only .mp4 and .webm are allowed.');
    }
    if (!Number.isInteger(size) || size < 1024 || size > MAX_BYTES) {
      return fail(res, 400, `File size must be between 1 KB and ${Math.floor(MAX_BYTES / 1024 ** 3)} GB.`);
    }
    const ext = path.extname(filename).toLowerCase();
    const key = r2.buildObjectKey(lesson.courseId, lesson.id, ext);
    const mime = mimeTypeFor(ext);
    const partCount = Math.ceil(size / PART_SIZE);
    if (partCount > MAX_PARTS) return fail(res, 400, 'File is too large.');

    const uploadId = await r2.createMultipart(config, key, mime);
    return res.json({ ok: true, key, uploadId, partSize: PART_SIZE, partCount, token: sign(lesson.id, key, uploadId, size) });
  } catch (err) {
    console.error('R2 start failed:', err && err.name);
    return next ? fail(res, 502, 'Could not start the upload. Check Admin > Video Storage.') : undefined;
  }
}

function readSession(req, res, lesson) {
  const { key, uploadId, token } = req.body || {};
  const size = Number(req.body && req.body.size);
  if (typeof key !== 'string' || typeof uploadId !== 'string' || !r2.isOwnedObjectKey(key) || !tokenOk(lesson.id, key, uploadId, size, token)) {
    fail(res, 403, 'Invalid upload session.');
    return null;
  }
  // The key must belong to this very lesson's course/lesson path.
  if (!key.startsWith(`courses/${lesson.courseId}/lessons/${lesson.id}/`)) {
    fail(res, 403, 'Invalid upload session.');
    return null;
  }
  return { key, uploadId, size };
}

async function partUrls(req, res) {
  try {
    const ctx = await loadContext(req, res);
    if (!ctx) return undefined;
    const s = readSession(req, res, ctx.lesson);
    if (!s) return undefined;
    const numbers = Array.isArray(req.body.partNumbers) ? req.body.partNumbers : [];
    const maxPart = Math.ceil(s.size / PART_SIZE);
    if (numbers.length < 1 || numbers.length > 50 || !numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= maxPart)) {
      return fail(res, 400, 'Invalid part numbers.');
    }
    const urls = {};
    for (const n of numbers) urls[n] = await r2.signUploadPartUrl(ctx.config, s.key, s.uploadId, n);
    return res.json({ ok: true, urls });
  } catch (err) {
    console.error('R2 part-urls failed:', err && err.name);
    return fail(res, 502, 'Could not sign upload parts.');
  }
}

async function complete(req, res) {
  let ctx;
  let s;
  try {
    ctx = await loadContext(req, res);
    if (!ctx) return undefined;
    s = readSession(req, res, ctx.lesson);
    if (!s) return undefined;
    const parts = Array.isArray(req.body.parts) ? req.body.parts : [];
    const maxPart = Math.ceil(s.size / PART_SIZE);
    const clean = parts
      .map((p) => ({ PartNumber: Number(p && p.PartNumber), ETag: p && p.ETag }))
      .filter((p) => Number.isInteger(p.PartNumber) && p.PartNumber >= 1 && p.PartNumber <= maxPart && typeof p.ETag === 'string' && /^"?[0-9a-fA-F-]{8,80}"?$/.test(p.ETag))
      .sort((a, b) => a.PartNumber - b.PartNumber);
    if (clean.length !== maxPart || clean.some((p, i) => p.PartNumber !== i + 1)) {
      return fail(res, 400, 'Upload is incomplete.');
    }

    await r2.completeMultipart(ctx.config, s.key, s.uploadId, clean);

    // Verify what R2 actually stored before it can be linked to a lesson.
    const meta = await r2.headObject(ctx.config, s.key);
    const ext = path.extname(s.key);
    const head = await r2.readHead(ctx.config, s.key, 16);
    if (meta.size !== s.size || !hasVideoSignature(head, ext)) {
      await r2.deleteObject(ctx.config, s.key).catch(() => {});
      return fail(res, 422, meta.size !== s.size ? 'Stored size did not match the file.' : 'The file does not look like a valid MP4/WebM video.');
    }

    // Link in the DB FIRST; only then remove the previous video.
    const previous = await prisma.lesson.findUnique({ where: { id: ctx.lesson.id } });
    try {
      await prisma.lesson.update({
        where: { id: ctx.lesson.id },
        data: {
          videoType: 'R2',
          videoPath: null,
          videoObjectKey: s.key,
          videoDurationSeconds: null,
          videoSizeBytes: BigInt(meta.size),
          videoMimeType: mimeTypeFor(ext),
        },
      });
    } catch (dbErr) {
      await r2.deleteObject(ctx.config, s.key).catch(() => {});
      throw dbErr;
    }
    await lessonService.cleanupPreviousVideo(previous, ctx.lesson.id);

    if (req.flashSuccess) req.flashSuccess('Video uploaded to Cloudflare R2 and attached to this lesson.');
    return res.json({ ok: true, size: meta.size, key: s.key, redirect: `/admin/lessons/${ctx.lesson.id}/edit` });
  } catch (err) {
    console.error('R2 complete failed:', err && err.name);
    if (ctx && s) await r2.abortMultipart(ctx.config, s.key, s.uploadId).catch(() => {});
    return fail(res, 502, 'Could not finish the upload; the lesson was not changed.');
  }
}

async function abort(req, res) {
  try {
    const ctx = await loadContext(req, res);
    if (!ctx) return undefined;
    const s = readSession(req, res, ctx.lesson);
    if (!s) return undefined;
    await r2.abortMultipart(ctx.config, s.key, s.uploadId);
    return res.json({ ok: true });
  } catch (err) {
    return fail(res, 502, 'Could not abort the upload.');
  }
}

module.exports = { start, partUrls, complete, abort, sign, tokenOk, PART_SIZE };
