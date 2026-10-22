const svc = require('../../services/founderAdmin.service');

const BASE = '/admin/founder';

async function show(req, res, next) {
  try {
    const [data, instructors, sections] = await Promise.all([
      svc.listAll(),
      svc.listInstructorOptions(),
      svc.getSectionConfig(),
    ]);
    res.render('admin/founder/index', {
      pageTitle: 'Founder Page | Admin',
      metaDescription: 'Manage the founder page.',
      data,
      instructors,
      sections,
      researchKinds: svc.RESEARCH_KINDS,
    });
  } catch (err) {
    next(err);
  }
}

async function run(req, res, next, fn, okMessage, anchor) {
  try {
    await fn();
    if (okMessage) req.flashSuccess(okMessage);
  } catch (err) {
    if (!(err instanceof svc.FounderAdminError)) return next(err);
    req.flashError(err.message);
  }
  return res.redirect(BASE + (anchor ? `#${anchor}` : ''));
}

const id = (req) => parseInt(req.params.id, 10);

const saveProfile = (req, res, next) =>
  run(req, res, next, () => svc.saveFounderProfile(req.body), 'Founder profile saved.', 'profile');
const createItem = (req, res, next) =>
  run(req, res, next, () => svc.createItem(req.params.entity, req.body), 'Item added.', req.params.entity);
const updateItem = (req, res, next) =>
  run(req, res, next, () => svc.updateItem(req.params.entity, id(req), req.body), 'Item updated.', req.params.entity);
const deleteItem = (req, res, next) =>
  run(req, res, next, () => svc.deleteItem(req.params.entity, id(req)), 'Item deleted.', req.params.entity);
const togglePublished = (req, res, next) =>
  run(req, res, next, () => svc.togglePublished(req.params.entity, id(req)), 'Visibility updated.', req.params.entity);
const moveItem = (req, res, next) =>
  run(req, res, next, () => svc.moveItem(req.params.entity, id(req), req.body.direction), null, req.params.entity);
const toggleSection = (req, res, next) =>
  run(req, res, next, () => svc.toggleSection(req.params.key), 'Section visibility updated.', 'sections');
const moveSection = (req, res, next) =>
  run(req, res, next, () => svc.moveSection(req.params.key, req.body.direction), null, 'sections');

module.exports = { show, saveProfile, createItem, updateItem, deleteItem, togglePublished, moveItem, toggleSection, moveSection };
