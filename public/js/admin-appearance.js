/*
 * Admin > Landing Page > Appearance: live preview, colour picker/HEX sync,
 * preset filling and contrast warnings. Uses the SAME theme module as the
 * server (course-appearance-theme.js) so the preview matches the live page.
 * Writes only validated, generated custom properties to the preview element.
 */
(function () {
  'use strict';
  var T = window.CourseAppearanceTheme;
  var form = document.getElementById('appearanceForm');
  var preview = document.getElementById('appearancePreview');
  if (!T || !form || !preview) return;

  var presets = {};
  try { presets = JSON.parse(form.getAttribute('data-presets') || '{}'); } catch (e) { presets = {}; }

  var presetInput = document.getElementById('appearanceThemePreset');
  var presetLabel = document.getElementById('appearancePresetLabel');
  var dirtyNote = document.getElementById('appearanceDirty');
  var contrastList = document.getElementById('appearanceContrastList');
  var dirty = false;

  function field(name) { return form.elements[name]; }

  function readValues() {
    var v = {};
    T.ALL_FIELDS.forEach(function (f) { var el = field(f); v[f] = el ? el.value : ''; });
    return v;
  }

  // Values with invalid HEX replaced by the last good value so the preview never breaks.
  var lastGood = readValues();
  function safeValues() {
    var v = readValues();
    T.COLOR_FIELDS.forEach(function (f) {
      var n = T.normalizeHex(v[f]);
      if (n) lastGood[f] = n; else n = lastGood[f];
      v[f] = n;
    });
    return v;
  }

  function renderContrast(values) {
    var rows = T.checkContrast(values);
    contrastList.innerHTML = '';
    rows.forEach(function (r) {
      var li = document.createElement('li');
      li.className = 'd-flex align-items-center gap-2 mb-1';
      var badge = document.createElement('span');
      badge.className = 'badge ' + (r.level === 'ok' ? 'bg-success' : r.level === 'warn' ? 'bg-warning text-dark' : 'bg-danger');
      badge.textContent = r.ratio.toFixed(2) + ':1';
      var text = document.createElement('span');
      text.textContent = r.label + (r.level === 'ok' ? '' : r.level === 'warn' ? ' — low contrast (aim for ' + r.min + ':1)' : ' — unreadable, save is blocked');
      li.appendChild(badge);
      li.appendChild(text);
      contrastList.appendChild(li);
    });
  }

  function refresh() {
    var values = safeValues();
    var vars = T.buildCssVars(values);
    Object.keys(vars).forEach(function (k) { preview.style.setProperty(k, vars[k]); });
    renderContrast(values);
  }

  function setDirty() {
    dirty = true;
    if (dirtyNote) dirtyNote.hidden = false;
  }

  function markCustom() {
    if (presetInput.value !== 'custom') {
      presetInput.value = 'custom';
      if (presetLabel) presetLabel.textContent = 'Custom (modified)';
    }
  }

  function syncColor(name, hex, source) {
    var picker = form.querySelector('[data-color-picker="' + name + '"]');
    var text = form.querySelector('[data-color-hex="' + name + '"]');
    var swatch = form.querySelector('[data-color-swatch="' + name + '"]');
    if (source !== 'picker' && picker) picker.value = hex;
    if (source !== 'text' && text) text.value = hex;
    if (swatch) swatch.style.background = hex;
  }

  T.COLOR_FIELDS.forEach(function (name) {
    var picker = form.querySelector('[data-color-picker="' + name + '"]');
    var text = form.querySelector('[data-color-hex="' + name + '"]');
    var err = form.querySelector('[data-color-error="' + name + '"]');
    if (!picker || !text) return;
    picker.addEventListener('input', function () {
      syncColor(name, picker.value.toLowerCase(), 'picker');
      if (err) err.hidden = true;
      text.classList.remove('is-invalid');
      markCustom(); setDirty(); refresh();
    });
    text.addEventListener('input', function () {
      var n = T.normalizeHex(text.value);
      text.classList.toggle('is-invalid', !n);
      if (err) err.hidden = !!n;
      if (n) { syncColor(name, n, 'text'); }
      markCustom(); setDirty(); refresh();
    });
    text.addEventListener('blur', function () {
      var n = T.normalizeHex(text.value);
      if (n) text.value = n;
    });
  });

  ['headingFont', 'bodyFont', 'cardRadius', 'buttonRadius', 'shadowStrength'].forEach(function (name) {
    var el = field(name);
    if (el) el.addEventListener('change', function () { markCustom(); setDirty(); refresh(); });
  });

  // Presets fill every field (client side); Save persists.
  form.querySelectorAll('[data-preset]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-preset');
      if (key === 'custom') {
        presetInput.value = 'custom';
        if (presetLabel) presetLabel.textContent = 'Custom';
        setDirty();
        return;
      }
      var p = presets[key];
      if (!p) return;
      T.ALL_FIELDS.forEach(function (f) {
        var el = field(f);
        if (!el) return;
        el.value = p[f];
        if (T.COLOR_FIELDS.indexOf(f) !== -1) syncColor(f, p[f]);
      });
      form.querySelectorAll('.is-invalid').forEach(function (el) { el.classList.remove('is-invalid'); });
      form.querySelectorAll('[data-color-error]').forEach(function (el) { el.hidden = true; });
      presetInput.value = key;
      if (presetLabel) presetLabel.textContent = (T.PRESETS[key] && T.PRESETS[key].label) || key;
      setDirty(); refresh();
    });
  });

  form.addEventListener('submit', function (e) {
    var bad = T.COLOR_FIELDS.filter(function (f) { return !T.normalizeHex(field(f).value); });
    if (bad.length) {
      e.preventDefault();
      var first = form.querySelector('[data-color-hex="' + bad[0] + '"]');
      if (first) { first.classList.add('is-invalid'); first.focus(); }
      bad.forEach(function (f) { var er = form.querySelector('[data-color-error="' + f + '"]'); if (er) er.hidden = false; });
      return;
    }
    // Normalise (#abc -> #aabbcc) before sending.
    T.COLOR_FIELDS.forEach(function (f) { field(f).value = T.normalizeHex(field(f).value); });
    dirty = false;
  });

  window.addEventListener('beforeunload', function (e) {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  refresh();
})();
