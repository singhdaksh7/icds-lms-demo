const categoryService = require('../../services/category.service');
const { validateCategory, STATUSES } = require('../../validators/category.validator');

async function listCategories(req, res, next) {
  try {
    const categories = await categoryService.listCategoriesAdmin();
    res.render('admin/categories/list', {
      pageTitle: 'Manage Categories | Admin',
      metaDescription: 'Admin category management.',
      categories,
      statuses: STATUSES,
      errors: [],
      values: {},
    });
  } catch (err) {
    next(err);
  }
}

async function createCategory(req, res, next) {
  try {
    const { errors, values } = validateCategory(req.body);

    if (errors.length > 0) {
      const categories = await categoryService.listCategoriesAdmin();
      return res.status(400).render('admin/categories/list', {
        pageTitle: 'Manage Categories | Admin',
        metaDescription: 'Admin category management.',
        categories,
        statuses: STATUSES,
        errors,
        values: req.body,
      });
    }

    await categoryService.createCategory(values);
    req.flashSuccess('Category created successfully.');
    res.redirect('/admin/categories');
  } catch (err) {
    next(err);
  }
}

async function updateCategory(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const { errors, values } = validateCategory(req.body);

    if (errors.length > 0) {
      req.flashError(errors.join(' '));
      return res.redirect('/admin/categories');
    }

    await categoryService.updateCategory(id, values);
    req.flashSuccess('Category updated successfully.');
    res.redirect('/admin/categories');
  } catch (err) {
    if (err instanceof categoryService.CategoryError) {
      req.flashError(err.message);
      return res.redirect('/admin/categories');
    }
    next(err);
  }
}

async function deleteCategory(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const affectedCourseCount = await categoryService.deleteCategory(id);
    req.flashSuccess(
      affectedCourseCount > 0
        ? `Category deleted. ${affectedCourseCount} course(s) are now uncategorized.`
        : 'Category deleted.'
    );
  } catch (err) {
    if (err instanceof categoryService.CategoryError) {
      req.flashError(err.message);
    } else {
      return next(err);
    }
  }
  res.redirect('/admin/categories');
}

module.exports = { listCategories, createCategory, updateCategory, deleteCategory };
