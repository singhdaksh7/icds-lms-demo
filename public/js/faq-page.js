/* /faq page: accessible accordion (aria-expanded), live search and category chips.
 * Progressive enhancement: without JS every answer is simply visible. */
(function () {
  'use strict';
  var root = document.querySelector('[data-faq-page]');
  if (!root) return;
  document.documentElement.classList.add('sp-js');

  var items = Array.prototype.slice.call(root.querySelectorAll('[data-faq-item]'));
  var search = root.querySelector('[data-faq-search]');
  var chips = Array.prototype.slice.call(root.querySelectorAll('[data-faq-category]'));
  var emptyMsg = root.querySelector('[data-faq-empty]');
  var activeCategory = '';

  function setOpen(item, open) {
    var btn = item.querySelector('.sp-acc-btn');
    item.classList.toggle('is-open', open);
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  items.forEach(function (item) {
    var btn = item.querySelector('.sp-acc-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      setOpen(item, btn.getAttribute('aria-expanded') !== 'true');
    });
  });

  function applyFilters() {
    var q = search ? search.value.trim().toLowerCase() : '';
    var shown = 0;
    items.forEach(function (item) {
      var text = item.textContent.toLowerCase();
      var cat = item.getAttribute('data-category') || '';
      var ok = (!q || text.indexOf(q) !== -1) && (!activeCategory || cat === activeCategory);
      item.hidden = !ok;
      if (ok) shown += 1;
    });
    if (emptyMsg) emptyMsg.hidden = shown !== 0;
  }

  if (search) search.addEventListener('input', applyFilters);
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      activeCategory = chip.getAttribute('data-faq-category') || '';
      chips.forEach(function (c) {
        var on = c === chip;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      applyFilters();
    });
  });
})();
