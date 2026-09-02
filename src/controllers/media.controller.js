// Serves locally-hosted lesson videos with server-enforced authorization
// and HTTP Range support (required for seeking/scrubbing).
//
// This is access control, not DRM: it stops casual/direct URL access by
// unauthorized users, but a technically advanced, authorized viewer can
// still capture the stream once it's playing in their browser. See README
// "Video Security" for this explicit scope statement.
const fs = require('fs');
const { prisma } = require('../config/db');
const { isUserEnrolled } = require('../services/enrollment.service');
const { resolveVideoPath, mimeTypeFor } = require('../lib/videoStorage');
const path = require('path');

async function getLessonVideo(req, res, next) {
  try {
    const lessonId = parseInt(req.params.lessonId, 10);
    if (!Number.isInteger(lessonId) || lessonId <= 0) {
      return res.status(404).end();
    }

    // Authorization is derived entirely from server-side DB state for the
    // requested lessonId — courseId/userId are never trusted from the
    // client beyond identifying which lesson was asked for.
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { course: true },
    });

    if (!lesson || lesson.status !== 'PUBLISHED' || !lesson.course) {
      return res.status(404).end();
    }
    if (lesson.videoType !== 'LOCAL' || !lesson.videoPath) {
      return res.status(404).end();
    }

    const isAdmin = Boolean(req.currentUser && req.currentUser.role === 'ADMIN');
    let authorized = isAdmin;

    if (!authorized && lesson.preview) {
      authorized = true;
    }

    if (!authorized) {
      if (!req.currentUser) {
        return res.status(401).end();
      }
      authorized = await isUserEnrolled(req.currentUser.id, lesson.courseId);
    }

    if (!authorized) {
      return res.status(403).end();
    }

    const absolutePath = resolveVideoPath(lesson.videoPath);
    if (!absolutePath) {
      return res.status(404).end();
    }

    let stat;
    try {
      stat = fs.statSync(absolutePath);
    } catch {
      return res.status(404).end();
    }
    if (!stat.isFile()) {
      return res.status(404).end();
    }

    const ext = path.extname(absolutePath).toLowerCase();
    const contentType = mimeTypeFor(ext);
    if (!contentType) {
      return res.status(404).end();
    }

    // Private, non-shared, short-lived cache — never let a CDN/shared proxy
    // cache protected video bytes.
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');

    const range = req.headers.range;
    if (!range) {
      res.setHeader('Content-Length', stat.size);
      if (req.method === 'HEAD') {
        return res.status(200).end();
      }
      return fs.createReadStream(absolutePath).pipe(res);
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      return res.status(416).end();
    }

    let start = match[1] === '' ? undefined : parseInt(match[1], 10);
    let end = match[2] === '' ? undefined : parseInt(match[2], 10);

    if (start === undefined && end === undefined) {
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      return res.status(416).end();
    }
    if (start === undefined) {
      // suffix range: last `end` bytes
      start = Math.max(stat.size - end, 0);
      end = stat.size - 1;
    } else if (end === undefined || end >= stat.size) {
      end = stat.size - 1;
    }

    if (start > end || start >= stat.size) {
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      return res.status(416).end();
    }

    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', chunkSize);

    if (req.method === 'HEAD') {
      return res.end();
    }

    const stream = fs.createReadStream(absolutePath, { start, end });
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

module.exports = { getLessonVideo };
