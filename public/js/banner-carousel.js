/* Home banner carousel. Vanilla, CSP-safe (no inline handlers), data-attribute driven. */
(function () {
  'use strict';
  var root = document.querySelector('[data-banner-carousel]');
  if (!root) return;
  var slides = Array.prototype.slice.call(root.querySelectorAll('[data-banner-slide]'));
  if (slides.length < 2) return;
  var track = root.querySelector('[data-banner-track]');
  var dots = Array.prototype.slice.call(root.querySelectorAll('[data-banner-dot]'));
  var interval = parseInt(root.getAttribute('data-autoplay'), 10) || 5000;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var index = 0, timer = null, hoverOrFocus = false, touching = false;

  function show(n) {
    index = (n + slides.length) % slides.length;
    slides.forEach(function (s, i) {
      var on = i === index;
      s.classList.toggle('is-active', on);
      if (on) s.removeAttribute('aria-hidden'); else s.setAttribute('aria-hidden', 'true');
      Array.prototype.forEach.call(s.querySelectorAll('a'), function (a) {
        if (on) a.removeAttribute('tabindex'); else a.setAttribute('tabindex', '-1');
      });
    });
    dots.forEach(function (d, i) {
      d.classList.toggle('is-active', i === index);
      if (i === index) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current');
    });
  }
  function live() { track.setAttribute('aria-live', timer ? 'off' : 'polite'); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } live(); }
  function start() {
    if (reduce || timer || hoverOrFocus || touching || document.hidden) return;
    timer = setInterval(function () { show(index + 1); }, interval);
    live();
  }
  function go(n) { show(n); stop(); start(); }

  var prev = root.querySelector('[data-banner-prev]');
  var next = root.querySelector('[data-banner-next]');
  if (prev) prev.addEventListener('click', function () { go(index - 1); });
  if (next) next.addEventListener('click', function () { go(index + 1); });
  dots.forEach(function (d) {
    d.addEventListener('click', function () { go(parseInt(d.getAttribute('data-banner-dot'), 10) || 0); });
  });

  root.addEventListener('mouseenter', function () { hoverOrFocus = true; stop(); });
  root.addEventListener('mouseleave', function () { hoverOrFocus = false; start(); });
  root.addEventListener('focusin', function () { hoverOrFocus = true; stop(); });
  root.addEventListener('focusout', function () {
    setTimeout(function () { if (!root.contains(document.activeElement)) { hoverOrFocus = false; start(); } }, 0);
  });
  root.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });

  // Swipe (pointer events cover touch + mouse drag)
  var startX = null, startY = 0;
  root.addEventListener('pointerdown', function (e) {
    if (e.target.closest('a,button')) return;
    startX = e.clientX; startY = e.clientY; touching = true; stop();
  });
  root.addEventListener('pointerup', function (e) {
    if (startX === null) return;
    var dx = e.clientX - startX, dy = e.clientY - startY;
    startX = null; touching = false;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? index + 1 : index - 1); else start();
  });
  root.addEventListener('pointercancel', function () { startX = null; touching = false; start(); });

  start();
})();
