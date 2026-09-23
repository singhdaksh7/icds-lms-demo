const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  isAllowedVideoFile,
  buildVideoPath,
  MAX_UPLOAD_BYTES,
} = require('../src/lib/videoStorage');

// --- extension / MIME validation (isAllowedVideoFile) -----------------------
// This is the pure function multer's fileFilter/destination call for every
// admin lesson-video upload — see src/middleware/videoUpload.middleware.js.

test('isAllowedVideoFile accepts a valid MP4 with a matching MIME type', () => {
  assert.equal(isAllowedVideoFile('lesson-1.mp4', 'video/mp4'), true);
});

test('isAllowedVideoFile accepts a valid WEBM with a matching MIME type', () => {
  assert.equal(isAllowedVideoFile('lesson-1.webm', 'video/webm'), true);
});

test('isAllowedVideoFile accepts an unclear browser MIME type (application/octet-stream) for an allowed extension', () => {
  assert.equal(isAllowedVideoFile('lesson-1.mp4', 'application/octet-stream'), true);
});

test('isAllowedVideoFile rejects a disallowed extension (e.g. .mov, .exe, .php)', () => {
  assert.equal(isAllowedVideoFile('lesson-1.mov', 'video/quicktime'), false);
  assert.equal(isAllowedVideoFile('lesson-1.exe', 'application/octet-stream'), false);
  assert.equal(isAllowedVideoFile('lesson-1.php', 'application/octet-stream'), false);
});

test('isAllowedVideoFile rejects an extension/MIME mismatch', () => {
  assert.equal(isAllowedVideoFile('lesson-1.mp4', 'image/jpeg'), false);
});

test('isAllowedVideoFile rejects a spoofed double extension', () => {
  assert.equal(isAllowedVideoFile('lesson.mp4.exe', 'video/mp4'), false);
  assert.equal(isAllowedVideoFile('lesson.mp4.php', 'video/mp4'), false);
});

test('isAllowedVideoFile rejects missing/invalid filenames', () => {
  assert.equal(isAllowedVideoFile('', 'video/mp4'), false);
  assert.equal(isAllowedVideoFile(undefined, 'video/mp4'), false);
  assert.equal(isAllowedVideoFile('noextension', 'video/mp4'), false);
});

// --- size limit ---------------------------------------------------------
// Multer is configured with `limits: { fileSize: MAX_UPLOAD_BYTES }` in
// videoUpload.middleware.js — an oversized upload never reaches disk and
// multer surfaces it as a LIMIT_FILE_SIZE error, which the controller turns
// into a flash-message redirect (not a raw 500). We can't spin up a real
// HTTP upload here without a DB-backed server, so we assert the configured
// ceiling itself is sane and matches what the admin-facing copy claims.
test('MAX_UPLOAD_BYTES is a sane, non-zero limit (200MB)', () => {
  assert.equal(MAX_UPLOAD_BYTES, 200 * 1024 * 1024);
  assert.ok(MAX_UPLOAD_BYTES > 0);
});

// --- lesson stores only a safe relative path, never an absolute path -------

test('buildVideoPath never returns an absolute filesystem path', () => {
  const relativePath = buildVideoPath('intro-to-js', '.mp4');
  assert.equal(path.isAbsolute(relativePath), false);
  assert.ok(!relativePath.includes(':\\')); // no Windows drive letter
  assert.ok(!relativePath.startsWith('/')); // no POSIX absolute path
});

test('buildVideoPath output shape is exactly "<courseSlug>/<uuid>.<ext>"', () => {
  const relativePath = buildVideoPath('intro-to-js', '.mp4');
  const parts = relativePath.split('/');
  assert.equal(parts.length, 2);
  assert.equal(parts[0], 'intro-to-js');
  assert.match(parts[1], /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/);
});

// --- traversal filename cannot escape storage root --------------------------
// Already covered thoroughly by tests/videoStorage.test.js
// (resolveVideoPath / findExistingFile) — not duplicated here.

// --- admin-only route guard --------------------------------------------------
// A full HTTP request needs a live DB-backed server (out of scope per this
// repo's test harness), so we assert at the source level that every lesson
// and lesson-video route is registered after the blanket
// `router.use(requireRole('ADMIN'))` guard in admin.routes.js — i.e. it is
// structurally impossible for a non-admin request to reach the video upload
// controller.
test('admin.routes.js applies requireRole("ADMIN") before any lesson video route', () => {
  const routesSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'admin.routes.js'),
    'utf8'
  );
  const guardIndex = routesSrc.indexOf("router.use(requireRole('ADMIN'))");
  assert.notEqual(guardIndex, -1, 'expected a blanket ADMIN role guard in admin.routes.js');

  const videoRoutePatterns = [
    "'/lessons/:id/video/upload'",
    "'/lessons/:id/video/register'",
    "'/lessons/:id/video/remove'",
    "'/courses/:courseId/lessons'",
  ];
  for (const pattern of videoRoutePatterns) {
    const routeIndex = routesSrc.indexOf(pattern);
    assert.ok(routeIndex > guardIndex, `${pattern} must be registered after the ADMIN guard`);
  }
});

test('admin.routes.js runs multer (video upload middleware) before CSRF protection on multipart routes', () => {
  const routesSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'admin.routes.js'),
    'utf8'
  );
  // Multer must parse the multipart body before doubleCsrfProtection can
  // read the _csrf field out of it — see videoUpload.middleware.js header
  // comment and the same pattern used for thumbnail uploads.
  const uploadRouteMatch = routesSrc.match(
    /uploadLessonVideo,\s*doubleCsrfProtection,\s*lessonController\.uploadLessonVideo/
  );
  assert.ok(uploadRouteMatch, 'video/upload route must run uploadLessonVideo (multer) before doubleCsrfProtection');

  const createRouteMatch = routesSrc.match(
    /uploadLessonVideoForCreate,\s*doubleCsrfProtection,\s*lessonController\.createLesson/
  );
  assert.ok(
    createRouteMatch,
    'lesson create route must run uploadLessonVideoForCreate (multer) before doubleCsrfProtection'
  );
});

// Regression test for the "Save Changes on an existing lesson always fails
// with 'Your session expired'" bug: the edit-lesson form is submitted as
// multipart/form-data (it's the same form-content.ejs template used for
// create, which has a file input), but the update route had no multer step
// at all — doubleCsrfProtection ran against an unparsed multipart body and
// could never find req.body._csrf. Fixed by running parseLessonUpdateFields
// (multer().none()) before doubleCsrfProtection, mirroring the create route.
test('admin.routes.js runs multer (parseLessonUpdateFields) before CSRF protection on the lesson update route', () => {
  const routesSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'admin.routes.js'),
    'utf8'
  );
  const updateRouteMatch = routesSrc.match(
    /'\/lessons\/:id',\s*parseLessonUpdateFields,\s*doubleCsrfProtection,\s*lessonController\.updateLesson/
  );
  assert.ok(
    updateRouteMatch,
    'lesson update route must run parseLessonUpdateFields (multer) before doubleCsrfProtection'
  );
});
