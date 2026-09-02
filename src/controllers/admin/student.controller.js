const adminService = require('../../services/admin.service');
const enrollmentService = require('../../services/enrollment.service');
const { parsePage } = require('../../lib/pagination');
const { prisma } = require('../../config/db');

async function listStudents(req, res, next) {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const page = parsePage(req.query.page);

    const { students, pagination } = await adminService.listStudentsAdmin({ q, page });

    const pageUrl = (targetPage) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (targetPage > 1) params.set('page', String(targetPage));
      const qs = params.toString();
      return `/admin/students${qs ? `?${qs}` : ''}`;
    };

    res.render('admin/students/list', {
      pageTitle: 'Students | Admin',
      metaDescription: 'Admin student management.',
      students,
      pagination,
      pageUrl,
      q,
    });
  } catch (err) {
    next(err);
  }
}

async function getStudentDetail(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const student = await adminService.getStudentDetailAdmin(id);
    if (!student) {
      req.flashError('Student not found.');
      return res.redirect('/admin/students');
    }

    const publishedCourses = await prisma.course.findMany({
      where: { status: 'PUBLISHED' },
      select: { id: true, title: true },
      orderBy: { title: 'asc' },
    });

    const enrolledCourseIds = new Set(
      student.enrollments.filter((e) => e.status === 'ACTIVE').map((e) => e.courseId)
    );
    const enrollableCourses = publishedCourses.filter((c) => !enrolledCourseIds.has(c.id));

    res.render('admin/students/detail', {
      pageTitle: `${student.name} | Admin`,
      metaDescription: 'Student detail.',
      student,
      enrollableCourses,
    });
  } catch (err) {
    next(err);
  }
}

async function enrollStudent(req, res, next) {
  try {
    const studentId = parseInt(req.params.id, 10);
    const courseId = parseInt(req.body.courseId, 10);

    if (!Number.isInteger(courseId)) {
      req.flashError('Please choose a valid course.');
      return res.redirect(`/admin/students/${studentId}`);
    }

    await enrollmentService.enrollStudentManually(studentId, courseId);
    req.flashSuccess('Student enrolled successfully.');
  } catch (err) {
    if (err instanceof enrollmentService.EnrollmentError) {
      req.flashError(err.message);
    } else {
      return next(err);
    }
  }
  res.redirect(`/admin/students/${req.params.id}`);
}

async function unenrollStudent(req, res, next) {
  try {
    const studentId = parseInt(req.params.id, 10);
    const courseId = parseInt(req.body.courseId, 10);

    if (!Number.isInteger(courseId)) {
      req.flashError('Please choose a valid course.');
      return res.redirect(`/admin/students/${studentId}`);
    }

    await enrollmentService.cancelEnrollment(studentId, courseId);
    req.flashSuccess('Enrollment cancelled.');
  } catch (err) {
    if (err instanceof enrollmentService.EnrollmentError) {
      req.flashError(err.message);
    } else {
      return next(err);
    }
  }
  res.redirect(`/admin/students/${req.params.id}`);
}

module.exports = { listStudents, getStudentDetail, enrollStudent, unenrollStudent };
