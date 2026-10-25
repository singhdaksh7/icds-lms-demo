// Admin-only multipart handling for the homepage intro / promo video form:
//   video   -> streamed straight into Cloudflare R2 under the dedicated public-marketing
//              prefix site/promo/<uuid>.<mp4|webm> (extension AND declared MIME whitelisted,
//              magic bytes verified while streaming, server-generated key)
//   poster  -> the shared local image storage (JPG/PNG/WEBP, 5MB, magic bytes verified)
// Mirrors testimonialMedia.middleware.js. Runs BEFORE CSRF so the token inside the multipart
// body is readable. Any file the controller did not adopt (validation error, CSRF failure...)
// is removed again.
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const r2 = require('../lib/r2');
const imageStorage = require('../lib/imageStorage');
const { isAllowedVideoFile } = require('../lib/videoStorage');
const { createR2Storage, VideoSignatureError } = require('../lib/r2MulterStorage');
const videoStorageSettings = require('../services/videoStorageSettings.service');

const MAX_VIDEO_BYTES = Number(process.env.R2_PROMO_MAX_BYTES) || 300 * 1024 * 1024;
const BAD_IMAGE = 'Unsupported poster type. Only JPG, PNG and WEBP are allowed.';
const BAD_VIDEO = 'Unsupported video file type. Only .mp4 and .webm are allowed.';
const BACK = '/admin/homepage/intro-video';

const diskStorage = multer.diskStorage({
  destination(req, file, cb) {
    try { cb(null, imageStorage.ensureDir()); } catch (err) { cb(err); }
  },
  filename(req, file, cb) {
    try { cb(null, imageStorage.buildFilename(path.extname(file.originalname).toLowerCase())); } catch (err) { cb(err); }
  },
});
const r2Storage = createR2Storage();

const storage = {
  _handleFile(req, file, cb) {
    return (file.fieldname === 'video' ? r2Storage : diskStorage)._handleFile(req, file, cb);
  },
  _removeFile(req, file, cb) {
    return (file.r2Key ? r2Storage : diskStorage)._removeFile(req, file, cb);
  },
};

const multerUpload = multer({
  storage,
  limits: { fileSize: MAX_VIDEO_BYTES, files: 2 },
  fileFilter(req, file, cb) {
    if (file.fieldname === 'video') {
      if (!isAllowedVideoFile(file.originalname, file.mimetype)) return cb(new Error(BAD_VIDEO));
      return cb(null, true);
    }
    if (file.fieldname === 'poster') {
      if (!imageStorage.isAllowedFile(file.originalname, file.mimetype)) return cb(new Error(BAD_IMAGE));
      return cb(null, true);
    }
    return cb(new Error('Unexpected file field.'));
  },
}).fields([{ name: 'video', maxCount: 1 }, { name: 'poster', maxCount: 1 }]);

async function discard(req) {
  const adopted = req.introMediaAdopted || {};
  const files = req.files || {};
  for (const f of files.poster || []) if (!adopted.poster && f.path) fs.unlink(f.path, () => {});
  for (const f of files.video || []) {
    if (!adopted.video && f.r2Key && req.r2UploadConfig) await r2.deleteObject(req.r2UploadConfig, f.r2Key).catch(() => {});
  }
}

function uploadIntroVideoMedia() {
  return async function (req, res, next) {
    try {
      req.r2UploadConfig = await videoStorageSettings.getR2ConfigOrNull();
      req.r2KeyBuilder = (ext) => r2.buildPromoObjectKey(ext);
      req.introMediaAdopted = { video: false, poster: false };
      multerUpload(req, res, (err) => {
        res.on('close', () => { discard(req); });
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') req.flashError(`Video is too large (max ${Math.floor(MAX_VIDEO_BYTES / 1024 / 1024)} MB).`);
          else if (err instanceof VideoSignatureError || /Unsupported|Unexpected/.test(err.message || '')) req.flashError(err.message);
          else if (/not configured/i.test(err.message || '')) req.flashError('Cloudflare R2 is not configured (Admin > Video Storage). Use a YouTube/Vimeo link instead.');
          else { console.error('Intro video upload failed:', err && err.name); req.flashError('Media upload failed. Check Admin > Video Storage and try again.'); }
          return res.redirect(BACK);
        }
        const posters = (req.files && req.files.poster) || [];
        const tooBig = posters.length && posters[0].size > imageStorage.MAX_UPLOAD_BYTES;
        return Promise.all(posters.map((f) => imageStorage.rejectIfSpoofed(f)))
          .then((spoofed) => {
            if (tooBig) req.flashError('Poster is too large (max 5MB).');
            else if (spoofed.some(Boolean)) req.flashError('The uploaded poster is not a valid JPG, PNG or WEBP image.');
            else return next();
            return res.redirect(BACK);
          })
          .catch(next);
      });
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { uploadIntroVideoMedia, MAX_VIDEO_BYTES };
