const express = require('express');
const router = express.Router();

const adminController = require('../controllers/admin.controller');
const { requireRole } = require('../middleware/auth.middleware');

router.get('/', requireRole('ADMIN'), adminController.getDashboard);

module.exports = router;
