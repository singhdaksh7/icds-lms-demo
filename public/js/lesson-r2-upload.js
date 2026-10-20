/*
 * Admin: direct browser -> Cloudflare R2 multipart upload for lesson videos.
 *
 * ICDS authorizes the upload and hands out short-lived presigned URLs per part;
 * the video bytes go straight from this browser to R2 (not through the VPS or
 * its proxy), so multi-GB files don't time out. R2 credentials never reach the
 * browser. Needs the bucket CORS policy to allow PUT from this site and to
 * expose the ETag header (see README "Cloudflare R2 Video Storage").
 *
 * Progressive enhancement: without JS the form falls back to the normal
 * server-streamed upload.
 */
(function () {
  var form = document.querySelector('form[data-r2-direct]');
  if (!form) return;
  var lessonId = form.getAttribute('data-r2-direct');
  var csrf = form.querySelector('input[name="_csrf"]').value;
  var input = form.querySelector('input[type="file"]');
  var button = form.querySelector('button[type="submit"]');
  var status = document.createElement('div');
  status.className = 'small mt-2';
  form.appendChild(status);
  var base = '/admin/lessons/' + lessonId + '/video/r2/';
  var CONCURRENCY = 3;
  var RETRIES = 4;

  function api(path, payload) {
    payload._csrf = csrf;
    return fetch(base + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'Server error' }; }).then(function (j) {
        if (!r.ok || !j.ok) throw new Error(j.error || 'Request failed (' + r.status + ')');
        return j;
      });
    });
  }

  function putPart(url, blob) {
    return fetch(url, { method: 'PUT', body: blob }).then(function (r) {
      if (!r.ok) throw new Error('part upload ' + r.status);
      var etag = r.headers.get('ETag');
      if (!etag) throw new Error('R2 did not expose the ETag - check the bucket CORS policy.');
      return etag;
    });
  }

  function withRetry(fn) {
    var attempt = 0;
    function run() {
      return fn().catch(function (err) {
        attempt += 1;
        if (attempt > RETRIES) throw err;
        return new Promise(function (res) { setTimeout(res, 800 * attempt); }).then(run);
      });
    }
    return run();
  }

  form.addEventListener('submit', function (ev) {
    var file = input.files && input.files[0];
    if (!file) return;
    ev.preventDefault();
    button.disabled = true;
    input.disabled = true;
    var done = 0;
    var session;
    var parts = [];

    function show(msg, bad) {
      status.textContent = msg;
      status.className = 'small mt-2 ' + (bad ? 'text-danger' : 'text-success');
    }

    api('start', { filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size })
      .then(function (s) {
        session = s;
        var numbers = [];
        for (var i = 1; i <= s.partCount; i += 1) numbers.push(i);
        var next = 0;

        function worker() {
          if (next >= numbers.length) return Promise.resolve();
          var batch = numbers.slice(next, next + 1);
          next += 1;
          var n = batch[0];
          var blob = file.slice((n - 1) * s.partSize, Math.min(n * s.partSize, file.size));
          return withRetry(function () {
            return api('part-urls', { key: s.key, uploadId: s.uploadId, token: s.token, size: file.size, partNumbers: [n] })
              .then(function (u) { return putPart(u.urls[n], blob); });
          }).then(function (etag) {
            parts.push({ PartNumber: n, ETag: etag });
            done += blob.size;
            show('Uploading to Cloudflare R2: ' + Math.floor((done / file.size) * 100) + '%');
          }).then(worker);
        }
        var workers = [];
        for (var w = 0; w < Math.min(CONCURRENCY, numbers.length); w += 1) workers.push(worker());
        return Promise.all(workers);
      })
      .then(function () {
        show('Finalizing...');
        return api('complete', { key: session.key, uploadId: session.uploadId, token: session.token, size: file.size, parts: parts });
      })
      .then(function (r) { window.location.href = r.redirect; })
      .catch(function (err) {
        show('Upload failed: ' + err.message, true);
        if (session) api('abort', { key: session.key, uploadId: session.uploadId, token: session.token, size: file.size }).catch(function () {});
        button.disabled = false;
        input.disabled = false;
      });
  });
})();
