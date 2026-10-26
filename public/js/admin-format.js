/*
 * admin-format.js — formatting toolbar for admin text fields.
 * Adds Bold / Italic / Underline / Strike, a font-size picker and a colour
 * picker above text inputs and textareas. It only wraps the selected text in
 * the tags documented in src/lib/richText.js (e.g. [b]..[/b], [size=24]..[/size]);
 * the public site converts those to real styling safely on render.
 * Fields that hold URLs, emails, numbers, slugs, etc. are skipped.
 */
(function () {
  var SKIP_NAME = /(url|slug|email|phone|whatsapp|link|path|price|password|token|csrf|search|host|port|username|sort|order|^q$|color|date|number|duration|key|id)$/i;
  var TOKEN = /\[(?:\/?(?:b|i|u|s|size|color)|size=\d{1,3}|color=#[0-9a-fA-F]{3,8})\]/g;
  var SIZES = [['Size', ''], ['Small (14)', '14'], ['Normal (16)', '16'], ['Large (20)', '20'], ['X-Large (28)', '28'], ['Huge (40)', '40'], ['Giant (56)', '56']];

  function wrap(field, open, close) {
    var start = field.selectionStart;
    var end = field.selectionEnd;
    if (start == null) return;
    var value = field.value;
    // Nothing selected: format the whole field (never insert a placeholder word). Empty field: nothing to format.
    if (start === end) {
      if (!value) return;
      start = 0;
      end = value.length;
    }
    var selected = value.slice(start, end);
    field.value = value.slice(0, start) + open + selected + close + value.slice(end);
    field.focus();
    field.setSelectionRange(start + open.length, start + open.length + selected.length);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function clearFormatting(field) {
    var start = field.selectionStart;
    var end = field.selectionEnd;
    var hasSel = start !== end;
    var target = hasSel ? field.value.slice(start, end) : field.value;
    var cleaned = target.replace(TOKEN, '');
    field.value = hasSel ? field.value.slice(0, start) + cleaned + field.value.slice(end) : cleaned;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function button(label, title, onClick, extraClass) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'fmt-btn' + (extraClass ? ' ' + extraClass : '');
    b.textContent = label;
    b.title = title;
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    b.addEventListener('click', onClick);
    return b;
  }

  function buildToolbar(field) {
    var bar = document.createElement('div');
    bar.className = 'fmt-toolbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Text formatting');

    bar.appendChild(button('B', 'Bold', function () { wrap(field, '[b]', '[/b]'); }, 'fmt-b'));
    bar.appendChild(button('I', 'Italic', function () { wrap(field, '[i]', '[/i]'); }, 'fmt-i'));
    bar.appendChild(button('U', 'Underline', function () { wrap(field, '[u]', '[/u]'); }, 'fmt-u'));
    bar.appendChild(button('S', 'Strikethrough', function () { wrap(field, '[s]', '[/s]'); }, 'fmt-s'));

    var size = document.createElement('select');
    size.className = 'fmt-select';
    size.title = 'Font size (applies to selected text)';
    SIZES.forEach(function (s) {
      var o = document.createElement('option');
      o.textContent = s[0];
      o.value = s[1];
      size.appendChild(o);
    });
    size.addEventListener('change', function () {
      if (size.value) wrap(field, '[size=' + size.value + ']', '[/size]');
      size.value = '';
    });
    bar.appendChild(size);

    var color = document.createElement('input');
    color.type = 'color';
    color.value = '#565acf';
    color.className = 'fmt-color';
    color.title = 'Text colour (applies to selected text)';
    color.addEventListener('change', function () { wrap(field, '[color=' + color.value + ']', '[/color]'); });
    bar.appendChild(color);

    bar.appendChild(button('Clear', 'Remove formatting from the selection (or the whole field)', function () { clearFormatting(field); }, 'fmt-clear'));
    return bar;
  }

  function eligible(field) {
    if (field.dataset.noFormat !== undefined || field.closest('[data-no-format]') || field.readOnly || field.disabled) return false;
    if (field.tagName === 'INPUT' && field.type !== 'text') return false;
    var name = field.name || field.id || '';
    if (!name || name.charAt(0) === '_' || SKIP_NAME.test(name.replace(/^f-/, ''))) return false;
    return true;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var main = document.querySelector('.admin-main') || document.body;
    var fields = main.querySelectorAll('textarea.form-control-custom, input[type="text"].form-control-custom');
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      if (!eligible(field)) continue;
      field.parentNode.insertBefore(buildToolbar(field), field);
    }
  });
})();
