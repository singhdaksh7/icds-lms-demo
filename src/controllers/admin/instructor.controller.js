const instructorService = require('../../services/instructor.service');
const { validateInstructor, STATUSES } = require('../../validators/instructor.validator');
const imageStorage = require('../../lib/imageStorage');

async function listInstructors(req, res, next) {
  try {
    const instructors = await instructorService.listInstructorsAdmin();
    res.render('admin/instructors/list', {
      pageTitle: 'Manage Instructors | Admin',
      metaDescription: 'Admin instructor management.',
      instructors,
    });
  } catch (err) {
    next(err);
  }
}

function newInstructorForm(req, res) {
  res.render('admin/instructors/form', {
    pageTitle: 'New Instructor | Admin',
    metaDescription: 'Create a new instructor.',
    instructor: null,
    statuses: STATUSES,
    errors: [],
    values: {},
  });
}

async function createInstructor(req, res, next) {
  try {
    const { errors, values } = validateInstructor(req.body);

    if (errors.length > 0) {
      return res.status(400).render('admin/instructors/form', {
        pageTitle: 'New Instructor | Admin',
        metaDescription: 'Create a new instructor.',
        instructor: null,
        statuses: STATUSES,
        errors,
        values: req.body,
      });
    }

    await instructorService.createInstructor(values);
    req.flashSuccess('Instructor created successfully.');
    res.redirect('/admin/instructors');
  } catch (err) {
    next(err);
  }
}

async function editInstructorForm(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const instructor = await instructorService.getInstructorByIdAdmin(id);
    if (!instructor) {
      req.flashError('Instructor not found.');
      return res.redirect('/admin/instructors');
    }

    res.render('admin/instructors/form', {
      pageTitle: `Edit: ${instructor.name} | Admin`,
      metaDescription: 'Edit instructor.',
      instructor,
      statuses: STATUSES,
      errors: [],
      values: instructor,
    });
  } catch (err) {
    next(err);
  }
}

async function updateInstructor(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const { errors, values } = validateInstructor(req.body);

    if (errors.length > 0) {
      const instructor = await instructorService.getInstructorByIdAdmin(id);
      return res.status(400).render('admin/instructors/form', {
        pageTitle: 'Edit Instructor | Admin',
        metaDescription: 'Edit instructor.',
        instructor,
        statuses: STATUSES,
        errors,
        values: { ...req.body, id },
      });
    }

    await instructorService.updateInstructor(id, values);
    req.flashSuccess('Instructor updated successfully.');
    res.redirect('/admin/instructors');
  } catch (err) {
    if (err instanceof instructorService.InstructorError) {
      req.flashError(err.message);
      return res.redirect('/admin/instructors');
    }
    next(err);
  }
}

async function uploadInstructorPhoto(req, res, next) {
  const id = parseInt(req.params.id, 10);
  try {
    if (!req.file) {
      req.flashError('No image file was uploaded.');
      return res.redirect(`/admin/instructors/${id}/edit`);
    }
    const newUrl = imageStorage.publicUrlFor(req.file.filename);
    const oldUrl = await instructorService.setInstructorPhoto(id, newUrl);
    imageStorage.deleteIfOwned(oldUrl);
    req.flashSuccess('Photo updated.');
    res.redirect(`/admin/instructors/${id}/edit`);
  } catch (err) {
    if (err instanceof instructorService.InstructorError) {
      req.flashError(err.message);
      return res.redirect('/admin/instructors');
    }
    next(err);
  }
}

async function deleteInstructor(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const affectedCourseCount = await instructorService.deleteInstructor(id);
    req.flashSuccess(
      affectedCourseCount > 0
        ? `Instructor deleted. ${affectedCourseCount} course(s) no longer have an assigned instructor.`
        : 'Instructor deleted.'
    );
  } catch (err) {
    if (err instanceof instructorService.InstructorError) {
      req.flashError(err.message);
    } else {
      return next(err);
    }
  }
  res.redirect('/admin/instructors');
}

module.exports = {
  listInstructors,
  newInstructorForm,
  createInstructor,
  editInstructorForm,
  updateInstructor,
  uploadInstructorPhoto,
  deleteInstructor,
};
