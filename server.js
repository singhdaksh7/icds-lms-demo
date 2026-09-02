const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const { PORT, IS_PRODUCTION } = require('./src/config/env');
const { disconnectDatabase } = require('./src/config/db');
const { sessionMiddleware, sessionStore } = require('./src/config/session');
const { exposeCsrfToken } = require('./src/config/csrf');
const flashMiddleware = require('./src/lib/flash');
const currentUser = require('./src/middleware/currentUser.middleware');
const siteMiddleware = require('./src/middleware/site.middleware');
const indexRoutes = require('./src/routes/index.routes');
const authRoutes = require('./src/routes/auth.routes');
const courseRoutes = require('./src/routes/course.routes');
const learnRoutes = require('./src/routes/learn.routes');
const checkoutRoutes = require('./src/routes/checkout.routes');
const paymentRoutes = require('./src/routes/payment.routes');
const webhookRoutes = require('./src/routes/webhook.routes');
const studentRoutes = require('./src/routes/student.routes');
const adminRoutes = require('./src/routes/admin.routes');
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

// Basic abuse protection for all routes; the auth/payment routes
// additionally get their own stricter, dedicated limiters.
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Razorpay webhook signature verification needs the EXACT raw request
// bytes, so this must be mounted here — before express.json() below parses
// (and effectively discards) the original body. See src/routes/webhook.routes.js.
app.use('/webhooks', webhookRoutes);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use(express.static(path.join(__dirname, 'public')));

// Auth stack: cookies -> session -> flash -> CSRF token -> current user.
// Order matters — CSRF and currentUser both depend on the session existing.
app.use(cookieParser());
app.use(sessionMiddleware);
app.use(flashMiddleware);
app.use(exposeCsrfToken);
app.use(currentUser);
app.use(siteMiddleware);

app.use('/api/health', healthRoutes);
app.use('/', authRoutes);
app.use('/', courseRoutes);
app.use('/', checkoutRoutes);
app.use('/', paymentRoutes);
app.use('/learn', learnRoutes);
app.use('/student', studentRoutes);
app.use('/admin', adminRoutes);
app.use('/', indexRoutes);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT} (${IS_PRODUCTION ? 'production' : 'development'})`);
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(async () => {
    sessionStore.close();
    await disconnectDatabase();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
