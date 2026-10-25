/* Homepage intro / promo video.
 *
 * Nothing plays with sound on its own: the poster is shown and the visitor presses play (which
 * is a user gesture, so sound is allowed). The only automatic playback is the Admin-enabled
 * "autoplay muted" option, which is always MUTED and is skipped for visitors who prefer reduced
 * motion, have data-saver on, or are on a small screen.
 *
 * - hosted: asks /api/home/intro-video/source for a short-lived signed URL (the R2 object key
 *   never reaches the browser) and plays it in a native <video>.
 * - embed:  YouTube / Vimeo embed URL that the server already built from an approved link;
 *   re-checked against an origin allowlist before it is ever put in an iframe. */
(function () {
  'use strict';

  var EMBED_ORIGINS = ['https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com'];

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function saveData() {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return Boolean(c && c.saveData);
  }
  function smallScreen() {
    return window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
  }

  function showMessage(card, text) {
    var p = document.createElement('p');
    p.className = 'intro-reel-msg';
    p.setAttribute('role', 'status');
    p.textContent = text;
    card.appendChild(p);
  }

  function embedSrc(card, muted) {
    var raw = card.getAttribute('data-embed') || '';
    var u;
    try { u = new URL(raw); } catch (e) { return null; }
    if (EMBED_ORIGINS.indexOf(u.origin) === -1) return null;
    var provider = card.getAttribute('data-provider');
    var loop = card.getAttribute('data-loop') === '1';
    u.searchParams.set('autoplay', '1');
    if (muted) u.searchParams.set(provider === 'vimeo' ? 'muted' : 'mute', '1');
    if (provider === 'youtube') {
      u.searchParams.set('playsinline', '1');
      u.searchParams.set('rel', '0');
      if (loop) { u.searchParams.set('loop', '1'); u.searchParams.set('playlist', u.pathname.split('/').pop()); }
    } else if (loop) {
      u.searchParams.set('loop', '1');
    }
    return u.toString();
  }

  function buildMuteButton(video) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'intro-reel-mute';
    function sync() {
      b.setAttribute('aria-pressed', video.muted ? 'true' : 'false');
      b.setAttribute('aria-label', video.muted ? 'Unmute video' : 'Mute video');
      b.innerHTML = '<i class="bi ' + (video.muted ? 'bi-volume-mute-fill' : 'bi-volume-up-fill') + '" aria-hidden="true"></i>';
    }
    b.addEventListener('click', function () { video.muted = !video.muted; sync(); });
    video.addEventListener('volumechange', sync);
    sync();
    return b;
  }

  function start(card, opts) {
    if (card.getAttribute('data-started') === '1') return;
    card.setAttribute('data-started', '1');
    var muted = Boolean(opts && opts.muted);
    var kind = card.getAttribute('data-kind');
    var title = card.getAttribute('data-title') || 'Intro video';
    var trigger = card.querySelector('[data-intro-reel-play]');

    if (kind === 'embed') {
      var src = embedSrc(card, muted);
      if (!src) { card.removeAttribute('data-started'); showMessage(card, 'Video unavailable.'); return; }
      var frame = document.createElement('iframe');
      frame.src = src;
      frame.title = title;
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      frame.setAttribute('allowfullscreen', '');
      frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      card.appendChild(frame);
      if (trigger) trigger.hidden = true;
      return;
    }

    var url = card.getAttribute('data-source-url');
    if (!url) { card.removeAttribute('data-started'); return; }
    if (trigger) trigger.setAttribute('aria-busy', 'true');
    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('unavailable'); return r.json(); })
      .then(function (d) {
        if (!d || !d.url) throw new Error('unavailable');
        var v = document.createElement('video');
        v.setAttribute('playsinline', '');
        v.setAttribute('controlsList', 'nodownload noremoteplayback');
        v.controls = true;
        v.preload = 'auto';
        v.muted = muted;
        v.loop = card.getAttribute('data-loop') === '1';
        v.setAttribute('aria-label', title);
        var s = document.createElement('source');
        s.src = d.url;
        s.type = d.mimeType || 'video/mp4';
        v.appendChild(s);
        card.appendChild(v);
        card.appendChild(buildMuteButton(v));
        if (trigger) trigger.hidden = true;
        var p = v.play();
        if (p && p.catch) p.catch(function () { /* blocked: the native controls let the visitor start it */ });
      })
      .catch(function () {
        card.removeAttribute('data-started');
        if (trigger) trigger.removeAttribute('aria-busy');
        showMessage(card, 'This video is unavailable right now.');
      });
  }

  function init(card) {
    var trigger = card.querySelector('[data-intro-reel-play]');
    if (trigger) trigger.addEventListener('click', function () { start(card, { muted: false }); });

    // Optional Admin-enabled muted autoplay (never with sound).
    if (card.getAttribute('data-muted-start') === '1' && 'IntersectionObserver' in window
        && !reducedMotion() && !saveData() && !smallScreen()) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) {
            io.disconnect();
            start(card, { muted: true });
          }
        });
      }, { threshold: [0.6] });
      io.observe(card);
    }
  }

  function boot() {
    var cards = document.querySelectorAll('[data-intro-reel]');
    for (var i = 0; i < cards.length; i += 1) init(cards[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
