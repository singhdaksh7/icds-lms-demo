const svc = require('../../services/homeSections.service');

const BASE = '/admin/homepage/sections';

async function show(req, res, next) {
  try {
    const config = await svc.getSectionConfig();
    res.render('admin/homepage/sections', {
      pageTitle: 'Homepage Sections | Admin',
      metaDescription: 'Homepage section order and visibility.',
      sections: config,
      labels: Object.fromEntries(svc.SECTIONS.map((s) => [s.key, s.label])),
    });
  } catch (err) {
    next(err);
  }
}

async function run(req, res, next, fn, okMessage) {
  try {
    await fn();
    if (okMessage) req.flashSuccess(okMessage);
    res.redirect(BASE);
  } catch (err) {
    if (err instanceof svc.HomeSectionsError) {
      req.flashError(err.message);
      return res.redirect(BASE);
    }
    return next(err);
  }
}

const toggle = (req, res, next) => run(req, res, next, () => svc.toggleSection(req.params.key), 'Section visibility updated.');
const move = (req, res, next) => run(req, res, next, () => svc.moveSection(req.params.key, req.body.direction));

module.exports = { show, toggle, move };
