// Admin-only upload of CMS-managed site images (logo, favicon, hero, Why ICDS,
// auth side panels). Same safety pattern as thumbnailUpload.middleware.js:
// extension AND declared MIME type are checked against the shared image
// whitelist, the real file signature (magic bytes) is verified after the
// write, files go to the "site/" subfolder of the persistent thumbnail
// storage root, and the stored name is always a server-generated UUID.
//
// Uploads are OPTIONAL - a Site Content form submits with or without a file,
// so this must not error when none is attached. Each file input is named
// "file__<settingKey>" and only keys that are registered image settings are
// accepted; anything else is rejected before it is written.
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const imageStorage = require('../lib/imageStorage');
const { IMAGE_KEYS } = require('../config/siteContent');

const { MAX_UPLOAD_BYTES, ensureSiteDir, isAllowedFile, buildFilename } = imageStorage;

const FILE_PREFIX = 'file__';
const MAX_FILES = 4;
const BAD_TYPE = 'Unsupported image type. Only JPG, PNG and WEBP are allowed.';

function settingKeyFor(fieldname) {
  if (typeof fieldname !== 'string' || !fieldname.startsWith(FILE_PREFIX)) return null;
  const key = fieldname.slice(FILE_PREFIX.length);
  return IMAGE_KEYS.includes(key) ? key : null;
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    try {
      cb(null, ensureSiteDir());
    } catch (err) {
      cb(err);
    }
  },
  filename(req, file, cb) {
    try {
      cb(null, buildFilename(path.extname(file.originalname).toLowerCase()));
    } catch (err) {
      cb(err);
    }
  },
});

const multerUpload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_FILES },
  fileFilter(req, file, cb) {
    if (!settingKeyFor(file.fieldname)) return cb(new Error('Unexpected file field.'));
    // An empty file input (no file chosen) is dropped by multer before this
    // point. A real file that fails here surfaces a visible error instead of
    // silently saving the rest of the form as if nothing was uploaded.
    if (!isAllowedFile(file.originalname, file.mimetype)) return cb(new Error(BAD_TYPE));
    cb(null, true);
  },
}).any();

function discard(files) {
  for (const file of files || []) {
    if (file && file.path) fs.unlink(file.path, () => {});
  }
}

// Normalises req.files (array) into { settingKey: file } and arranges for any
// file the controller did not adopt (CSRF failure, validation error, ...) to
// be removed once the response is done, so rejected uploads never linger.
function indexFiles(req, res) {
  req.siteImages = {};
  for (const file of req.files || []) {
    const key = settingKeyFor(file.fieldname);
    if (key) req.siteImages[key] = file;
  }
  req.siteImagesAdopted = new Set();
  res.on('close', () => {
    discard((req.files || []).filter((f) => !req.siteImagesAdopted.has(f.path)));
  });
}

// `redirectTo` is a path or (req) => path; used for flash-and-redirect errors.
function uploadSiteImages(redirectTo) {
  const target = (req) => (typeof redirectTo === 'function' ? redirectTo(req) : redirectTo);
  return function (req, res, next) {
    multerUpload(req, res, (err) => {
      if (err) {
        discard(req.files);
        if (err.code === 'LIMIT_FILE_SIZE') req.flashError('Image is too large (max 5MB).');
        else if (err.code === 'LIMIT_FILE_COUNT') req.flashError('Too many images in one upload.');
        else req.flashError(err.message || 'Image upload failed.');
        return res.redirect(target(req));
      }

      indexFiles(req, res);

      // Extension + declared MIME passed; now verify the real file signature
      // so a renamed text/other file cannot be stored as an image.
      return Promise.all(
        Object.entries(req.siteImages).map(async ([key, file]) => {
          if (await imageStorage.rejectIfSpoofed(file)) return key;
          return null;
        })
      )
        .then((spoofed) => {
          const bad = spoofed.filter(Boolean);
          if (bad.length === 0) return next();
          req.flashError('The uploaded file is not a valid JPG, PNG or WEBP image.');
          return res.redirect(target(req));
        })
        .catch(next);
    });
  };
}

module.exports = { uploadSiteImages, settingKeyFor, FILE_PREFIX };
