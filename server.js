const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { PORT, IS_PRODUCTION } = require('./src/config/env');
const { disconnectDatabase } = require('./src/config/db');
const indexRoutes = require('./src/routes/index.routes');
const healthRoutes = require('./src/routes/api/health.routes');
const notFound = require('./src/middleware/notFound');
const errorHandler = require('./src/middleware/errorHandler');

const app = express();

// Hostinger's Node.js hosting sits behind a reverse proxy that terminates
// HTTPS. Trusting the first proxy hop lets req.secure / req.ip and
// rate-limiting behave correctly instead of seeing everything as one client
// on plain HTTP. See README.md "Hostinger Deployment Notes".
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(
  helmet({
    // Bootstrap/fonts/icons are loaded from CDNs; a strict default-src would
    // break the existing design, so CSP is left to Helmet's other safe
    // defaults for now rather than hand-rolling a directive list here.
    contentSecurityPolicy: false,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Basic abuse protection for all routes; tighter limits belong on
// auth/payment endpoints once those exist (Phase 3+).
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/health', healthRoutes);
app.use('/', indexRoutes);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT} (${IS_PRODUCTION ? 'production' : 'development'})`);
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(async () => {
    await disconnectDatabase();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
