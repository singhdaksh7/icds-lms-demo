const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const session = require('express-session');

const saveSessionBeforeRedirect = require('../src/middleware/saveSessionBeforeRedirect');

// A session store with real-world write latency (a remote/loaded database).
class SlowStore extends session.Store {
  constructor(delayMs) {
    super();
    this.delayMs = delayMs;
    this.rows = new Map();
  }
  get(sid, cb) { setTimeout(() => cb(null, this.rows.has(sid) ? JSON.parse(this.rows.get(sid)) : null), 1); }
  set(sid, sess, cb) { setTimeout(() => { this.rows.set(sid, JSON.stringify(sess)); cb(null); }, this.delayMs); }
  destroy(sid, cb) { this.rows.delete(sid); cb(null); }
  touch(sid, sess, cb) { cb(null); }
}

function buildApp({ withFix }) {
  const app = express();
  app.use(session({ secret: 's'.repeat(32), resave: false, saveUninitialized: false, store: new SlowStore(80), name: 'sid' }));
  if (withFix) app.use(saveSessionBeforeRedirect);
  app.post('/login', (req, res) => { req.session.userId = 7; res.redirect('/me'); });
  app.get('/me', (req, res) => res.json({ userId: req.session.userId || null }));
  return app;
}

// Behaves like a browser: as soon as the redirect's HEADERS arrive it issues
// the follow-up request, without waiting for the response body to finish.
function loginThenFollowImmediately(port) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, host: '127.0.0.1', path: '/login', method: 'POST' }, (res) => {
      const cookie = (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
      const follow = http.get({ port, host: '127.0.0.1', path: res.headers.location, headers: { cookie } }, (r) => {
        let body = '';
        r.on('data', (d) => { body += d; });
        r.on('end', () => resolve(JSON.parse(body)));
      });
      follow.on('error', reject);
      res.resume();
    });
    req.on('error', reject);
    req.end();
  });
}

async function run(withFix) {
  const server = http.createServer(buildApp({ withFix }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await loginThenFollowImmediately(server.address().port);
  } finally {
    server.close();
  }
}

test('without the fix, an immediate redirect follow-up can miss the not-yet-saved session (the bug)', async () => {
  assert.deepEqual(await run(false), { userId: null });
});

test('with saveSessionBeforeRedirect, the follow-up request is authenticated', async () => {
  assert.deepEqual(await run(true), { userId: 7 });
});
