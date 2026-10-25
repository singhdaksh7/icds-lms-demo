/*
 * Lesson player UI: Theater mode (desktop), course-content drawer (tablet /
 * mobile) and curriculum accordions. Presentation only - it never touches the
 * <video>, progress tracking or any request to the server.
 *
 * Desktop (>= 992px): the toggle slides the sidebar out to the right and the
 * video column expands (CSS transition on .is-theater / .is-collapsed).
 * Tablet / mobile: the same sidebar is a slide-over drawer with a backdrop;
 * Escape or the backdrop closes it and focus returns to the opener.
 * Browser/native video fullscreen is a separate mode and is not handled here.
 */
(function () {
  'use strict';

  var page = document.getElementById('lpPage');
  if (!page) return;

  var layout = document.getElementById('lpLayout');
  var sidebar = document.getElementById('lpSidebar');
  var backdrop = document.getElementById('lpBackdrop');
  var theaterBtn = document.getElementById('lpTheaterToggle');
  var drawerBtn = document.getElementById('lpDrawerToggle');
  var courseId = page.getAttribute('data-course-id') || '';
  var storageKey = 'lp:sidebar:' + courseId;
  var desktop = window.matchMedia('(min-width: 992px)');
  var theaterEnabled = page.getAttribute('data-theater-enabled') === 'true';
  var hideLabel = page.getAttribute('data-label-hide') || 'Hide Course Content';
  var showLabel = page.getAttribute('data-label-show') || 'Show Course Content';
  var drawerOpen = false;
  var lastFocus = null;

  /* ---- curriculum accordions (modules + topics) ------------------------- */
  function bindCollapse(root) {
    root.addEventListener('click', function (event) {
      var btn = event.target.closest ? event.target.closest('[data-lp-collapse]') : null;
      if (!btn || !root.contains(btn)) return;
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      var panel = document.getElementById(btn.getAttribute('aria-controls'));
      if (panel) panel.hidden = open;
    });
  }
  if (sidebar) bindCollapse(sidebar);

  // Bring the lesson being played into view in the sidebar.
  function scrollCurrentIntoView() {
    var current = sidebar && sidebar.querySelector('.lp-lesson.is-current');
    var scroller = sidebar && sidebar.querySelector('.lp-sidebar-inner');
    if (!current || !scroller) return;
    var top = current.offsetTop;
    var el = current;
    var offset = 0;
    while (el && el !== scroller) { offset += el.offsetTop; el = el.offsetParent; }
    if (el === scroller) top = offset;
    scroller.scrollTop = Math.max(0, top - scroller.clientHeight / 3);
  }

  if (!sidebar) return;

  /* ---- remembered preference (DB default applies first) ----------------- */
  function readPref() {
    try {
      var v = window.localStorage.getItem(storageKey);
      return v === 'open' || v === 'closed' ? v : null;
    } catch (e) { return null; }
  }
  function writePref(v) {
    try { window.localStorage.setItem(storageKey, v); } catch (e) { /* ignore */ }
  }

  /* ---- desktop: theater mode -------------------------------------------- */
  function setDesktopOpen(open) {
    var closed = theaterEnabled && !open;
    layout.classList.toggle('is-theater', closed);
    sidebar.classList.toggle('is-collapsed', closed);
    sidebar.classList.remove('is-open');
    if ('inert' in sidebar) sidebar.inert = closed;
    if (theaterBtn) {
      theaterBtn.setAttribute('aria-expanded', closed ? 'false' : 'true');
      var label = theaterBtn.querySelector('[data-lp-theater-label]');
      if (label) label.textContent = closed ? showLabel : hideLabel;
    }
  }

  function desktopWantsOpen() {
    if (!theaterEnabled) return true;
    var pref = readPref();
    var def = page.getAttribute('data-sidebar-default') === 'open';
    return pref ? pref === 'open' : def;
  }

  if (theaterBtn) {
    theaterBtn.addEventListener('click', function () {
      var open = layout.classList.contains('is-theater'); // currently closed -> open it
      setDesktopOpen(open);
      writePref(open ? 'open' : 'closed');
    });
  }

  /* ---- tablet / mobile: drawer ------------------------------------------ */
  function focusables() {
    return Array.prototype.slice.call(sidebar.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter(function (el) { return !el.hidden && el.offsetParent !== null; });
  }

  function openDrawer() {
    if (desktop.matches) return;
    drawerOpen = true;
    lastFocus = document.activeElement;
    sidebar.classList.remove('is-collapsed');
    sidebar.classList.add('is-open');
    if ('inert' in sidebar) sidebar.inert = false;
    if (backdrop) {
      backdrop.hidden = false;
      // next frame so the opacity transition runs
      window.requestAnimationFrame(function () { backdrop.classList.add('is-visible'); });
    }
    document.body.classList.add('lp-drawer-open');
    if (drawerBtn) drawerBtn.setAttribute('aria-expanded', 'true');
    scrollCurrentIntoView();
    var closeBtn = sidebar.querySelector('[data-lp-drawer-close]');
    if (closeBtn) closeBtn.focus();
  }

  function closeDrawer(returnFocus) {
    if (!drawerOpen && desktop.matches) return;
    drawerOpen = false;
    sidebar.classList.remove('is-open');
    if (!desktop.matches) {
      sidebar.classList.add('is-collapsed');
      if ('inert' in sidebar) sidebar.inert = true;
    }
    if (backdrop) {
      backdrop.classList.remove('is-visible');
      window.setTimeout(function () { if (!drawerOpen) backdrop.hidden = true; }, 300);
    }
    document.body.classList.remove('lp-drawer-open');
    if (drawerBtn) drawerBtn.setAttribute('aria-expanded', 'false');
    if (returnFocus !== false) {
      var target = lastFocus || drawerBtn;
      if (target && target.focus) target.focus();
    }
  }

  if (drawerBtn) drawerBtn.addEventListener('click', function () { if (drawerOpen) closeDrawer(); else openDrawer(); });
  Array.prototype.forEach.call(page.querySelectorAll('[data-lp-drawer-close]'), function (el) {
    el.addEventListener('click', function () { closeDrawer(); });
  });

  document.addEventListener('keydown', function (event) {
    if (!drawerOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key === 'Tab') {
      var items = focusables();
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  /* ---- breakpoint handling ---------------------------------------------- */
  function applyMode() {
    if (desktop.matches) {
      drawerOpen = false;
      document.body.classList.remove('lp-drawer-open');
      if (backdrop) { backdrop.hidden = true; backdrop.classList.remove('is-visible'); }
      if (drawerBtn) drawerBtn.setAttribute('aria-expanded', 'false');
      setDesktopOpen(desktopWantsOpen());
    } else {
      layout.classList.remove('is-theater');
      sidebar.classList.remove('is-open');
      sidebar.classList.add('is-collapsed');
      if ('inert' in sidebar) sidebar.inert = true;
    }
  }

  if (desktop.addEventListener) desktop.addEventListener('change', applyMode);
  else if (desktop.addListener) desktop.addListener(applyMode);

  applyMode();
  scrollCurrentIntoView();
})();
