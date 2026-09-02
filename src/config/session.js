// Server-side session middleware, backed by MySQL (no Redis, no external
// store dependency beyond the database we already have on Hostinger).
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);

const {
  DATABASE_URL,
  IS_PRODUCTION,
  SESSION_SECRET,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
} = require('./env');

// Reuse DATABASE_URL rather than asking for separate DB_HOST/DB_USER/... env
// vars — Prisma already gives us one connection string to maintain.
function parseDatabaseUrl(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
  };
}

const sessionStore = new MySQLStore({
  ...parseDatabaseUrl(DATABASE_URL),
  createDatabaseTable: true,
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000, // sweep expired sessions every 15 min
  expiration: SESSION_MAX_AGE_MS,
  schema: {
    tableName: 'sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data',
    },
  },
});

sessionStore.onReady().catch((err) => {
  console.error('Session store failed to initialize:', err.message);
});

const sessionMiddleware = session({
  name: SESSION_COOKIE_NAME,
  secret: SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    // Hostinger terminates HTTPS at the reverse proxy; app.set('trust proxy', 1)
    // in server.js lets Express see req.secure correctly so this still works.
    secure: IS_PRODUCTION,
    maxAge: SESSION_MAX_AGE_MS,
  },
});

module.exports = { sessionMiddleware, sessionStore };



