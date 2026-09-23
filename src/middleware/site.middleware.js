const site = require('../config/site');
const { getActiveCategories } = require('../services/home.service');
const { getSettings } = require('../services/settings.service');

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

module.exports = async (req, res, next) => {
  res.locals.site = site;
  try {
    const [categories, settings] = await Promise.all([getFooterCategories(), getSettings()]);
    res.locals.footerCategories = categories;
    res.locals.settings = settings;
  } catch (err) {
    res.locals.footerCategories = [];
    res.locals.settings = null;
  }
  next();
};
