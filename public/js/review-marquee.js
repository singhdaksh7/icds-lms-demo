/*
 * Review marquee: slow, continuous, seamless horizontal motion for review carousels.
 *
 *   ReviewMarquee.init({ root, viewport, track, prev, next, dots, seconds, direction, gap, visible })
 *
 * - Continuous (not wait-and-jump): requestAnimationFrame moves the track by a sub-pixel transform at
 *   `setWidth / seconds` px/s (clamped to a calm range). `seconds` comes from the Admin speed preset.
 * - Seamless: the original cards are cloned enough times to cover the viewport, and the offset wraps by
 *   exactly one set width, so there is never a visible reset.
 * - Direction (Admin): 'rtl' = cards travel right-to-left, 'ltr' = left-to-right.
 * - Pauses (and resumes gently with an eased ramp) on mouse hover, keyboard focus inside, dragging/swiping,
 *   an open review-video modal, a hidden tab and when the carousel is off-screen.
 * - Arrows glide one card; drag/swipe works with mouse, touch and pen (vertical page scroll stays native).
 * - Clones are aria-hidden and their focusable children get tabindex=-1, so keyboard / screen-reader users
 *   meet each review once. Clones stay clickable so a visible video card always opens the modal.
 * - Not started for prefers-reduced-motion (callers fall back to their static/swipeable layout).
 */
