const { checkDatabaseConnection } = require('../config/db');

async function getHealth(req, res) {
  const dbConnected = await checkDatabaseConnection();

  res.status(200).json({
    success: true,
    status: 'ok',
    database: dbConnected ? 'connected' : 'disconnected',
  });
}

module.exports = { getHealth };
