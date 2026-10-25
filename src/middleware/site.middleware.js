const site = require('../config/site');
const { getEffectiveCoursePrice } = require('../lib/pricing');
const { getActiveCategories } = require('../services/home.service');
const { getSettings, defaultContent, fill } = require('../services/settings.service');
const { getPublicNav } = require('../services/navigation.service');

// Attaches global site config plus a small, cached list of active categories
// for the footer's "Categories" column, so it links to real category slugs
// instead of hard-coded names that can drift from the catalog. Cached briefly
// since this runs on every request and the category list changes rarely.
let categoriesCache = { data: [], expiresAt: 0 };
const CACHE_TTL_MS = 60 * 1000;

async function getFooterCategories() {
  if (Date.now() < categoriesCache.expiresAt) return categoriesCache.data;
  try {
    const categories = await getActiveCategories();
    categoriesCache = { data: categories, expiresAt: Date.now() + CACHE_TTL_MS };
    return categories;
  } catch (err) {
    return categoriesCache.data;
  }
}

// `cms` is the nested, typed site-content object (cms.hero.heading, ...);
// `settings` is the same data as a flat key->string map. Both come from ONE
// cached read per request - views never query settings themselves.
module.exports = async (req, res, next) => {
  res.locals.site = site;
  res.locals.fill = fill;
  res.locals.currentPath = req.path;
  // Single source of truth for course prices in every template (sale-window aware).
  res.locals.coursePriceOf = getEffectiveCoursePrice;
  try {
    // Admin-managed header/footer navigation (cached ~30s; never throws).
    const [categories, settings, nav] = await Promise.all([getFooterCategories(), getSettings(), getPublicNav()]);
    res.locals.navHeader = nav.header;
    res.locals.navFooter = nav.footer;
    res.locals.footerCategories = categories;
    res.locals.settings = settings;
    res.locals.cms = settings.cms;
  } catch (err) {
    res.locals.footerCategories = [];
    res.locals.settings = null;
    res.locals.cms = defaultContent();
  }
  next();
};