(function () {
  'use strict';

  var MIN_SPEED = 18;  // px per second
  var MAX_SPEED = 80;
  var FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

  function reduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function canHover() {
    return window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function init(opts) {
    var root = opts.root;
    var viewport = opts.viewport;
    var track = opts.track;
    if (!root || !viewport || !track || reduced()) return null;
    var originals = Array.prototype.slice.call(track.children);
    if (!originals.length) return null;

    var seconds = clamp(Number(opts.seconds) || 32, 10, 120);
    var dirSign = opts.direction === 'ltr' ? -1 : 1; // +1: offset grows => cards move left
    var visible = opts.visible || { desktop: 2.75, tablet: 2.15, mobile: 1.12 };
    var gap = Number(opts.gap) || 0;

    var offset = 0;          // px into the first set
    var setWidth = 0;
    var speed = 0;           // px per second
    var factor = 0;          // eased 0..1 motion multiplier
    var last = 0;
    var raf = null;
    var hovering = false;
    var focusInside = false;
    var dragging = false;
    var onScreen = true;
    var holdUntil = 0;
    var tween = null;        // { from, to, start, dur }
    var clones = [];

    root.classList.add('is-marquee');
    if (opts.dots) opts.dots.hidden = true; // dots would be misleading in continuous mode

    function cardsVisible() {
      var w = window.innerWidth;
      if (w >= 1100) return visible.desktop;
      if (w >= 700) return visible.tablet;
      return visible.mobile;
    }

    function sizeSlides() {
      var vw = viewport.clientWidth;
      var n = cardsVisible();
      var slideW = (vw - (n - 1) * gap) / n;
      root.style.setProperty('--rm-slide-w', Math.max(180, slideW) + 'px');
    }

    function markClone(el) {
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('data-rm-clone', '1');
      var f = el.querySelectorAll(FOCUSABLE);
      for (var i = 0; i < f.length; i += 1) f[i].setAttribute('tabindex', '-1');
    }

    function build() {
      clones.forEach(function (c) { if (c.parentNode) c.parentNode.removeChild(c); });
      clones = [];
      sizeSlides();
      var vw = viewport.clientWidth;
      // measure one set via a first clone (accounts for gap / margins exactly)
      var probe = originals[0].cloneNode(true);
      markClone(probe);
      track.appendChild(probe);
      var set = probe.offsetLeft - originals[0].offsetLeft;
      track.removeChild(probe);
      // fall back to summing widths if a layout quirk yields nothing useful
      if (!(set > 0)) {
        set = originals.reduce(function (s, el) { return s + el.getBoundingClientRect().width + gap; }, 0);
      }
      setWidth = set > 0 ? set : 1;
      var copies = Math.max(1, Math.ceil(vw / setWidth) + 1);
      for (var c = 0; c < copies; c += 1) {
        originals.forEach(function (el) {
          var k = el.cloneNode(true);
          markClone(k);
          track.appendChild(k);
          clones.push(k);
        });
      }
      speed = clamp(setWidth / seconds, MIN_SPEED, MAX_SPEED);
      offset = ((offset % setWidth) + setWidth) % setWidth;
      apply();
    }

    function apply() {
      track.style.transform = 'translate3d(' + (-offset) + 'px,0,0)';
    }
    function wrap(v) { return ((v % setWidth) + setWidth) % setWidth; }

    function modalOpen() { return document.documentElement.classList.contains('tv-modal-open'); }
    function shouldMove() {
      return !(hovering || focusInside || dragging || modalOpen() || document.hidden || !onScreen || Date.now() < holdUntil || tween);
    }
    function hold(ms) { holdUntil = Date.now() + (ms || 1200); }

    function frame(ts) {
      raf = window.requestAnimationFrame(frame);
      var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
      last = ts;
      if (tween) {
        var t = clamp((ts - tween.start) / tween.dur, 0, 1);
        var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOut
        offset = wrap(tween.from + (tween.to - tween.from) * e);
        apply();
        if (t >= 1) { tween = null; hold(1500); }
        return;
      }
      // eased resume / pause ("gentle")
      var target = shouldMove() ? 1 : 0;
      factor += (target - factor) * Math.min(1, dt * 3.2);
      if (Math.abs(target - factor) < 0.002) factor = target;
      if (factor > 0 && dt > 0) {
        offset = wrap(offset + dirSign * speed * factor * dt);
        apply();
      }
    }

    function step() {
      var c = originals[0].getBoundingClientRect().width + gap;
      return c > 0 ? c : 280;
    }
    function glide(dir) { // dir +1 = next (cards move left)
      tween = { from: offset, to: offset + dir * step(), start: performance.now(), dur: 650 };
    }

    // ---- controls ----------------------------------------------------------------
    if (opts.prev) opts.prev.addEventListener('click', function () { glide(-1); });
    if (opts.next) opts.next.addEventListener('click', function () { glide(1); });
    viewport.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); glide(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); glide(-1); }
    });

    if (canHover()) {
      root.addEventListener('mouseenter', function () { hovering = true; });
      root.addEventListener('mouseleave', function () { hovering = false; });
    }
    root.addEventListener('focusin', function () { focusInside = true; });
    root.addEventListener('focusout', function (e) { if (!root.contains(e.relatedTarget)) focusInside = false; });

    // drag / swipe
    var drag = null;
    var movedPx = 0;
    viewport.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drag = { x: e.clientX, off: offset, id: e.pointerId, active: false };
      movedPx = 0;
    });
    viewport.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x;
      if (!drag.active && Math.abs(dx) > 6) {
        drag.active = true; dragging = true; tween = null;
        viewport.classList.add('is-dragging');
        try { viewport.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
      if (drag.active) { movedPx = Math.abs(dx); offset = wrap(drag.off - dx); apply(); }
    });
    function endDrag() {
      if (!drag) return;
      var was = drag.active;
      drag = null;
      dragging = false;
      viewport.classList.remove('is-dragging');
      if (was) hold(1600);
    }
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);
    viewport.addEventListener('click', function (e) {
      if (movedPx > 6) { e.preventDefault(); e.stopPropagation(); movedPx = 0; }
    }, true);
    viewport.addEventListener('dragstart', function (e) { e.preventDefault(); });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) { onScreen = entries[0].isIntersecting; }, { threshold: 0.05 }).observe(root);
    }

    var rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(build, 150);
    });

    build();
    raf = window.requestAnimationFrame(frame);

    return {
      destroy: function () {
        if (raf) window.cancelAnimationFrame(raf);
        clones.forEach(function (c) { if (c.parentNode) c.parentNode.removeChild(c); });
        root.classList.remove('is-marquee');
        track.style.transform = '';
      },
    };
  }

  window.ReviewMarquee = { init: init };
})();
