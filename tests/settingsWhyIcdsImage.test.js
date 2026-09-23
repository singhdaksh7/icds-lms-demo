const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateSettings, SAFE_CTA_TARGETS } = require('../src/validators/settings.validator');
const {
  isAllowedFile,
  MAX_UPLOAD_BYTES,
  siteImagePublicUrl,
  resolveSiteImagePath,
} = require('../src/lib/imageStorage');

// --- settings text/CTA validation --------------------------------------

test('validateSettings accepts a valid Why ICDS text update', () => {
  const { errors, values } = validateSettings({
    'why.heading': 'A new heading',
    'why.description': 'A new description.',
    'why.ctaTarget': '#instructors',
    'process.heading': 'Existing process heading',
  });
  assert.equal(errors.length, 0);
  assert.equal(values['why.heading'], 'A new heading');
  assert.equal(values['why.ctaTarget'], '#instructors');
});

test('validateSettings rejects an unsafe CTA target and falls back to a safe default', () => {
  const { errors, values } = validateSettings({
    'why.heading': 'Heading',
    'why.ctaTarget': 'javascript:alert(1)',
    'process.heading': 'Process heading',
  });
  assert.ok(errors.some((e) => /CTA target/.test(e)));
  // Falls back to the whitelist's own default rather than persisting the
  // unsafe value.
  assert.ok(SAFE_CTA_TARGETS.includes(values['why.ctaTarget']));
  assert.equal(values['why.ctaTarget'], '#courses');
});

test('validateSettings accepts every whitelisted CTA target', () => {
  for (const target of SAFE_CTA_TARGETS) {
    const { errors, values } = validateSettings({
      'why.heading': 'Heading',
      'why.ctaTarget': target,
      'process.heading': 'Process heading',
    });
    assert.equal(errors.length, 0);
    assert.equal(values['why.ctaTarget'], target);
  }
});

// --- image upload validation (reuses the shared image-storage helper, the
// same one thumbnailUpload.middleware.js and siteImageUpload.middleware.js
// both wire into multer's fileFilter/destination) -----------------------

test('isAllowedFile accepts a valid JPG/PNG/WEBP with a matching MIME type', () => {
  assert.equal(isAllowedFile('photo.jpg', 'image/jpeg'), true);
  assert.equal(isAllowedFile('photo.jpeg', 'image/jpeg'), true);
  assert.equal(isAllowedFile('photo.png', 'image/png'), true);
  assert.equal(isAllowedFile('photo.webp', 'image/webp'), true);
});

test('isAllowedFile rejects a disallowed extension', () => {
  assert.equal(isAllowedFile('photo.gif', 'image/gif'), false);
  assert.equal(isAllowedFile('photo.svg', 'image/svg+xml'), false);
  assert.equal(isAllowedFile('script.php', 'application/octet-stream'), false);
});

test('isAllowedFile rejects an extension/MIME mismatch', () => {
  assert.equal(isAllowedFile('photo.jpg', 'image/png'), false);
});

test('MAX_UPLOAD_BYTES enforces a 5MB ceiling for the Why ICDS image upload', () => {
  assert.equal(MAX_UPLOAD_BYTES, 5 * 1024 * 1024);
  assert.ok(MAX_UPLOAD_BYTES > 0);
});

// --- site image path shape (why.imagePath) ------------------------------

test('siteImagePublicUrl only accepts the "site/<uuid>.<ext>" shape and never returns an absolute path', () => {
  const uuid = '11111111-2222-3333-4444-555555555555';
  const url = siteImagePublicUrl(`site/${uuid}.webp`);
  assert.equal(url, `/uploads/thumbnails/site/${uuid}.webp`);
});

test('siteImagePublicUrl rejects a traversal or absolute-path attempt', () => {
  assert.equal(siteImagePublicUrl('../../etc/passwd'), null);
  assert.equal(siteImagePublicUrl('site/../../../secret.jpg'), null);
  assert.equal(siteImagePublicUrl('C:\\Windows\\evil.jpg'), null);
  assert.equal(siteImagePublicUrl('/etc/passwd'), null);
  assert.equal(siteImagePublicUrl('site/not-a-uuid.jpg'), null);
});

test('resolveSiteImagePath stays within the site/ subfolder of the storage root', () => {
  const uuid = '11111111-2222-3333-4444-555555555555';
  const full = resolveSiteImagePath(`site/${uuid}.png`);
  assert.ok(full);
  assert.ok(full.includes(path.join('site', `${uuid}.png`)));
  assert.equal(resolveSiteImagePath('site/../evil.png'), null);
});

// --- multipart + CSRF ordering on the settings route ---------------------

test('admin.routes.js runs the site-image multer middleware before CSRF protection on /settings', () => {
  const routesSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'admin.routes.js'),
    'utf8'
  );
  const guardIndex = routesSrc.indexOf("router.use(requireRole('ADMIN'))");
  assert.notEqual(guardIndex, -1);

  const match = routesSrc.match(
    /'\/settings',\s*uploadSiteImage\([^)]*\),\s*doubleCsrfProtection,\s*settingsController\.updateSettingsAction/
  );
  assert.ok(
    match,
    'POST /settings must run uploadSiteImage (multer) before doubleCsrfProtection, ' +
      'mirroring the already-correct thumbnail/video upload route ordering'
  );
  assert.ok(routesSrc.indexOf(match[0]) > guardIndex, '/settings route must be registered after the ADMIN guard');
});
