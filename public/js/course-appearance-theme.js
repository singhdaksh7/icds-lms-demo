/*
 * Per-course landing appearance: presets, allowlists, validation and the
 * CSS-variable builder. Plain ES5-compatible UMD module so the EXACT same code
 * runs on the server (src/lib/courseAppearance.js re-exports it) and in the
 * admin Appearance tab (live preview) - one source of truth, no drift.
 *
 * Security model: nothing here ever passes admin text into CSS. Colours are
 * normalised to #rrggbb, fonts / radii / shadows are looked up in allowlists
 * and everything emitted is generated from those validated values.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CourseAppearanceTheme = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COLOR_FIELDS = [
    'primaryColor', 'secondaryColor', 'accentColor',
    'pageBackground', 'surfaceColor', 'alternateSurfaceColor',
    'headingColor', 'bodyTextColor', 'mutedTextColor',
    'borderColor',
    'buttonBackground', 'buttonTextColor', 'buttonHoverBackground', 'buttonHoverTextColor',
    'heroBackground', 'heroTextColor', 'heroAccentColor',
    'statsBackground', 'statsAccentColor',
    'successColor', 'dangerColor',
    'glowColor', 'gradientStart', 'gradientEnd',
  ];

  // key -> { label, stack, google } ; `google` is the exact allowlisted
  // Google Fonts `family=` query fragment (null = no download needed).
  var HEADING_FONTS = {
    'Fraunces': { label: 'Fraunces', stack: "'Fraunces', Georgia, serif", google: 'Fraunces:ital,opsz,wght@0,9..144,400..800;1,9..144,400..800' },
    'Playfair Display': { label: 'Playfair Display', stack: "'Playfair Display', Georgia, serif", google: 'Playfair+Display:ital,wght@0,500..800;1,500..800' },
    'Libre Baskerville': { label: 'Libre Baskerville', stack: "'Libre Baskerville', Georgia, serif", google: 'Libre+Baskerville:ital,wght@0,400;0,700;1,400' },
    'DM Serif Display': { label: 'DM Serif Display', stack: "'DM Serif Display', Georgia, serif", google: 'DM+Serif+Display:ital@0;1' },
    'Inter': { label: 'Inter', stack: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif", google: 'Inter:wght@400;500;600;700;800' },
    'system serif': { label: 'System serif', stack: "Georgia, 'Times New Roman', Times, serif", google: null },
  };
  var BODY_FONTS = {
    'Inter': { label: 'Inter', stack: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif", google: 'Inter:wght@400;500;600;700;800' },
    'Manrope': { label: 'Manrope', stack: "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif", google: 'Manrope:wght@400;500;600;700;800' },
    'Poppins': { label: 'Poppins', stack: "'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif", google: 'Poppins:wght@400;500;600;700' },
    'system sans-serif': { label: 'System sans-serif', stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif", google: null },
  };

  // Base card radius; the stylesheet derives smaller/larger steps with calc().
  var CARD_RADII = { sharp: '4px', soft: '10px', rounded: '16px', extra: '24px' };
  var CARD_RADIUS_LABELS = { sharp: 'Sharp', soft: 'Soft', rounded: 'Rounded', extra: 'Extra Rounded' };
  var BUTTON_RADII = { square: '4px', soft: '12px', pill: '999px' };
  var BUTTON_RADIUS_LABELS = { square: 'Square', soft: 'Soft', pill: 'Pill' };
  var SHADOWS = {
    none: { sm: 'none', md: 'none', lg: 'none' },
    subtle: { sm: [0, 4, 14, 0.04], md: [0, 8, 24, 0.07], lg: [0, 18, 45, 0.12] },
    medium: { sm: [0, 6, 20, 0.08], md: [0, 12, 32, 0.12], lg: [0, 24, 56, 0.2] },
    strong: { sm: [0, 10, 28, 0.16], md: [0, 16, 40, 0.22], lg: [0, 30, 70, 0.32] },
  };
  var SHADOW_LABELS = { none: 'None', subtle: 'Subtle', medium: 'Medium', strong: 'Strong' };

  var HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  /** Normalise "#abc" / "ABCDEF" / "#AbCdEf" to "#rrggbb"; null if unsafe. */
  function normalizeHex(value) {
    if (typeof value !== 'string') return null;
    var v = value.trim();
    if (v && v.charAt(0) !== '#') v = '#' + v;
    if (!HEX_RE.test(v)) return null;
    v = v.toLowerCase();
    if (v.length === 4) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    return v;
  }

  function hexToRgb(hex) {
    var h = normalizeHex(hex) || '#000000';
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function toHex(rgb) {
    return '#' + rgb.map(function (n) {
      var s = Math.max(0, Math.min(255, Math.round(n))).toString(16);
      return s.length === 1 ? '0' + s : s;
    }).join('');
  }
  /** Mix colour `a` toward `b` by t (0 = a, 1 = b). */
  function mix(a, b, t) {
    var x = hexToRgb(a), y = hexToRgb(b);
    return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
  }
  function rgba(hex, alpha) {
    var c = hexToRgb(hex);
    return 'rgba(' + c[0] + ', ' + c[1] + ', ' + c[2] + ', ' + alpha + ')';
  }

  // ---- WCAG contrast -------------------------------------------------------
  function luminance(hex) {
    var c = hexToRgb(hex).map(function (v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrastRatio(a, b) {
    var la = luminance(a), lb = luminance(b);
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  /**
   * Contrast warnings for the admin. Level 'unusable' (< 2:1) is the only one
   * a save is refused for; 'warn' (< 4.5:1 for text) is advisory.
   */
  function checkContrast(a) {
    var pairs = [
      ['Heading vs page background', a.headingColor, a.pageBackground, 3],
      ['Heading vs card surface', a.headingColor, a.surfaceColor, 3],
      ['Body text vs page background', a.bodyTextColor, a.pageBackground, 4.5],
      ['Body text vs card surface', a.bodyTextColor, a.surfaceColor, 4.5],
      ['Button text vs button background', a.buttonTextColor, a.buttonBackground, 4.5],
      ['Hero text vs hero background', a.heroTextColor, a.heroBackground, 4.5],
    ];
    return pairs.map(function (p) {
      var ratio = contrastRatio(p[1], p[2]);
      return {
        label: p[0], foreground: p[1], background: p[2], ratio: Math.round(ratio * 100) / 100, min: p[3],
        level: ratio < 2 ? 'unusable' : (ratio < p[3] ? 'warn' : 'ok'),
      };
    });
  }

  // ---- Presets -------------------------------------------------------------
  function preset(label, description, v) { v.label = label; v.description = description; return v; }

  var PRESETS = {
    // Exact values of the production Advanced FMR Master Class page.
    'fmr-navy': preset('FMR Navy', 'Navy and blue premium clinical look (current FMR design).', {
      primaryColor: '#2b6cf0', secondaryColor: '#0a1330', accentColor: '#f2b33d',
      pageBackground: '#f7faff', surfaceColor: '#ffffff', alternateSurfaceColor: '#f7faff',
      headingColor: '#0f1b33', bodyTextColor: '#1b2745', mutedTextColor: '#5b6a86',
      borderColor: '#dfe8f7',
      buttonBackground: '#2b6cf0', buttonTextColor: '#ffffff', buttonHoverBackground: '#2b6cf0', buttonHoverTextColor: '#ffffff',
      heroBackground: '#0a1330', heroTextColor: '#ffffff', heroAccentColor: '#f2b33d',
      statsBackground: '#ffffff', statsAccentColor: '#0a1330',
      successColor: '#14a066', dangerColor: '#e11d48',
      glowColor: '#172d69', gradientStart: '#2b6cf0', gradientEnd: '#9b5cf0',
      cardRadius: 'rounded', buttonRadius: 'soft', shadowStrength: 'subtle',
      headingFont: 'Fraunces', bodyFont: 'Inter',
    }),
    'warm-gold': preset('Warm Gold', 'Warm cream surfaces with deep brown and gold.', {
      primaryColor: '#b7791f', secondaryColor: '#2b1d0e', accentColor: '#e0a526',
      pageBackground: '#fdf8ee', surfaceColor: '#ffffff', alternateSurfaceColor: '#fbf2de',
      headingColor: '#2b1d0e', bodyTextColor: '#4a3a24', mutedTextColor: '#745f43',
      borderColor: '#efdfba',
      buttonBackground: '#9a5b0c', buttonTextColor: '#ffffff', buttonHoverBackground: '#7c4709', buttonHoverTextColor: '#ffffff',
      heroBackground: '#2b1d0e', heroTextColor: '#fff8e8', heroAccentColor: '#f2c14e',
      statsBackground: '#ffffff', statsAccentColor: '#9a5b0c',
      successColor: '#2f855a', dangerColor: '#c53030',
      glowColor: '#5a3d14', gradientStart: '#b7791f', gradientEnd: '#e0a526',
      cardRadius: 'rounded', buttonRadius: 'pill', shadowStrength: 'medium',
      headingFont: 'Playfair Display', bodyFont: 'Manrope',
    }),
    'clinical-white': preset('Clinical White', 'Clean white and soft neutral with a calm teal accent.', {
      primaryColor: '#0e7490', secondaryColor: '#1f2937', accentColor: '#d97706',
      pageBackground: '#fafaf9', surfaceColor: '#ffffff', alternateSurfaceColor: '#f5f5f4',
      headingColor: '#111827', bodyTextColor: '#374151', mutedTextColor: '#5f6b7a',
      borderColor: '#e7e5e4',
      buttonBackground: '#0e7490', buttonTextColor: '#ffffff', buttonHoverBackground: '#155e75', buttonHoverTextColor: '#ffffff',
      heroBackground: '#1f2937', heroTextColor: '#ffffff', heroAccentColor: '#fbbf24',
      statsBackground: '#ffffff', statsAccentColor: '#0e7490',
      successColor: '#15803d', dangerColor: '#b91c1c',
      glowColor: '#374151', gradientStart: '#0e7490', gradientEnd: '#6366f1',
      cardRadius: 'soft', buttonRadius: 'soft', shadowStrength: 'subtle',
      headingFont: 'Inter', bodyFont: 'Inter',
    }),
    'emerald': preset('Emerald', 'Deep green with fresh mint surfaces.', {
      primaryColor: '#059669', secondaryColor: '#052e24', accentColor: '#f5b73d',
      pageBackground: '#f3fbf7', surfaceColor: '#ffffff', alternateSurfaceColor: '#e9f7f0',
      headingColor: '#06281f', bodyTextColor: '#1f3d33', mutedTextColor: '#4d6b60',
      borderColor: '#cfeadd',
      buttonBackground: '#047857', buttonTextColor: '#ffffff', buttonHoverBackground: '#065f46', buttonHoverTextColor: '#ffffff',
      heroBackground: '#052e24', heroTextColor: '#ffffff', heroAccentColor: '#6ee7b7',
      statsBackground: '#ffffff', statsAccentColor: '#047857',
      successColor: '#16a34a', dangerColor: '#dc2626',
      glowColor: '#0b5a44', gradientStart: '#059669', gradientEnd: '#0ea5e9',
      cardRadius: 'rounded', buttonRadius: 'soft', shadowStrength: 'subtle',
      headingFont: 'DM Serif Display', bodyFont: 'Inter',
    }),
    'rose': preset('Rose', 'Soft blush with a confident rose accent.', {
      primaryColor: '#e11d63', secondaryColor: '#3b0a1f', accentColor: '#f59e0b',
      pageBackground: '#fff7f9', surfaceColor: '#ffffff', alternateSurfaceColor: '#ffeef3',
      headingColor: '#3b0a1f', bodyTextColor: '#4f2336', mutedTextColor: '#80566a',
      borderColor: '#f8d7e1',
      buttonBackground: '#be123c', buttonTextColor: '#ffffff', buttonHoverBackground: '#9f1239', buttonHoverTextColor: '#ffffff',
      heroBackground: '#3b0a1f', heroTextColor: '#ffffff', heroAccentColor: '#fda4af',
      statsBackground: '#ffffff', statsAccentColor: '#be123c',
      successColor: '#15803d', dangerColor: '#b91c1c',
      glowColor: '#6d1a3c', gradientStart: '#e11d63', gradientEnd: '#a855f7',
      cardRadius: 'extra', buttonRadius: 'pill', shadowStrength: 'medium',
      headingFont: 'Playfair Display', bodyFont: 'Poppins',
    }),
    'midnight': preset('Midnight', 'Near-black with electric violet and gold.', {
      primaryColor: '#8b5cf6', secondaryColor: '#0b0b1a', accentColor: '#facc15',
      pageBackground: '#0f1020', surfaceColor: '#181a30', alternateSurfaceColor: '#13152a',
      headingColor: '#f4f4ff', bodyTextColor: '#d4d6ee', mutedTextColor: '#a2a6c8',
      borderColor: '#2c2f52',
      buttonBackground: '#6d3fe0', buttonTextColor: '#ffffff', buttonHoverBackground: '#5b2fc9', buttonHoverTextColor: '#ffffff',
      heroBackground: '#0b0b1a', heroTextColor: '#ffffff', heroAccentColor: '#facc15',
      statsBackground: '#181a30', statsAccentColor: '#c4b5fd',
      successColor: '#34d399', dangerColor: '#fb7185',
      glowColor: '#2a1f66', gradientStart: '#8b5cf6', gradientEnd: '#38bdf8',
      cardRadius: 'rounded', buttonRadius: 'soft', shadowStrength: 'strong',
      headingFont: 'Libre Baskerville', bodyFont: 'Inter',
    }),
  };
  var PRESET_ORDER = ['fmr-navy', 'warm-gold', 'clinical-white', 'emerald', 'rose', 'midnight'];
  var CUSTOM_PRESET = 'custom';
  var DEFAULT_PRESET = 'clinical-white'; // new courses
  var FALLBACK_PRESET = 'fmr-navy';      // legacy courses with no row (their current look)

  /** True only for real preset keys (own properties; never __proto__ etc.). */
  function isPresetKey(name) {
    return typeof name === 'string' && Object.prototype.hasOwnProperty.call(PRESETS, name);
  }

  function isValidPresetName(name) {
    return name === CUSTOM_PRESET || isPresetKey(name);
  }

  /** Plain value object for a preset (no label/description). */
  function presetValues(name) {
    if (!isPresetKey(name)) return null;
    var p = PRESETS[name];
    var out = {};
    Object.keys(p).forEach(function (k) { if (k !== 'label' && k !== 'description') out[k] = p[k]; });
    out.themePreset = name;
    return out;
  }

  var ALL_FIELDS = COLOR_FIELDS.concat(['cardRadius', 'buttonRadius', 'shadowStrength', 'headingFont', 'bodyFont']);

  /**
   * Validate + normalise user input against the allowlists.
   * `base` supplies values for fields absent from `input` (partial updates).
   * Returns { values, errors }; `errors` is a list of human-readable strings.
   */
  function validateAppearance(input, base) {
    var errors = [];
    var values = {};
    var src = input || {};
    var bas = base || presetValues(FALLBACK_PRESET);

    COLOR_FIELDS.forEach(function (f) {
      if (src[f] === undefined || src[f] === null || src[f] === '') { values[f] = bas[f]; return; }
      var n = normalizeHex(String(src[f]));
      if (!n) { errors.push(f + ' must be a HEX colour like #1a2b3c.'); values[f] = bas[f]; } else values[f] = n;
    });

    function pick(field, table, label) {
      var v = src[field];
      if (v === undefined || v === null || v === '') { values[field] = bas[field]; return; }
      if (typeof v !== 'string' || !Object.prototype.hasOwnProperty.call(table, v)) {
        errors.push(label + ' is not an allowed option.'); values[field] = bas[field];
      } else values[field] = v;
    }
    pick('cardRadius', CARD_RADII, 'Card style');
    pick('buttonRadius', BUTTON_RADII, 'Button style');
    pick('shadowStrength', SHADOWS, 'Shadow');
    pick('headingFont', HEADING_FONTS, 'Heading font');
    pick('bodyFont', BODY_FONTS, 'Body font');

    var preset = src.themePreset;
    if (preset === undefined || preset === null || preset === '') values.themePreset = bas.themePreset || CUSTOM_PRESET;
    else if (typeof preset !== 'string' || !isValidPresetName(preset)) { errors.push('Theme preset is not allowed.'); values.themePreset = bas.themePreset || CUSTOM_PRESET; }
    else values.themePreset = preset;

    return { values: values, errors: errors };
  }

  function shadowCss(spec, color) {
    if (spec === 'none' || typeof spec === 'string') return 'none';
    return '0 ' + spec[1] + 'px ' + spec[2] + 'px ' + rgba(color, spec[3]);
  }

  /**
   * Build the full CSS custom property map for a (validated) appearance.
   * Includes the 29 documented --course-* variables plus derived tints that
   * keep the stylesheet free of hardcoded theme colours.
   */
  function buildCssVars(a) {
    var v = validateAppearance(a, presetValues(FALLBACK_PRESET)).values;
    var white = '#ffffff';
    var sh = SHADOWS[v.shadowStrength];
    var hf = HEADING_FONTS[v.headingFont], bf = BODY_FONTS[v.bodyFont];
    var base = {
      '--course-primary': v.primaryColor,
      '--course-secondary': v.secondaryColor,
      '--course-accent': v.accentColor,
      '--course-page-bg': v.pageBackground,
      '--course-surface': v.surfaceColor,
      '--course-surface-alt': v.alternateSurfaceColor,
      '--course-heading': v.headingColor,
      '--course-text': v.bodyTextColor,
      '--course-muted': v.mutedTextColor,
      '--course-border': v.borderColor,
      '--course-button-bg': v.buttonBackground,
      '--course-button-text': v.buttonTextColor,
      '--course-button-hover-bg': v.buttonHoverBackground,
      '--course-button-hover-text': v.buttonHoverTextColor,
      '--course-hero-bg': v.heroBackground,
      '--course-hero-text': v.heroTextColor,
      '--course-hero-accent': v.heroAccentColor,
      '--course-stats-bg': v.statsBackground,
      '--course-stats-accent': v.statsAccentColor,
      '--course-success': v.successColor,
      '--course-danger': v.dangerColor,
      '--course-glow': v.glowColor,
      '--course-gradient-start': v.gradientStart,
      '--course-gradient-end': v.gradientEnd,
      '--course-card-radius': CARD_RADII[v.cardRadius],
      '--course-button-radius': BUTTON_RADII[v.buttonRadius],
      '--course-shadow': shadowCss(sh.sm, v.secondaryColor),
      '--course-heading-font': hf.stack,
      '--course-body-font': bf.stack,
    };
    // Derived tokens (computed here so the stylesheet needs no theme colours).
    var derived = {
      '--course-primary-soft': mix(v.primaryColor, white, 0.92),
      '--course-primary-line': mix(v.primaryColor, white, 0.85),
      '--course-primary-dark': mix(v.primaryColor, '#000000', 0.15),
      '--course-button-bg-end': mix(v.buttonBackground, white, 0.18),
      '--course-button-hover-bg-end': mix(v.buttonHoverBackground, white, 0.18),
      '--course-button-glow': rgba(v.buttonBackground, 0.35),
      '--course-button-glow-hover': rgba(v.buttonBackground, 0.45),
      '--course-border-strong': mix(v.borderColor, v.primaryColor, 0.12),
      '--course-border-soft': mix(v.borderColor, v.surfaceColor, 0.55),
      '--course-faint': mix(v.mutedTextColor, v.surfaceColor, 0.4),
      '--course-surface-tint': mix(v.surfaceColor, v.alternateSurfaceColor, 0.5),
      '--course-secondary-dark': mix(v.heroBackground, '#000000', 0.3),
      '--course-glow-soft': mix(v.glowColor, v.heroBackground, 0.19),
      '--course-accent-light': mix(v.heroAccentColor, white, 0.5),
      '--course-accent-pale': mix(v.heroAccentColor, white, 0.75),
      '--course-accent-bg': mix(v.accentColor, white, 0.9),
      '--course-success-soft': mix(v.successColor, white, 0.9),
      '--course-danger-soft': mix(v.dangerColor, white, 0.88),
      '--course-shadow-hover': shadowCss(sh.md, v.secondaryColor),
      '--course-shadow-lg': shadowCss(sh.lg, v.secondaryColor),
      '--course-shadow-primary': sh.md === 'none' ? 'none' : shadowCss(sh.md, v.primaryColor),
      '--course-hero-shadow': '0 24px 60px rgba(0, 0, 0, 0.45)',
    };
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    Object.keys(derived).forEach(function (k) { out[k] = derived[k]; });
    return out;
  }

  /** "--a:b;--c:d" string for a style="" attribute. Values are generated only. */
  function toStyleAttr(vars) {
    return Object.keys(vars).map(function (k) { return k + ':' + vars[k]; }).join(';');
  }

  /** Google Fonts stylesheet URL for the fonts a theme actually uses (or null). */
  function googleFontsUrl(a) {
    var fams = [];
    var h = HEADING_FONTS[a.headingFont], b = BODY_FONTS[a.bodyFont];
    if (h && h.google) fams.push(h.google);
    if (b && b.google && fams.indexOf(b.google) === -1) fams.push(b.google);
    if (!fams.length) return null;
    return 'https://fonts.googleapis.com/css2?family=' + fams.join('&family=') + '&display=swap';
  }

  return {
    COLOR_FIELDS: COLOR_FIELDS, ALL_FIELDS: ALL_FIELDS,
    HEADING_FONTS: HEADING_FONTS, BODY_FONTS: BODY_FONTS,
    CARD_RADII: CARD_RADII, CARD_RADIUS_LABELS: CARD_RADIUS_LABELS,
    BUTTON_RADII: BUTTON_RADII, BUTTON_RADIUS_LABELS: BUTTON_RADIUS_LABELS,
    SHADOWS: SHADOWS, SHADOW_LABELS: SHADOW_LABELS,
    PRESETS: PRESETS, PRESET_ORDER: PRESET_ORDER, CUSTOM_PRESET: CUSTOM_PRESET,
    DEFAULT_PRESET: DEFAULT_PRESET, FALLBACK_PRESET: FALLBACK_PRESET,
    normalizeHex: normalizeHex, mix: mix, contrastRatio: contrastRatio, checkContrast: checkContrast,
    isValidPresetName: isValidPresetName, isPresetKey: isPresetKey, presetValues: presetValues,
    validateAppearance: validateAppearance, buildCssVars: buildCssVars,
    toStyleAttr: toStyleAttr, googleFontsUrl: googleFontsUrl,
  };
});
