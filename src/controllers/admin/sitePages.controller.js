const sitePages = require('../../services/sitePages.service');

const editUrl = (slug) => `/admin/pages/${encodeURIComponent(slug)}`;

async function list(req, res, next) {
  try {
    const pages = await sitePages.listPagesAdmin();
    res.render('admin/pages/list', { pageTitle: 'Pages | Admin', metaDescription: 'Standalone website pages.', activeNav: 'pages', pages });
  } catch (err) {
    next(err);
  }
}

async function edit(req, res, next) {
  try {
    const data = await sitePages.getPageAdmin(req.params.slug, res.locals.cms);
    res.render('admin/pages/edit', {
      pageTitle: `${data.meta.label} page | Admin`,
      metaDescription: `Edit the ${data.meta.label} page.`,
      activeNav: 'pages',
      ...data,
    });
  } catch (err) {
    if (err instanceof sitePages.SitePageError) {
      req.flashError(err.message);
      return res.redirect('/admin/pages');
    }
    next(err);
  }
}

// Wraps a mutation: flash + redirect back to the page editor.
function action(okMessage, run) {
  return async (req, res, next) => {
    try {
      await run(req, res);
      req.flashSuccess(okMessage);
    } catch (err) {
      if (err instanceof sitePages.SitePageError) {
        if (err.statusCode === 404) {
          req.flashError(err.message);
          return res.redirect('/admin/pages');
        }
        req.flashError(err.message);
      } else {
        return next(err);
      }
    }
    return res.redirect(editUrl(req.params.slug));
  };
}

const save = action('Page saved.', (req, res) => sitePages.updatePage(req.params.slug, req.body, res.locals.cms));
const addSection = action('Section added.', (req, res) => sitePages.addSection(req.params.slug, req.body, res.locals.cms));
const updateSection = action('Section saved.', (req) => sitePages.updateSection(req.params.slug, parseInt(req.params.id, 10), req.body));
const deleteSection = action('Section deleted.', (req) => sitePages.deleteSection(req.params.slug, parseInt(req.params.id, 10)));
const moveSection = action('Section moved.', (req) => sitePages.moveSection(req.params.slug, parseInt(req.params.id, 10), req.body.direction));

module.exports = { list, edit, save, addSection, updateSection, deleteSection, moveSection };
