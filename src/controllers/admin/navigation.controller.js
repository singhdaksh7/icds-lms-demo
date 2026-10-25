const navigation = require('../../services/navigation.service');
const sitePages = require('../../services/sitePages.service');

const BASE = '/admin/navigation';

async function list(req, res, next) {
  try {
    const [items, pages] = await Promise.all([navigation.listNavAdmin(), sitePages.listPagesAdmin()]);
    res.render('admin/navigation/list', {
      pageTitle: 'Navigation | Admin',
      metaDescription: 'Header and footer navigation.',
      activeNav: 'navigation',
      items,
      pages,
      locations: navigation.LOCATIONS,
      locationLabels: navigation.LOCATION_LABELS,
      usingDefaults: items.length === 0,
      defaults: navigation.DEFAULT_NAV,
    });
  } catch (err) {
    next(err);
  }
}

function action(okMessage, run) {
  return async (req, res, next) => {
    try {
      await run(req);
      if (okMessage) req.flashSuccess(okMessage);
    } catch (err) {
      if (err instanceof navigation.NavigationError) req.flashError(err.message);
      else return next(err);
    }
    return res.redirect(BASE);
  };
}

const id = (req) => parseInt(req.params.id, 10);

const create = action('Navigation item added.', (req) => navigation.createNavItem(req.body));
const update = action('Navigation item saved.', (req) => navigation.updateNavItem(id(req), req.body));
const remove = action('Navigation item deleted.', (req) => navigation.deleteNavItem(id(req)));
const move = action('', (req) => navigation.moveNavItem(id(req), req.body.direction));
// Toggle only flips published (boolean-safe: explicit value, never a blind invert).
const toggle = action('Navigation item updated.', (req) => navigation.updateNavItem(id(req), { isPublished: req.body.isPublished }));
const seedDefaults = action('Default navigation added.', () => navigation.ensureDefaultNav());

module.exports = { list, create, update, remove, move, toggle, seedDefaults };
