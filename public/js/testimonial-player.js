/* Testimonial video modal player (course page + homepage).
 *
 * Cards expose <button data-testimonial-video data-kind="hosted|embed" data-id data-embed data-title>.
 * - hosted: asks /api/testimonials/:id/video-source for a short-lived signed URL, then plays it in a
 *   native <video controls>. The R2 object key never reaches the browser.
 * - embed:  YouTube/Vimeo embed URL that the server already built from an approved link.
 * Nothing autoplays: the viewer presses play. Escape / backdrop / close button dismiss the dialog
 * and stop playback. */
(function () {
  'use strict';
  if (window.__testimonialPlayerReady) return;
  window.__testimonialPlayerReady = true;

  var overlay = null;
  var lastFocus = null;

  function close() {
    if (!overlay) return;
    var v = overlay.querySelector('video');
    if (v) { try { v.pause(); } catch (e) { /* ignore */ } v.removeAttribute('src'); v.load(); }
    var f = overlay.querySelector('iframe');
    if (f) f.removeAttribute('src');
    overlay.parentNode.removeChild(overlay);
    overlay = null;
    document.removeEventListener('keydown', onKey, true);
    document.documentElement.classList.remove('tv-modal-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab' && overlay) {
      var f = overlay.querySelectorAll('button, [href], video, iframe, [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function build(title) {
    overlay = document.createElement('div');
    overlay.className = 'tv-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Video review from ' + title);
    var box = document.createElement('div');
    box.className = 'tv-modal-box';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tv-modal-close';
    btn.setAttribute('aria-label', 'Close video');
    btn.innerHTML = '&times;';
    btn.addEventListener('click', close);
    var stage = document.createElement('div');
    stage.className = 'tv-modal-stage';
    box.appendChild(btn);
    box.appendChild(stage);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    document.documentElement.classList.add('tv-modal-open');
    document.addEventListener('keydown', onKey, true);
    btn.focus();
    return stage;
  }

  function message(stage, text) {
    stage.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'tv-modal-msg';
    p.textContent = text;
    stage.appendChild(p);
  }

  function open(trigger) {
    var kind = trigger.getAttribute('data-kind');
    var title = trigger.getAttribute('data-title') || 'learner';
    lastFocus = trigger;
    if (overlay) close();
    var stage = build(title);

    if (kind === 'embed') {
      var src = trigger.getAttribute('data-embed') || '';
      if (!/^https:\/\/(www\.youtube\.com\/embed\/|player\.vimeo\.com\/video\/)[A-Za-z0-9_-]+$/.test(src)) {
        return message(stage, 'This video is unavailable.');
      }
      var iframe = document.createElement('iframe');
      iframe.src = src;
      iframe.title = 'Video review from ' + title;
      iframe.allow = 'encrypted-media; picture-in-picture; fullscreen';
      iframe.setAttribute('allowfullscreen', '');
      iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      stage.appendChild(iframe);
      return undefined;
    }

    var id = trigger.getAttribute('data-id');
    message(stage, 'Loading video…');
    fetch('/api/testimonials/' + encodeURIComponent(id) + '/video-source', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('unavailable'); return r.json(); })
      .then(function (data) {
        if (!overlay || !data || typeof data.url !== 'string' || data.url.indexOf('https://') !== 0) throw new Error('bad');
        stage.innerHTML = '';
        var video = document.createElement('video');
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.setAttribute('controlslist', 'nodownload');
        var source = document.createElement('source');
        source.src = data.url;
        source.type = data.mimeType === 'video/webm' ? 'video/webm' : 'video/mp4';
        video.appendChild(source);
        stage.appendChild(video);
        video.focus();
      })
      .catch(function () { if (overlay) message(stage, 'This video is unavailable right now.'); });
    return undefined;
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-testimonial-video]') : null;
    if (t) { e.preventDefault(); open(t); }
  });
})();
