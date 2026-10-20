// multer StorageEngine that streams an admin video upload straight into
// Cloudflare R2 as a multipart upload. The file is never written to the VPS
// disk and never buffered whole in memory (at most a few 16 MiB parts are in
// flight). The object key is server-generated; the uploaded filename is only
// used to pick the (whitelisted) extension.
const path = require('path');
const { Transform } = require('stream');

const r2 = require('./r2');
const { hasVideoSignature, mimeTypeFor } = require('./videoStorage');

class VideoSignatureError extends Error {
  constructor() {
    super('The file does not look like a valid MP4/WebM video.');
    this.name = 'VideoSignatureError';
  }
}

// Passes bytes through unchanged after verifying the leading file signature.
class SignatureCheck extends Transform {
  constructor(extension) {
    super();
    this.extension = extension;
    this.head = Buffer.alloc(0);
    this.verified = false;
  }

  _transform(chunk, _enc, cb) {
    if (this.verified) return cb(null, chunk);
    this.head = Buffer.concat([this.head, chunk]);
    if (this.head.length < 12) return cb();
    if (!hasVideoSignature(this.head, this.extension)) return cb(new VideoSignatureError());
    this.verified = true;
    const head = this.head;
    this.head = null;
    return cb(null, head);
  }

  _flush(cb) {
    return cb(this.verified ? null : new VideoSignatureError());
  }
}

// `req` must carry: r2UploadConfig, r2CourseId, r2LessonId ('new' or number).
function createR2Storage() {
  return {
    _handleFile(req, file, cb) {
      let key;
      try {
        const ext = path.extname(file.originalname).toLowerCase();
        const contentType = mimeTypeFor(ext);
        if (!contentType) throw new Error('Unsupported video file type. Only .mp4 and .webm are allowed.');
        if (!req.r2UploadConfig) throw new Error('Cloudflare R2 is not configured.');
        key = r2.buildObjectKey(req.r2CourseId, req.r2LessonId, ext);

        const check = new SignatureCheck(ext);
        file.stream.on('error', (err) => check.destroy(err));
        // multer's size limit hit: stop and let the multipart upload abort.
        file.stream.on('limit', () => check.destroy(Object.assign(new Error('File too large'), { code: 'LIMIT_FILE_SIZE' })));
        file.stream.pipe(check);

        r2.uploadStream(req.r2UploadConfig, key, check, contentType)
          .then((meta) => cb(null, { r2Key: key, size: meta.size, mimetype: contentType, provider: 'R2' }))
          .catch((err) => cb(err));
      } catch (err) {
        file.stream.resume();
        cb(err);
      }
    },

    _removeFile(req, file, cb) {
      if (!file.r2Key || !req.r2UploadConfig) return cb(null);
      r2.deleteObject(req.r2UploadConfig, file.r2Key).then(() => cb(null), () => cb(null));
    },
  };
}

module.exports = { createR2Storage, SignatureCheck, VideoSignatureError };
