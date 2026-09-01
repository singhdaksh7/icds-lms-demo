// Single shared PrismaClient instance for the whole app.
// Re-requiring this module (CommonJS caches modules) always returns the same
// instance, and in dev-with-nodemon we additionally stash it on `global` so
// hot reloads don't open a new MySQL connection pool every restart.
const { PrismaClient } = require('@prisma/client');
const { IS_PRODUCTION } = require('./env');

let prisma;

if (IS_PRODUCTION) {
  prisma = new PrismaClient();
} else {
  if (!global.__prisma) {
    global.__prisma = new PrismaClient();
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
