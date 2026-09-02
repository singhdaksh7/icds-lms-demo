// Express-session store backed by Prisma (the `Session` model), so session
// reads/writes travel through the same TiDB HTTPS adapter as everything
// else — replacing express-mysql-session, which needed a raw MySQL TCP
// connection the Hostinger Node.js runtime cannot reach.
//
// Sessions are looked up/written one row at a time by primary key; nothing
// here ever loads the full table into memory.
const { Store } = require('express-session');
const { prisma } = require('../config/db');

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, matches SESSION_MAX_AGE_MS
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // at most once per 30 min per process

function getExpirationDate(session) {
  if (session && session.cookie && session.cookie.expires) {
    const asDate = new Date(session.cookie.expires);
    if (!Number.isNaN(asDate.getTime())) {
      return asDate;
    }
  }
  if (session && session.cookie && typeof session.cookie.maxAge === 'number') {
    return new Date(Date.now() + session.cookie.maxAge);
  }
  return new Date(Date.now() + DEFAULT_MAX_AGE_MS);
}

function extractUserId(session) {
  const id = session && session.userId;
  return typeof id === 'number' && Number.isInteger(id) ? id : null;
}

class PrismaSessionStore extends Store {
  constructor() {
    super();
    this.lastCleanupAt = 0;
  }

  // Best-effort, throttled sweep of expired rows. Never awaited by callers —
  // correctness of get()/destroy() never depends on this having run, since
  // get() always re-checks expiresAt itself.
  maybeCleanupExpired() {
    const now = Date.now();
    if (now - this.lastCleanupAt < CLEANUP_INTERVAL_MS) {
      return;
    }
    this.lastCleanupAt = now;
    prisma.session
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch((err) => {
        console.error('Session cleanup sweep failed (non-fatal):', err.message);
      });
  }

  get(sid, callback) {
    prisma.session
      .findUnique({ where: { id: sid } })
      .then((row) => {
        if (!row) {
          return callback(null, null);
        }
        if (row.expiresAt.getTime() <= Date.now()) {
          // Expired: treat as absent, and clean up this row specifically —
          // correctness doesn't depend on this delete succeeding.
          prisma.session.delete({ where: { id: sid } }).catch(() => {});
          return callback(null, null);
        }
        try {
          callback(null, JSON.parse(row.data));
        } catch (err) {
          callback(err);
        }
      })
      .catch((err) => callback(err));
  }

  set(sid, session, callback) {
    const data = JSON.stringify(session);
    const expiresAt = getExpirationDate(session);
    const userId = extractUserId(session);

    prisma.session
      .upsert({
        where: { id: sid },
        update: { data, expiresAt, userId },
        create: { id: sid, data, expiresAt, userId },
      })
      .then(() => {
        this.maybeCleanupExpired();
        callback(null);
      })
      .catch((err) => callback(err));
  }

  destroy(sid, callback) {
    prisma.session
      .delete({ where: { id: sid } })
      .then(() => callback(null))
      .catch((err) => {
        // Deleting a session that's already gone isn't an error condition
        // from express-session's point of view.
        if (err && err.code === 'P2025') {
          return callback(null);
        }
        callback(err);
      });
  }

  touch(sid, session, callback) {
    const expiresAt = getExpirationDate(session);

    prisma.session
      .updateMany({ where: { id: sid }, data: { expiresAt } })
      .then(() => {
        this.maybeCleanupExpired();
        callback(null);
      })
      .catch((err) => callback(err));
  }

  // Custom (non-Store-interface) method: destroys every session belonging
  // to a user, e.g. after a password reset. Uses the indexed userId column
  // rather than scanning/parsing every row's JSON payload.
  async destroyUserSessions(userId) {
    await prisma.session.deleteMany({ where: { userId } });
  }

  // No-op, kept only so server.js's shutdown handler (which called
  // express-mysql-session's close()) doesn't need special-casing. The
  // shared Prisma client is disconnected separately via disconnectDatabase().
  close() {}
}

module.exports = { PrismaSessionStore };
