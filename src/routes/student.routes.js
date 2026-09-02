const express = require('express');
const router = express.Router();

const studentController = require('../controllers/student.controller');
const { requireRole } = require('../middleware/auth.middleware');

router.get('/dashboard', requireRole('STUDENT', 'ADMIN'), studentController.getDashboard);

module.exports = router;
