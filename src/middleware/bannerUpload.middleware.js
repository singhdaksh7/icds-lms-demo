// Admin-only upload for homepage banner images (desktop + optional mobile).
// Same safety pattern as thumbnailUpload.middleware.js: extension AND declared
// MIME against the shared whitelist, magic-byte verification, random
// server-generated filenames, 5MB limit, and automatic removal of any file the
// controller did not adopt (CSRF failure, validation error...).
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const imageStorage = require('../lib/imageStorage');

const BAD_TYPE = 'Unsupported image type. Only JPG, PNG and WEBP are allowed.';
const FIELDS = ['desktopImage', 'mobileImage'];

const storage = multer.diskStorage({
  destination(req, file, cb) {
    try {
      cb(null, imageStorage.ensureDir());
    } catch (err) {
      cb(err);
    }
  },
  filename(req, file, cb) {
    try {
      cb(null, imageStorage.buildFilename(path.extname(file.originalname).toLowerCase()));
    } catch (err) {
      cb(err);
    }
  },
});

const multerUpload = multer({
  storage,
  limits: { fileSize: imageStorage.MAX_UPLOAD_BYTES, files: 2 },
  fileFilter(req, file, cb) {
    if (!FIELDS.includes(file.fieldname)) return cb(new Error('Unexpected file field.'));
    if (!imageStorage.isAllowedFile(file.originalname, file.mimetype)) return cb(new Error(BAD_TYPE));
    cb(null, true);
  },
}).fields(FIELDS.map((name) => ({ name, maxCount: 1 })));

function discard(files) {
  for (const f of files) if (f && f.path) fs.unlink(f.path, () => {});
}

function uploadBannerImages(redirectTo) {
  const target = (req) => (typeof redirectTo === 'function' ? redirectTo(req) : redirectTo);
  return function (req, res, next) {
    multerUpload(req, res, (err) => {
      const files = Object.values(req.files || {}).flat();
      if (err) {
        discard(files);
        if (err.code === 'LIMIT_FILE_SIZE') req.flashError('Image is too large (max 5MB).');
        else req.flashError(err.message || 'Image upload failed.');
        return res.redirect(target(req));
      }
      req.bannerAdopted = new Set();
      res.on('close', () => discard(files.filter((f) => !req.bannerAdopted.has(f.path))));
      return Promise.all(files.map((f) => imageStorage.rejectIfSpoofed(f)))
        .then((spoofed) => {
          if (!spoofed.some(Boolean)) return next();
          req.flashError('The uploaded file is not a valid JPG, PNG or WEBP image.');
          return res.redirect(target(req));
        })
        .catch(next);
    });
  };
}

module.exports = { uploadBannerImages };
