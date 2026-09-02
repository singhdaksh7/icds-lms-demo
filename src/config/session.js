// Server-side session middleware, backed by Prisma (the `Session` model) —
// no Redis, no external store dependency, and no raw MySQL TCP connection
// (see src/lib/prismaSessionStore.js for why that matters on Hostinger).
const session = require('express-session');
const { PrismaSessionStore } = require('../lib/prismaSessionStore');

const { IS_PRODUCTION, SESSION_SECRET, SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } = require('./env');

const sessionStore = new PrismaSessionStore();

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



