const express = require('express');
const router = express.Router();

const courseController = require('../controllers/course.controller');

router.get('/courses', courseController.listCourses);
router.get('/courses/:slug', courseController.getCourseDetail);

module.exports = router;
