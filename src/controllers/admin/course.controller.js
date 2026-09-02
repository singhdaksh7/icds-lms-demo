const courseService = require('../../services/course.service');
const { prisma } = require('../../config/db');
const { validateCourse, LEVELS, STATUSES } = require('../../validators/course.validator');
const { parsePage } = require('../../lib/pagination');

async function getFormOptions() {
  const [categories, instructors] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: 'asc' } }),
    prisma.instructor.findMany({ orderBy: { name: 'asc' } }),
  ]);
  return { categories, instructors };
}

async function listCourses(req, res, next) {
  try {
    const page = parsePage(req.query.page);
    const { courses, pagination } = await courseService.listCoursesAdmin({ page });

    const pageUrl = (targetPage) => `/admin/courses${targetPage > 1 ? `?page=${targetPage}` : ''}`;

    res.render('admin/courses/list', {
      pageTitle: 'Manage Courses | Admin',
      metaDescription: 'Admin course management.',
      courses,
      pagination,
      pageUrl,
    });
  } catch (err) {
    next(err);
  }
}

async function newCourseForm(req, res, next) {
  try {
    const { categories, instructors } = await getFormOptions();
    res.render('admin/courses/form', {
      pageTitle: 'New Course | Admin',
      metaDescription: 'Create a new course.',
      course: null,
      categories,
      instructors,
      levels: LEVELS,
      statuses: STATUSES,
      errors: [],
      values: {},
    });
  } catch (err) {
    next(err);
  }
}

async function createCourse(req, res, next) {
  try {
    const { errors, values } = validateCourse(req.body);
    const { categories, instructors } = await getFormOptions();

    if (errors.length > 0) {
      return res.status(400).render('admin/courses/form', {
        pageTitle: 'New Course | Admin',
        metaDescription: 'Create a new course.',
        course: null,
        categories,
        instructors,
        levels: LEVELS,
        statuses: STATUSES,
        errors,
        values: req.body,
      });
    }

    const course = await courseService.createCourse(values);
    req.flashSuccess('Course created successfully.');
    res.redirect(`/admin/courses/${course.id}/edit`);
  } catch (err) {
    next(err);
  }
}

async function editCourseForm(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const course = await courseService.getCourseByIdAdmin(id);
    if (!course) {
      req.flashError('Course not found.');
      return res.redirect('/admin/courses');
    }

    const { categories, instructors } = await getFormOptions();

    res.render('admin/courses/form', {
      pageTitle: `Edit: ${course.title} | Admin`,
      metaDescription: 'Edit course.',
      course,
      categories,
      instructors,
      levels: LEVELS,
      statuses: STATUSES,
      errors: [],
      values: {
        ...course,
        categoryId: course.categoryId || '',
        instructorId: course.instructorId || '',
        price: course.price.toString(),
        salePrice: course.salePrice ? course.salePrice.toString() : '',
      },
    });
  } catch (err) {
    next(err);
  }
}

async function updateCourse(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const { errors, values } = validateCourse(req.body);
    const { categories, instructors } = await getFormOptions();

    if (errors.length > 0) {
      const course = await courseService.getCourseByIdAdmin(id);
      return res.status(400).render('admin/courses/form', {
        pageTitle: 'Edit Course | Admin',
        metaDescription: 'Edit course.',
        course,
        categories,
        instructors,
        levels: LEVELS,
        statuses: STATUSES,
        errors,
        values: { ...req.body, id },
      });
    }

    await courseService.updateCourse(id, values);
    req.flashSuccess('Course updated successfully.');
    res.redirect(`/admin/courses/${id}/edit`);
  } catch (err) {
    if (err instanceof courseService.CourseError) {
      req.flashError(err.message);
      return res.redirect('/admin/courses');
    }
    next(err);
  }
}

async function deleteCourse(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    await courseService.deleteCourseIfSafe(id);
    req.flashSuccess('Course deleted.');
  } catch (err) {
    if (err instanceof courseService.CourseError) {
      req.flashError(err.message);
    } else {
      return next(err);
    }
  }
  res.redirect('/admin/courses');
}

async function publishCourse(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    await courseService.setCourseStatus(id, 'PUBLISHED');
    req.flashSuccess('Course published.');
  } catch (err) {
    if (err instanceof courseService.CourseError) {
      req.flashError(err.message);
    } else {
      return next(err);
    }
  }
  res.redirect('/admin/courses');
}

async function unpublishCourse(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    await courseService.setCourseStatus(id, 'DRAFT');
    req.flashSuccess('Course moved back to draft.');
  } catch (err) {
    if (err instanceof courseService.CourseError) {
      req.flashError(err.message);
    } else {
      return next(err);
    }
  }
  res.redirect('/admin/courses');
}

module.exports = {
  listCourses,
  newCourseForm,
  createCourse,
  editCourseForm,
  updateCourse,
  deleteCourse,
  publishCourse,
  unpublishCourse,
};
