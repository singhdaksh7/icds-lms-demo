// Centralized environment access. Everything else in the app should read
// config from here instead of touching process.env directly.
require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

// Hostinger's Node.js hosting assigns and injects its own PORT at runtime.
// 3000 is only a local-dev fallback and must never be hardcoded elsewhere.
const PORT = process.env.PORT || 3000;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  // Fail loudly and early rather than letting Prisma throw an opaque error
  // later on the first query.
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and configure your MySQL connection string.'
  );
}

module.exports = {
  NODE_ENV,
  IS_PRODUCTION,
  PORT,
  DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET || 'change-me',
};
