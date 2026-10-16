// Admin-only optional certificate PDF upload (field "certificatePdf").
// Extension + declared MIME + real "%PDF-" signature + size are all checked;
// the stored name is a server-generated UUID. A file the controller does not
// adopt (validation error, CSRF failure, ...) is deleted when the response
// closes, so rejected uploads never linger.
const fs = require('fs');
const multer = require('multer');
const storage_ = require('../lib/certificateStorage');

const BAD_TYPE = 'Only PDF files are allowed for the certificate.';

const storage = multer.diskStorage({
  destination(req, file, cb) {
    try {
      cb(null, storage_.ensureDir());
    } catch (err) {
      cb(err);
    }
  },
  filename(req, file, cb) {
    cb(null, storage_.buildFilename());
  },
});

const multerUpload = multer({
  storage,
  limits: { fileSize: storage_.MAX_UPLOAD_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    if (file.fieldname !== 'certificatePdf') return cb(new Error('Unexpected file field.'));
    if (!storage_.isAllowedFile(file.originalname, file.mimetype)) return cb(new Error(BAD_TYPE));
    cb(null, true);
  },
}).single('certificatePdf');

function uploadCertificatePdf(redirectTo) {
  return function (req, res, next) {
    multerUpload(req, res, async (err) => {
      if (err) {
        if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
        if (err.code === 'LIMIT_FILE_SIZE') req.flashError('The PDF is too large (max 10MB).');
        else req.flashError(err.message || 'Certificate upload failed.');
        return res.redirect(redirectTo);
      }

      if (req.file) {
        const storedPath = req.file.path;
        req.certificateFileAdopted = false;
        res.on('close', () => {
          if (!req.certificateFileAdopted) fs.unlink(storedPath, () => {});
        });
        if (!(await storage_.hasPdfSignature(storedPath))) {
          fs.unlink(storedPath, () => {});
          req.file = undefined;
          req.flashError('The uploaded file is not a valid PDF.');
          return res.redirect(redirectTo);
        }
      }
      return next();
    });
  };
}

module.exports = { uploadCertificatePdf };
