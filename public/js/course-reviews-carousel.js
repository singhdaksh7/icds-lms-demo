/*
 * Course landing reviews carousel: scroll-snap track + arrows + dots + slow
 * autoplay. Progressive enhancement - without JS the track is a normal
 * horizontally scrollable, swipeable row. Autoplay is slow, pauses on hover /
 * focus / touch / drag and is disabled for prefers-reduced-motion.
 */
(function () {
  'use strict';
  var INTERVAL_MS = 6500;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.querySelectorAll('[data-reviews-carousel]').forEach(function (root) {
    var viewport = root.querySelector('.reviews-viewport');
    var track = root.querySelector('.reviews-track');
    var prev = root.querySelector('.reviews-prev');
    var next = root.querySelector('.reviews-next');
    var dotsBox = root.querySelector('.reviews-dots');
    if (!viewport || !track) return;
    var cards = Array.prototype.slice.call(track.children);
    var timer = null;
    var paused = false;

    function perView() {
      var first = cards[0];
      if (!first) return 1;
      return Math.max(1, Math.round(viewport.clientWidth / first.getBoundingClientRect().width));
    }
    function pages() { return Math.max(1, Math.ceil(cards.length / perView())); }
    function overflow() { return track.scrollWidth - viewport.clientWidth > 4; }
    function stepWidth() {
      return cards.length > 1 ? cards[1].offsetLeft - cards[0].offsetLeft : viewport.clientWidth;
    }
    function currentPage() {
      var max = track.scrollWidth - viewport.clientWidth;
      if (max <= 0) return 0;
      return Math.min(pages() - 1, Math.round((viewport.scrollLeft / max) * (pages() - 1)));
    }

    function buildDots() {
      if (!dotsBox) return;
      dotsBox.innerHTML = '';
      var n = pages();
      for (var i = 0; i < n; i++) {
        (function (index) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'reviews-dot';
          b.setAttribute('aria-label', 'Go to review page ' + (index + 1) + ' of ' + n);
          b.addEventListener('click', function () { goTo(index); });
          dotsBox.appendChild(b);
        })(i);
      }
    }

    function sync() {
      var scrollable = overflow();
      if (prev) prev.hidden = !scrollable;
      if (next) next.hidden = !scrollable;
      if (dotsBox) {
        dotsBox.hidden = !scrollable;
        var cp = currentPage();
        Array.prototype.forEach.call(dotsBox.children, function (d, i) {
          d.classList.toggle('is-active', i === cp);
          if (i === cp) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current');
        });
      }
      var atStart = viewport.scrollLeft <= 2;
      var atEnd = viewport.scrollLeft >= track.scrollWidth - viewport.clientWidth - 2;
      if (prev) prev.disabled = atStart;
      if (next) next.disabled = atEnd;
    }

    function goTo(page) {
      var max = track.scrollWidth - viewport.clientWidth;
      var target = pages() > 1 ? (max * page) / (pages() - 1) : 0;
      viewport.scrollTo({ left: target, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
    function by(dir) {
      viewport.scrollBy({ left: dir * stepWidth() * perView(), behavior: reduceMotion ? 'auto' : 'smooth' });
    }

    function tick() {
      if (paused || !overflow()) return;
      var atEnd = viewport.scrollLeft >= track.scrollWidth - viewport.clientWidth - 2;
      if (atEnd) viewport.scrollTo({ left: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      else by(1);
    }
    function start() {
      if (reduceMotion || root.getAttribute('data-rotate') !== 'true' || timer) return;
      timer = setInterval(tick, INTERVAL_MS);
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }

    if (prev) prev.addEventListener('click', function () { paused = true; by(-1); });
    if (next) next.addEventListener('click', function () { paused = true; by(1); });
    viewport.addEventListener('scroll', function () { window.requestAnimationFrame(sync); }, { passive: true });
    viewport.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); paused = true; by(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); paused = true; by(-1); }
    });

    // Pause while the visitor is interacting; resume shortly after they leave.
    ['mouseenter', 'focusin', 'touchstart', 'pointerdown'].forEach(function (ev) {
      root.addEventListener(ev, function () { paused = true; });
    });
    ['mouseleave', 'focusout'].forEach(function (ev) {
      root.addEventListener(ev, function () { paused = false; });
    });
    document.addEventListener('visibilitychange', function () { paused = document.hidden; });

    // Mouse drag to scroll (touch already scrolls natively).
    var down = false, startX = 0, startLeft = 0;
    viewport.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse') return;
      down = true; startX = e.clientX; startLeft = viewport.scrollLeft;
      viewport.classList.add('is-dragging');
    });
    window.addEventListener('pointermove', function (e) {
      if (!down) return;
      viewport.scrollLeft = startLeft - (e.clientX - startX);
    });
    window.addEventListener('pointerup', function () {
      if (!down) return;
      down = false; viewport.classList.remove('is-dragging');
    });

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { buildDots(); sync(); }, 120);
    });

    buildDots();
    sync();
    start();
  });
})();
