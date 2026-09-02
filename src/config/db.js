// Single shared PrismaClient instance for the whole app.
// Re-requiring this module (CommonJS caches modules) always returns the same
// instance, and in dev-with-nodemon we additionally stash it on `global` so
// hot reloads don't open a new MySQL connection pool every restart.
const { PrismaClient } = require('@prisma/client');
const { IS_PRODUCTION, DATABASE_URL, USE_TIDB_HTTP_ADAPTER } = require('./env');
const { withTimeout, summarizeError } = require('../lib/diagnostics');

// Safe to log: no URL, no credentials, just which code path is active.
// This is the one authoritative place to check which mode actually booted
// (see README "Production Operations — Temporary Network Diagnostics").
console.log(
  `Database runtime: ${USE_TIDB_HTTP_ADAPTER ? 'TiDB HTTPS adapter' : 'Standard Prisma TCP'}`
);

const HEALTH_CHECK_TIMEOUT_MS = 9000;

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

// Diagnostic-only timeout: bounds how long /api/health can hang on a live
// query so a single slow/stuck DB path never blocks the health check
// itself. Deliberately scoped to this one call — not a general Prisma
// query timeout. Logs a sanitized error (no URL/credentials) on failure or
// timeout so Hostinger's build/console output has something to inspect
// even though no runtime log viewer is available for this app.
async function checkDatabaseConnection() {
  const result = await withTimeout(
    () => prisma.$queryRaw`SELECT 1`,
    HEALTH_CHECK_TIMEOUT_MS,
    'TIDB_HEALTH_TIMEOUT'
  );

  if (result.ok) {
    return true;
  }

  if (result.timedOut) {
    console.error(`TIDB_HEALTH_TIMEOUT after ${HEALTH_CHECK_TIMEOUT_MS}ms`);
  } else {
    const summary = result.error || summarizeError(result.error);
    console.error(
      `Database health check failed after ${result.elapsedMs}ms:`,
      JSON.stringify(summary)
    );
  }
  return false;
}

async function disconnectDatabase() {
  await prisma.$disconnect();
}

module.exports = { prisma, checkDatabaseConnection, disconnectDatabase };
