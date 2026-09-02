const express = require('express');
const router = express.Router();

const { requireRole } = require('../middleware/auth.middleware');
const { doubleCsrfProtection } = require('../config/csrf');

const dashboardController = require('../controllers/admin/dashboard.controller');
const courseController = require('../controllers/admin/course.controller');
const categoryController = require('../controllers/admin/category.controller');
const instructorController = require('../controllers/admin/instructor.controller');
const lessonController = require('../controllers/admin/lesson.controller');
const studentController = require('../controllers/admin/student.controller');

// Every route in this file is admin-only — enforced once here rather than
// repeated per-route, so it's impossible to accidentally add an
// unprotected admin route.
router.use(requireRole('ADMIN'));

router.get('/', dashboardController.getDashboard);

// --- Courses ---------------------------------------------------------------
router.get('/courses', courseController.listCourses);
router.get('/courses/new', courseController.newCourseForm);
router.post('/courses', doubleCsrfProtection, courseController.createCourse);
router.get('/courses/:id/edit', courseController.editCourseForm);
router.post('/courses/:id', doubleCsrfProtection, courseController.updateCourse);
router.post('/courses/:id/delete', doubleCsrfProtection, courseController.deleteCourse);
router.post('/courses/:id/publish', doubleCsrfProtection, courseController.publishCourse);
router.post('/courses/:id/unpublish', doubleCsrfProtection, courseController.unpublishCourse);

// --- Lessons (nested under a course) ---------------------------------------
router.get('/courses/:courseId/lessons', lessonController.listLessons);
router.get('/courses/:courseId/lessons/new', lessonController.newLessonForm);
router.post('/courses/:courseId/lessons', doubleCsrfProtection, lessonController.createLesson);
router.get('/lessons/:id/edit', lessonController.editLessonForm);
router.post('/lessons/:id', doubleCsrfProtection, lessonController.updateLesson);
router.post('/lessons/:id/delete', doubleCsrfProtection, lessonController.deleteLesson);

// --- Categories --------------------------------------------------------------
router.get('/categories', categoryController.listCategories);
router.post('/categories', doubleCsrfProtection, categoryController.createCategory);
router.post('/categories/:id', doubleCsrfProtection, categoryController.updateCategory);
router.post('/categories/:id/delete', doubleCsrfProtection, categoryController.deleteCategory);

// --- Instructors -------------------------------------------------------------
router.get('/instructors', instructorController.listInstructors);
router.get('/instructors/new', instructorController.newInstructorForm);
router.post('/instructors', doubleCsrfProtection, instructorController.createInstructor);
router.get('/instructors/:id/edit', instructorController.editInstructorForm);
router.post('/instructors/:id', doubleCsrfProtection, instructorController.updateInstructor);
router.post('/instructors/:id/delete', doubleCsrfProtection, instructorController.deleteInstructor);

// --- Students / manual enrollment --------------------------------------------
router.get('/students', studentController.listStudents);
router.get('/students/:id', studentController.getStudentDetail);
router.post('/students/:id/enroll', doubleCsrfProtection, studentController.enrollStudent);
router.post('/students/:id/unenroll', doubleCsrfProtection, studentController.unenrollStudent);

module.exports = router;
