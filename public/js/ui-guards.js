/*
 * ui-guards.js
 * Replaces small inline event handlers (onsubmit="return confirm(...)" and
 * onerror="...") so the site can run under a Content-Security-Policy that
 * forbids inline scripts. Behavior is unchanged:
 *   - <form data-confirm="..."> asks for confirmation before submitting.
 *   - <img data-fallback-src="..."> swaps to the fallback image once if the
 *     original fails to load.
 */
(function () {
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || !form.getAttribute) return;
    var message = form.getAttribute('data-confirm');
    if (message && !window.confirm(message)) {
      event.preventDefault();
    }
  }, true);

  function applyFallback(img) {
    var fallback = img.getAttribute('data-fallback-src');
    if (!fallback || img.getAttribute('data-fallback-applied')) return;
    img.setAttribute('data-fallback-applied', '1');
    img.src = fallback;
  }

  // error events do not bubble, so listen during the capture phase.
  document.addEventListener('error', function (event) {
    var el = event.target;
    if (el && el.tagName === 'IMG') applyFallback(el);
  }, true);

  // Images that already failed before this script ran.
  document.addEventListener('DOMContentLoaded', function () {
    var imgs = document.querySelectorAll('img[data-fallback-src]');
    for (var i = 0; i < imgs.length; i++) {
      if (imgs[i].complete && imgs[i].naturalWidth === 0) applyFallback(imgs[i]);
    }
  });

  // Buttons outside a form (form="...") still trigger their own confirm.
  document.addEventListener('click', function (event) {
    var el = event.target && event.target.closest ? event.target.closest('[data-confirm]') : null;
    if (el && el.tagName === 'BUTTON' && el.hasAttribute('form') && !window.confirm(el.getAttribute('data-confirm'))) {
      event.preventDefault();
    }
  }, true);
})();
