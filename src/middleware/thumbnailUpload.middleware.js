// Admin-only course/instructor thumbnail upload. Same safety pattern as
// videoUpload.middleware.js: validates extension AND declared MIME type
// against a fixed whitelist, writes via multer's diskStorage, and always
// generates a random filename — the original uploaded filename is never
// used for anything beyond reporting errors.
const multer = require('multer');

const {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  ensureDir,
  isAllowedFile,
  buildFilename,
} = require('../lib/imageStorage');

const storage = multer.diskStorage({
  destination(req, file, cb) {
    try {
      if (!isAllowedFile(file.originalname, file.mimetype)) {
        return cb(new Error('Unsupported image type. Only JPG, PNG and WEBP are allowed.'));
      }
      cb(null, ensureDir());
    } catch (err) {
      cb(err);
    }
  },
  filename(req, file, cb) {
    try {
      const path = require('path');
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
}).single('thumbnail');

// Translates multer's errors into a normal flash-message redirect instead of
// a raw 500. `redirectTo` lets callers send the admin back to the right form
// on failure.
function uploadThumbnail(redirectTo) {
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

module.exports = { uploadThumbnail, ALLOWED_IMAGE_TYPES };
