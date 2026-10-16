// Centralized SEO/meta helpers. Views should never hand-roll <meta> tags —
// pass a `seo` object to res.render and let views/partials/seo-head.ejs
// render it consistently. See README "SEO Configuration".
const site = require('../config/site');

// Absolute origin for this request: prefers the configured APP_BASE_URL
// (required for correct output behind a proxy/CDN or when generating URLs
// outside a request, e.g. emails/sitemap) and only falls back to deriving
// one from the current request (never a hardcoded localhost) when unset —
// keeps local dev working without ever leaking "localhost" into a
// production response if APP_BASE_URL was simply forgotten.
function getOrigin(req) {
  if (site.baseUrl) return site.baseUrl;
  if (req) return `${req.protocol}://${req.get('host')}`;
  return '';
}

// Builds an absolute URL for a site-relative path (must start with "/").
function absoluteUrl(req, pathname) {
  const origin = getOrigin(req);
  if (!origin) return pathname;
  return `${origin}${pathname}`;
}

const DEFAULT_ROBOTS = 'noindex, nofollow';
const PUBLIC_ROBOTS = 'index, follow';

// Builds the full set of locals the seo-head partial needs. Callers only
// specify what differs from the safe defaults:
//   - robots defaults to noindex,nofollow (opt IN to indexing per page,
//     rather than having to remember to opt every private page out)
//   - description/ogImage fall back to site-level values
//   - canonical is only emitted for indexable pages unless explicitly set
function buildSeo(req, options = {}) {
  const {
    title,
    description,
    path: pathname = req ? req.originalUrl.split('?')[0] : '',
    robots = DEFAULT_ROBOTS,
    ogType = 'website',
    ogImage,
    jsonLd,
    noCanonical = false,
  } = options;

  const isIndexable = robots.split(',').map((s) => s.trim()).includes('index');
  const canonical = !noCanonical && isIndexable ? absoluteUrl(req, pathname) : null;

  return {
    title: title || site.seoTitle || site.name,
    description: description || site.seoDescription || `${site.name} — professional online courses.`,
    robots,
    canonical,
    ogType,
    ogUrl: canonical || absoluteUrl(req, pathname),
    ogImage: ogImage || null,
    jsonLd: jsonLd || null,
  };
}

// Admin-managed per-page SEO text (Site Content > <page> SEO). `page` is the
// settings namespace ("home", "courses", ...). The page-specific value wins;
// the homepage additionally honours the global default title/description;
// otherwise the page's automatic text is used. `settings` is the flat map on
// res.locals (null when the DB was unreachable).
function pageSeoText(settings, page, fallback) {
  const s = settings || {};
  const own = (field) => (typeof s[`seo.${page}.${field}`] === 'string' ? s[`seo.${page}.${field}`].trim() : '');
  const global = (field) => (page === 'home' && typeof s[`seo.default${field}`] === 'string' ? s[`seo.default${field}`].trim() : '');
  return {
    title: own('title') || global('Title') || fallback.title,
    description: own('description') || global('Description') || fallback.description,
  };
}

module.exports = {
  pageSeoText,
  DEFAULT_ROBOTS,
  PUBLIC_ROBOTS,
  getOrigin,
  absoluteUrl,
  buildSeo,
};
