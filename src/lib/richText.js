// Safe inline text formatting for admin-edited content.
//
// Admins can wrap text in a small, fixed set of tags — typed by hand or
// inserted with the toolbar in public/js/admin-format.js:
//   [b]bold[/b]  [i]italic[/i]  [u]underline[/u]  [s]strike[/s]
//   [size=24]text[/size]   (10-96 px)      [color=#c0392b]text[/color]
//
// Views keep escaping every value with <%= %> as before, so by the time this
// runs ALL user text is already HTML-escaped and the square-bracket tags are
// still plain text. This module converts only that exact whitelisted grammar
// into <strong>/<em>/<u>/<s>/<span style>, and only inside text nodes of the
// final HTML. It can therefore never introduce markup the admin typed
// themselves (< and > are already &lt; / &gt;), and the size/colour values
// are validated numerics / hex codes, not free-form CSS.
const MIN_SIZE = 10;
const MAX_SIZE = 96;

const ANY_TOKEN = /\[(?:\/?(?:b|i|u|s|size|color)|(?:size=\d{1,3})|(?:color=#[0-9a-fA-F]{3,8}))\]/g;

// An old toolbar bug inserted the literal word "text" when a format button was pressed with nothing selected,
// e.g. "STAY UPDATED [color=#fafafa]text[/color]". Such empty placeholders are never real content: they are
// dropped on render (and repaired in stored values by fixStoredPlaceholders).
const PLACEHOLDER = /[ \t]*\[(?:b|i|u|s|size=\d{1,3}|color=#[0-9a-fA-F]{3,8})\]text\[\/(?:b|i|u|s|size|color)\]/g;
const PLACEHOLDER_OPEN = /\[(b|i|u|s|size=\d{1,3}|color=#[0-9a-fA-F]{3,8})\]text\[\/(b|i|u|s|size|color)\]/;

// Repairs a STORED value: removes the placeholder and, to keep the author's intent, applies that same
// formatting to the rest of the text ("STAY UPDATED [color=#fafafa]text[/color]" -> "[color=#fafafa]STAY UPDATED[/color]").
function fixStoredPlaceholders(value) {
  if (typeof value !== 'string' || value.indexOf(']text[/') === -1) return value;
  const first = PLACEHOLDER_OPEN.exec(value);
  if (!first) return value;
  const rest = value.replace(PLACEHOLDER, '').trim();
  if (!rest) return '';
  if (ANY_TOKEN.test(rest)) { ANY_TOKEN.lastIndex = 0; return rest; } // already formatted: just drop the placeholder
  ANY_TOKEN.lastIndex = 0;
  return `[${first[1]}]${rest}[/${first[2]}]`;
}

function applyTokens(text) {
  let out = text.replace(PLACEHOLDER, '');
  // Innermost-first single passes; repeated so nesting like
  // [b][u]x[/u][/b] resolves, bounded to stay cheap on hostile input.
  for (let pass = 0; pass < 4; pass += 1) {
    const before = out;
    out = out
      .replace(/\[b\]([\s\S]*?)\[\/b\]/g, '<strong>$1</strong>')
      .replace(/\[i\]([\s\S]*?)\[\/i\]/g, '<em>$1</em>')
      .replace(/\[u\]([\s\S]*?)\[\/u\]/g, '<u>$1</u>')
      .replace(/\[s\]([\s\S]*?)\[\/s\]/g, '<s>$1</s>')
      .replace(/\[size=(\d{1,3})\]([\s\S]*?)\[\/size\]/g, (m, n, inner) => {
        const px = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Number(n)));
        return `<span style="font-size:${px}px;line-height:1.25">${inner}</span>`;
      })
      .replace(/\[color=(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))\]([\s\S]*?)\[\/color\]/g, '<span style="color:$1">$2</span>');
    if (out === before) break;
  }
  // Anything unmatched/unbalanced is dropped rather than shown as clutter.
  return out.replace(ANY_TOKEN, '');
}

function stripTokens(text) {
  return text.replace(ANY_TOKEN, '');
}

const RAW_TEXT_TAGS = new Set(['script', 'style', 'title', 'textarea']);
const DISPLAY_ATTRS = /(\s(?:alt|title|aria-label|content)=")([^"]*)(")/gi;

// Converts markup tokens in the text nodes of a rendered HTML document.
function renderMarkup(html) {
  if (typeof html !== 'string' || html.indexOf('[') === -1) return html;

  const parts = html.split(/(<[^>]*>)/);
  let rawTag = null;

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part.charAt(0) === '<') {
      const m = /^<\s*(\/?)\s*([a-zA-Z0-9]+)/.exec(part);
      if (m) {
        const name = m[2].toLowerCase();
        if (m[1] === '/') {
          if (rawTag === name) rawTag = null;
        } else if (!rawTag && RAW_TEXT_TAGS.has(name) && !/\/\s*>$/.test(part)) {
          rawTag = name;
        }
      }
      if (part.indexOf('[') !== -1) {
        parts[i] = part.replace(DISPLAY_ATTRS, (all, pre, val, post) => pre + stripTokens(val) + post);
      }
    } else if (part.indexOf('[') !== -1) {
      if (rawTag === 'textarea') continue; // form content stays literal
      parts[i] = rawTag ? stripTokens(part) : applyTokens(part);
    }
  }
  return parts.join('');
}

// Express middleware: post-processes rendered pages. Admin pages are left
// untouched so the editing forms always show (and re-save) the raw markup.
function middleware(req, res, next) {
  if (req.path === '/admin' || req.path.startsWith('/admin/')) return next();

  const originalRender = res.render.bind(res);
  res.render = function render(view, options, callback) {
    let opts = options;
    let cb = callback;
    if (typeof opts === 'function') {
      cb = opts;
      opts = undefined;
    }
    originalRender(view, opts, (err, html) => {
      if (err) return cb ? cb(err) : next(err);
      const out = renderMarkup(html);
      return cb ? cb(null, out) : res.send(out);
    });
  };
  return next();
}

module.exports = { renderMarkup, middleware, fixStoredPlaceholders, MIN_SIZE, MAX_SIZE };
