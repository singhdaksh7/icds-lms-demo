// Single shared PrismaClient instance for the whole app.
// Re-requiring this module (CommonJS caches modules) always returns the same
// instance, and in dev-with-nodemon we additionally stash it on `global` so
// hot reloads don't open a new MySQL connection pool every restart.
const { PrismaClient } = require('@prisma/client');
const { IS_PRODUCTION, DATABASE_URL, USE_TIDB_HTTP_ADAPTER } = require('./env');

// When USE_TIDB_HTTP_ADAPTER is set, queries travel over TiDB Cloud's HTTPS
// serverless driver instead of a raw MySQL TCP connection — see env.js for
// why. Reuses the same DATABASE_URL rather than a second credential.
function createPrismaClient() {
  if (USE_TIDB_HTTP_ADAPTER) {
    const { connect } = require('@tidbcloud/serverless');
    const { PrismaTiDBCloud } = require('@tidbcloud/prisma-adapter');
    const connection = connect({ url: DATABASE_URL });
    const adapter = new PrismaTiDBCloud(connection);
    return new PrismaClient({ adapter });
  }
  return new PrismaClient();
}

let prisma;

if (IS_PRODUCTION) {
  prisma = createPrismaClient();
} else {
  if (!global.__prisma) {
    global.__prisma = createPrismaClient();
  }
  prisma = global.__prisma;
}

async function checkDatabaseConnection() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    return false;
  }
}

async function disconnectDatabase() {
  await prisma.$disconnect();
}

module.exports = { prisma, checkDatabaseConnection, disconnectDatabase };
