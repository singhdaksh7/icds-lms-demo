/*
 * admin-images.js (Admin only)
 *  - Shows the chosen file in the preview box BEFORE it is saved (read via
 *    FileReader -> data: URL, which the CSP allows). Nothing is uploaded here.
 *  - Opens the collapsed Site Content section that matches the URL hash (e.g.
 *    /admin/site-content/home#form-hero after a save).
 */
(function () {
  document.addEventListener('change', function (event) {
    var input = event.target;
    if (!input || input.type !== 'file' || !input.hasAttribute('data-preview-img')) return;
    var img = document.getElementById(input.getAttribute('data-preview-img'));
    var empty = document.getElementById(input.getAttribute('data-preview-empty'));
    var badge = document.getElementById(input.getAttribute('data-preview-badge'));
    var file = input.files && input.files[0];
    if (!file || !img) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return;
    var reader = new FileReader();
    reader.onload = function () {
      img.src = reader.result;
      img.hidden = false;
      if (empty) empty.hidden = true;
      if (badge) {
        badge.textContent = 'New image (not saved yet)';
        badge.className = 'badge mt-1 text-bg-warning';
      }
    };
    reader.readAsDataURL(file);
  });

  function openForHash() {
    if (!window.location.hash) return;
    var target;
    try {
      target = document.querySelector(window.location.hash);
    } catch (e) {
      return;
    }
    var details = target && target.closest ? target.closest('details') : null;
    if (details) {
      details.open = true;
      target.scrollIntoView();
    }
  }
  window.addEventListener('hashchange', openForHash);
  document.addEventListener('DOMContentLoaded', openForHash);
})();
