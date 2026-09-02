// Temporary diagnostic routes — see README "Production Operations —
// Temporary Network Diagnostics" for what these are for and the removal
// plan once the Hostinger↔TiDB connectivity issue is resolved.
const express = require('express');
const router = express.Router();

const { requireDiagnosticToken } = require('../middleware/diagnosticAuth.middleware');
const diagnosticsController = require('../controllers/internal/diagnostics.controller');

router.get('/diagnostics/network', requireDiagnosticToken, diagnosticsController.getNetworkDiagnostics);

module.exports = router;
