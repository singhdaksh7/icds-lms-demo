/* Homepage reviews carousel: slow, smooth, endless horizontal slider.
 *
 * - Endless: slides are rotated in the DOM after each move, so it never rewinds.
 * - Direction (Admin): ltr = cards glide to the right, rtl = cards glide to the left.
 * - Autoplay (Admin, optional) pauses on hover, keyboard focus, touch/drag and when the tab
 *   or carousel is not visible. It is never started for visitors who prefer reduced motion.
 * - Drag / swipe, previous / next arrows, dots and the Left / Right arrow keys all work.
 * - Off-screen slides are `inert` + aria-hidden so tabbing never lands on hidden cards.
 * Video cards are plain buttons handled by testimonial-player.js (nothing here plays video). */
(function () {
  'use strict';

  function reduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function setup(root) {
    var viewport = root.querySelector('[data-hr-viewport]');
    var track = root.querySelector('[data-hr-track]');
    if (!viewport || !track) return;
    // Continuous mode: slow, seamless marquee (see review-marquee.js). Reduced-motion visitors fall
    // through to the regular swipeable / arrow carousel below, which never autoplays for them.
    if (root.getAttribute('data-mode') === 'CONTINUOUS' && window.ReviewMarquee && !reduced() && track.children.length > 1) {
      var cd = parseInt(root.getAttribute('data-cards-desktop'), 10) || 3;
      var ct = parseInt(root.getAttribute('data-cards-tablet'), 10) || 2;
      var started = window.ReviewMarquee.init({
        root: root, viewport: viewport, track: track,
        prev: root.querySelector('[data-hr-prev]'), next: root.querySelector('[data-hr-next]'),
        dots: root.querySelector('[data-hr-dots]'),
        seconds: parseFloat(root.getAttribute('data-seconds')) || 32,
        direction: root.getAttribute('data-direction') === 'rtl' ? 'rtl' : 'ltr',
        gap: 0,
        visible: { desktop: Math.min(3, cd) - 0.25, tablet: ct + 0.15, mobile: 1.12 }
      });
      if (started) return;
    }
    var prevBtn = root.querySelector('[data-hr-prev]');
    var nextBtn = root.querySelector('[data-hr-next]');
    var dotsBox = root.querySelector('[data-hr-dots]');
    var interval = Math.min(15000, Math.max(2000, parseInt(root.getAttribute('data-interval'), 10) || 6000));
    var rotateWanted = root.getAttribute('data-rotate') === '1' && !reduced();
    var dirMotion = root.getAttribute('data-direction') === 'rtl' ? 1 : -1; // +1 = next (content moves left)
    var total = track.children.length;
    var start = 0;          // logical index of the first visible card
    var busy = false;
    var pending = null;     // one queued user move (clicked while an animation was running)
    var timer = null;
    var holdUntil = 0;
    var hovering = false;
    var focusInside = false;
    var visible = true;
    var cols = 3;
    var duration = 900;

    function readCols() {
      var v = parseInt(getComputedStyle(root).getPropertyValue('--hr-cols'), 10);
      cols = v > 0 ? v : 1;
    }
    function slideWidth() {
      return track.children.length ? track.children[0].getBoundingClientRect().width : 0;
    }
    function isStatic() { return total <= cols; }

    function markVisibility() {
      for (var i = 0; i < track.children.length; i += 1) {
        var on = i < cols;
        var el = track.children[i];
        if (on) { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
        else { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); }
      }
    }

    function pages() { return Math.max(1, Math.ceil(total / cols)); }

    function buildDots() {
      if (!dotsBox) return;
      dotsBox.innerHTML = '';
      if (isStatic()) return;
      for (var p = 0; p < pages(); p += 1) {
        (function (page) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'hr-dot';
          b.setAttribute('aria-label', 'Show reviews group ' + (page + 1) + ' of ' + pages());
          b.addEventListener('click', function () { hold(); goTo(page * cols); });
          dotsBox.appendChild(b);
        })(p);
      }
      syncDots();
    }
    function syncDots() {
      if (!dotsBox) return;
      var active = Math.min(pages() - 1, Math.floor(start / cols));
      var dots = dotsBox.children;
      for (var i = 0; i < dots.length; i += 1) {
        dots[i].classList.toggle('is-active', i === active);
        if (i === active) dots[i].setAttribute('aria-current', 'true'); else dots[i].removeAttribute('aria-current');
      }
    }

    function applyStatic() {
      var st = isStatic();
      root.classList.toggle('is-static', st);
      if (prevBtn) prevBtn.hidden = st;
      if (nextBtn) nextBtn.hidden = st;
      if (dotsBox) dotsBox.hidden = st;
      if (st) {
        track.classList.remove('is-animating');
        track.style.transform = '';
      }
    }

    // Moves `d` cards (d > 0: content glides left, d < 0: content glides right).
    function move(d, instant) {
      if (busy || isStatic() || d === 0) return;
      var span = total - cols; // how far the track can slide without showing blank space
      if (Math.abs(d) > span) d = d > 0 ? -(total - d) : (total + d);
      if (Math.abs(d) > span) return;
      var w = slideWidth();
      if (!w) return;
      var steps = Math.abs(d);
      var animate = !instant && !reduced();
      busy = true;

      var finish = function () {
        track.classList.remove('is-animating');
        if (d > 0) {
          for (var i = 0; i < steps; i += 1) track.appendChild(track.firstElementChild);
        }
        track.style.transform = 'translate3d(0,0,0)';
        start = ((start + d) % total + total) % total;
        busy = false;
        markVisibility();
        syncDots();
        if (pending !== null) { var p = pending; pending = null; move(p, false); }
      };

      if (d < 0) {
        // Bring the cards that are about to enter from the left to the front, parked off-screen.
        track.classList.remove('is-animating');
        for (var j = 0; j < steps; j += 1) track.insertBefore(track.lastElementChild, track.firstElementChild);
        track.style.transform = 'translate3d(' + (-steps * w) + 'px,0,0)';
        for (var k = 0; k < cols + steps; k += 1) { if (track.children[k]) { track.children[k].removeAttribute('inert'); track.children[k].removeAttribute('aria-hidden'); } }
        void track.offsetWidth; // commit the parked position before animating
      } else {
        for (var m = 0; m < cols + steps; m += 1) { if (track.children[m]) { track.children[m].removeAttribute('inert'); track.children[m].removeAttribute('aria-hidden'); } }
      }

      var target = d > 0 ? -steps * w : 0;
      if (!animate) {
        track.style.transform = 'translate3d(' + target + 'px,0,0)';
        finish();
        return;
      }
      var done = false;
      var end = function () { if (done) return; done = true; track.removeEventListener('transitionend', onEnd); finish(); };
      var onEnd = function (e) { if (e.target === track) end(); };
      track.addEventListener('transitionend', onEnd);
      track.style.setProperty('--hr-duration', duration + 'ms');
      track.classList.add('is-animating');
      track.style.transform = 'translate3d(' + target + 'px,0,0)';
      setTimeout(end, duration + 120);
    }

    // User-initiated moves are never dropped: one is queued while an animation runs.
    function userMove(d) {
      if (busy) { pending = d; return; }
      move(d, false);
    }
    function goTo(index) {
      var delta = ((index - start) % total + total) % total;
      if (delta === 0) return;
      userMove(delta);
    }

    function next() { userMove(1); }
    function prev() { userMove(-1); }

    // ---- autoplay -----------------------------------------------------------
    function hold(ms) { holdUntil = Date.now() + (ms || 9000); }
    function shouldRun() {
      return rotateWanted && !busy && visible && !hovering && !focusInside && !document.hidden && !isStatic() && Date.now() >= holdUntil;
    }
    function tick() {
      if (shouldRun()) move(dirMotion > 0 ? 1 : -1, false);
    }
    function startTimer() {
      if (!rotateWanted || timer) return;
      timer = setInterval(tick, interval);
    }

    // ---- events -------------------------------------------------------------
    if (prevBtn) prevBtn.addEventListener('click', function () { hold(); prev(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { hold(); next(); });
    viewport.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); hold(); prev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); hold(); next(); }
    });
    root.addEventListener('mouseenter', function () { hovering = true; });
    root.addEventListener('mouseleave', function () { hovering = false; });
    root.addEventListener('focusin', function () { focusInside = true; });
    root.addEventListener('focusout', function (e) { if (!root.contains(e.relatedTarget)) focusInside = false; });

    // Drag / swipe (mouse + touch + pen). Vertical scrolling stays native (touch-action: pan-y).
    var dragStart = null;
    var moved = false;
    viewport.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragStart = { x: e.clientX, y: e.clientY };
      moved = false;
      hold(12000);
    });
    viewport.addEventListener('pointermove', function (e) {
      if (!dragStart) return;
      var dx = e.clientX - dragStart.x;
      if (Math.abs(dx) > 8) { moved = true; viewport.classList.add('is-dragging'); }
    });
    function endDrag(e) {
      if (!dragStart) return;
      var dx = e.clientX - dragStart.x;
      var dy = e.clientY - dragStart.y;
      dragStart = null;
      viewport.classList.remove('is-dragging');
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) next(); else prev();
      }
    }
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', function () { dragStart = null; viewport.classList.remove('is-dragging'); });
    // A drag must not count as a click on a card (video play button / course link).
    viewport.addEventListener('click', function (e) {
      if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; }
    }, true);
    viewport.addEventListener('dragstart', function (e) { e.preventDefault(); });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
      }, { threshold: 0.2 }).observe(root);
    }
    document.addEventListener('visibilitychange', function () { /* shouldRun() checks document.hidden */ });

    var resizeT = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(function () {
        var before = cols;
        readCols();
        if (before !== cols) { applyStatic(); buildDots(); }
        markVisibility();
        track.style.transform = 'translate3d(0,0,0)';
      }, 150);
    });

    readCols();
    applyStatic();
    buildDots();
    markVisibility();
    startTimer();
  }

  function boot() {
    var roots = document.querySelectorAll('[data-hr-carousel]');
    for (var i = 0; i < roots.length; i += 1) setup(roots[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
