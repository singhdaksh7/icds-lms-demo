process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

// Must be set before imageStorage is first required (it reads the env at load).
const STORAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'icds-img-'));
process.env.THUMBNAIL_STORAGE_ROOT = STORAGE;

const express = require('express');
const imageStorage = require('../src/lib/imageStorage');
const { uploadSiteImage } = require('../src/middleware/siteImageUpload.middleware');
const { uploadThumbnail } = require('../src/middleware/thumbnailUpload.middleware');

// Tiny but genuine files for each allowed format.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
const FAKE_TEXT = Buffer.from('this is plain text pretending to be an image');

test('detectImageType recognises real JPEG, PNG and WebP signatures', () => {
  assert.equal(imageStorage.detectImageType(JPEG), 'image/jpeg');
  assert.equal(imageStorage.detectImageType(PNG), 'image/png');
  assert.equal(imageStorage.detectImageType(WEBP), 'image/webp');
});

test('detectImageType rejects text, empty, truncated and look-alike data', () => {
  assert.equal(imageStorage.detectImageType(FAKE_TEXT), null);
  assert.equal(imageStorage.detectImageType(Buffer.alloc(0)), null);
  assert.equal(imageStorage.detectImageType(Buffer.from([0xff, 0xd8])), null);
  assert.equal(imageStorage.detectImageType(Buffer.from('RIFFxxxxWAVE')), null); // RIFF but not WebP
  assert.equal(imageStorage.detectImageType(Buffer.from('GIF89a......')), null);
  assert.equal(imageStorage.detectImageType('not a buffer'), null);
});

test('signatureMatchesFilename requires the signature to agree with the extension', () => {
  assert.equal(imageStorage.signatureMatchesFilename(PNG, 'a.png'), true);
  assert.equal(imageStorage.signatureMatchesFilename(JPEG, 'a.JPG'), true);
  assert.equal(imageStorage.signatureMatchesFilename(JPEG, 'a.jpeg'), true);
  assert.equal(imageStorage.signatureMatchesFilename(WEBP, 'a.webp'), true);
  assert.equal(imageStorage.signatureMatchesFilename(PNG, 'a.jpg'), false); // renamed PNG
  assert.equal(imageStorage.signatureMatchesFilename(FAKE_TEXT, 'a.png'), false);
});

test('rejectIfSpoofed keeps a genuine image and deletes a fake one', async () => {
  const good = path.join(STORAGE, 'good.png');
  const bad = path.join(STORAGE, 'bad.png');
  fs.writeFileSync(good, PNG);
  fs.writeFileSync(bad, FAKE_TEXT);

  assert.equal(await imageStorage.rejectIfSpoofed({ path: good, originalname: 'photo.png' }), false);
  assert.ok(fs.existsSync(good));

  assert.equal(await imageStorage.rejectIfSpoofed({ path: bad, originalname: 'photo.png' }), true);
  assert.equal(fs.existsSync(bad), false);
});

// --- through the real upload middleware ------------------------------------

function appWith(middleware) {
  const app = express();
  const flashes = [];
  app.use((req, res, next) => { req.flashError = (m) => flashes.push(m); next(); });
  app.post('/upload', middleware('/back'), (req, res) => res.json({ stored: req.file ? req.file.filename : null }));
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, flashes, port: server.address().port })));
}

async function upload(port, field, buffer, filename, type) {
  const form = new FormData();
  form.append(field, new Blob([buffer], { type }), filename);
  return fetch(`http://127.0.0.1:${port}/upload`, { method: 'POST', body: form, redirect: 'manual' });
}

function siteFiles() {
  const dir = path.join(STORAGE, 'site');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

test('Why ICDS upload middleware: accepts real JPEG/PNG/WebP, rejects a text file named .png and stores nothing', async () => {
  const { server, flashes, port } = await appWith(uploadSiteImage);
  try {
    for (const [buf, name, type] of [[JPEG, 'a.jpg', 'image/jpeg'], [PNG, 'a.png', 'image/png'], [WEBP, 'a.webp', 'image/webp']]) {
      const res = await upload(port, 'whyIcdsImage', buf, name, type);
      assert.equal(res.status, 200, `${name} should be accepted`);
      assert.ok((await res.json()).stored);
    }
    const accepted = siteFiles().length;
    assert.equal(accepted, 3);

    const spoof = await upload(port, 'whyIcdsImage', FAKE_TEXT, 'evil.png', 'image/png');
    assert.equal(spoof.status, 302);
    assert.equal(spoof.headers.get('location'), '/back');
    assert.match(flashes.at(-1), /not a valid JPG, PNG or WEBP/i);
    assert.equal(siteFiles().length, accepted, 'spoofed file must not remain on disk');
  } finally {
    server.close();
  }
});

test('Thumbnail upload middleware: real PNG accepted, spoofed .jpg (PNG data) and text rejected', async () => {
  const { server, flashes, port } = await appWith(uploadThumbnail);
  try {
    const ok = await upload(port, 'thumbnail', PNG, 't.png', 'image/png');
    assert.equal(ok.status, 200);

    const before = fs.readdirSync(STORAGE).filter((f) => f !== 'site').length;
    const renamed = await upload(port, 'thumbnail', PNG, 't.jpg', 'image/jpeg');
    assert.equal(renamed.status, 302);
    const text = await upload(port, 'thumbnail', FAKE_TEXT, 't.webp', 'image/webp');
    assert.equal(text.status, 302);
    assert.equal(flashes.length, 2);
    assert.equal(fs.readdirSync(STORAGE).filter((f) => f !== 'site').length, before, 'rejected files are deleted');
  } finally {
    server.close();
  }
});

test('disallowed extensions and MIME mismatches are still rejected up front', async () => {
  const { server, flashes, port } = await appWith(uploadSiteImage);
  try {
    const txt = await upload(port, 'whyIcdsImage', FAKE_TEXT, 'a.txt', 'text/plain');
    assert.equal(txt.status, 302);
    const mime = await upload(port, 'whyIcdsImage', PNG, 'a.png', 'text/plain');
    assert.equal(mime.status, 302);
    assert.equal(flashes.length, 2);
  } finally {
    server.close();
  }
});
