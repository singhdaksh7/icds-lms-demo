// Admin-only site image upload (currently: the homepage "Why ICDS" section
// image). Same safety pattern as thumbnailUpload.middleware.js — validates
// extension AND declared MIME type against the shared image whitelist,
// writes via multer's diskStorage into the "site/" subfolder of the same
// thumbnail storage root, and always generates a random filename. The
// upload is OPTIONAL: the settings form submits with or without a file, so
// this middleware must not error when no file is attached.
const path = require('path');
const multer = require('multer');

const {
  MAX_UPLOAD_BYTES,
  ensureSiteDir,
  isAllowedFile,
  buildFilename,
} = require('../lib/imageStorage');

const storage = multer.diskStorage({
  destination(req, file, cb) {
    try {
      if (!isAllowedFile(file.originalname, file.mimetype)) {
        return cb(new Error('Unsupported image type. Only JPG, PNG and WEBP are allowed.'));
      }
      cb(null, ensureSiteDir());
    } catch (err) {
      cb(err);
    }
  },
  filename(req, file, cb) {
    try {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, buildFilename(ext));
    } catch (err) {
      cb(err);
    }
  },
});

const multerUpload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    cb(null, isAllowedFile(file.originalname, file.mimetype));
  },
}).single('whyIcdsImage');

// Translates multer's errors into a normal flash-message redirect instead of
// a raw 500. `redirectTo` lets callers send the admin back to the right
// form on failure. When no file is selected at all, multer simply calls
// next() with req.file left undefined — that's the expected "keep the
// current image" case, not an error.
function uploadSiteImage(redirectTo) {
  return function (req, res, next) {
    multerUpload(req, res, (err) => {
      if (!err) {
        return next();
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        req.flashError('Image is too large (max 5MB).');
      } else {
        req.flashError(err.message || 'Image upload failed.');
      }
      res.redirect(typeof redirectTo === 'function' ? redirectTo(req) : redirectTo);
    });
  };
}

module.exports = { uploadSiteImage };
