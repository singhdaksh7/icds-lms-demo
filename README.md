# Institute of Cosmetology & Dental Sciences — LMS Platform

## Project Overview

A server-rendered LMS / online video-course platform. It replaces the
original static HTML page (preserved in `backup/original/`) with a
Node.js + Express + EJS application backed by MySQL via Prisma, while
keeping the original Bootstrap-based visual design.

This is a phased build. **Phases 1-3 are implemented:** project foundation,
MySQL/Prisma foundation + dynamic homepage, and server-side session
authentication/authorization. Checkout, video delivery, real dashboards, and
the admin panel are not yet built — see "Next Phase" below.

## Stack

- Node.js + Express.js
- EJS (server-rendered views, no frontend framework)
- MySQL
- Prisma ORM
- Bootstrap 5.3.8 + Bootstrap Icons (CDN) — existing design, unchanged
- Deployment target: **Hostinger Node.js Hosting**

## Requirements

- Node.js 18+ and npm
- A MySQL database (local for development; Hostinger-hosted MySQL for
  production)

## Local Setup

```bash
npm install
cp .env.example .env
# edit .env — set DATABASE_URL to a real MySQL connection string

npm run prisma:migrate      # creates tables from prisma/schema.prisma
npm run prisma:seed         # loads placeholder categories/instructors/courses

npm run dev                 # starts the server with nodemon
```

Then open `http://localhost:3000` (or whatever `PORT` you set).

## Environment Variables

All read via `src/config/env.js`. See `.env.example` for the full template.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | MySQL connection string for Prisma. App refuses to start without it. |
| `PORT` | No (default `3000`) | Local-dev port only. **Hostinger injects its own `PORT` at runtime** — never hardcode a port anywhere in frontend or backend code. |
| `NODE_ENV` | No (default `development`) | Set to `production` on Hostinger. Controls error verbosity and the dev-admin seed guard. |
| `SESSION_SECRET` | **Yes in production** | Signs the session cookie. In production the app refuses to start if this is missing, a known placeholder (`change-me`, `secret`, `password`, `your-secret-here`), or shorter than 32 characters. In development a fallback is used so `npm run dev` works out of the box. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. |
| `SESSION_COOKIE_NAME` | No (default `icds.sid`) | Name of the session cookie (kept off the default `connect.sid`). |
| `DEV_ADMIN_EMAIL` / `DEV_ADMIN_PASSWORD` | No | Only read by `prisma/seed.js`, and only when `NODE_ENV !== production`. Both must be set together to create/update a dev admin user; if either is unset, no admin user is created. There is no hardcoded/default admin account, and this seed path is fully disabled when `NODE_ENV === production`. |

## Database

MySQL only — the schema deliberately avoids any Postgres-only feature
(arrays, JSONB, extensions) so it runs unmodified on Hostinger's MySQL.
Models are defined in `prisma/schema.prisma` (users, categories,
instructors, courses, lessons, enrollments, orders/order items, wishlist,
reviews, lesson progress, certificates, newsletter subscribers, contact
messages, password reset tokens). See the schema file itself for full field
lists and relations/cascade behavior — order records use `Restrict` instead
of `Cascade` so a deleted user/course can never silently delete financial
history.

## Authentication

Server-side session authentication — no JWT/localStorage. Browser holds a
secure, HttpOnly session cookie; Express + `express-session` resolve it to
a server-side session on every request; `res.locals.currentUser` is loaded
from the database (`src/middleware/currentUser.middleware.js`) so views and
route middleware can trust it.

- **Password hashing:** `bcryptjs` (pure JS, no native compilation — required
  for Hostinger compatibility), 12 salt rounds. Utilities in
  `src/lib/password.js` (`hashPassword` / `verifyPassword`); nothing else in
  the codebase should hash or compare passwords directly.
- **Session store:** MySQL-backed via `express-mysql-session`, reusing
  `DATABASE_URL` (no separate DB env vars, no Redis). The store auto-creates
  a `sessions` table and sweeps expired rows every 15 minutes. Configured in
  `src/config/session.js`.
- **CSRF protection:** `csrf-csrf` (double-submit cookie pattern) on every
  state-changing auth form (signup, login, logout, forgot-password,
  reset-password). `res.locals.csrfToken` is available in every view —
  forms must include `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`.
  An invalid/missing token redirects back with a flash message instead of a
  raw 500. See `src/config/csrf.js` for why the token is bound to a
  dedicated anchor cookie rather than `req.session.id` (a session that's
  never modified — e.g. just viewing the login page — isn't persisted under
  `saveUninitialized: false`, so its id isn't stable across that GET → POST).
- **Authorization middleware** (`src/middleware/auth.middleware.js`):
  `requireAuth`, `requireGuest`, `requireRole(...roles)`. Enforced
  server-side on every protected route — never rely on hidden frontend
  links.
- **Open-redirect protection:** `returnTo` / post-login redirects are
  validated by `src/lib/safeRedirect.js` to only allow internal relative
  paths.
- **Password reset:** uses the existing `PasswordResetToken` model. Raw
  tokens are never stored — only a SHA-256 hash (`src/lib/tokens.js`); the
  raw token exists only in the emailed/logged URL and expires after 45
  minutes. The forgot-password response is identical whether or not the
  email exists (no account enumeration). A successful reset invalidates all
  of that user's other active sessions.
- **Email:** `src/lib/mailer.js` is a minimal abstraction with no SMTP
  provider wired up yet. **In development only**, it logs the reset URL to
  the console under a `DEVELOPMENT PASSWORD RESET URL` banner. **This must
  never be enabled in production** — the production branch explicitly does
  not log or expose the token, and just records that no provider is
  configured.
- **Rate limiting:** `src/middleware/authRateLimit.js` applies a stricter
  limit (20 requests / 15 min / IP) on top of the app-wide limiter,
  specifically on login, signup, forgot-password and reset-password.
- **Routes:** `src/routes/auth.routes.js` (`GET /login`, `/signup`,
  `/forgot-password`, `/reset-password/:token`; `POST /auth/signup`,
  `/auth/login`, `/auth/logout`, `/auth/forgot-password`,
  `/auth/reset-password/:token`), plus placeholder protected pages at
  `GET /student/dashboard` (STUDENT or ADMIN) and `GET /admin` (ADMIN only).
- **Existing homepage modals:** the login/signup Bootstrap modals in
  `views/partials/footer.ejs` now submit to the same real `/auth/login` and
  `/auth/signup` actions (with CSRF tokens) — kept alongside the new
  standalone `/login` and `/signup` pages for direct links, password-manager
  support, and error handling.

## Development

- `npm run dev` — nodemon, auto-restarts on file changes.
- `npm run prisma:studio` — opens Prisma Studio to browse/edit data.
- A single shared `PrismaClient` lives in `src/config/db.js`; always import
  it from there instead of instantiating a new client.
- Business logic goes in `src/services/`, not in controllers or `.ejs`
  templates. Templates never query the database directly.

## Production

```bash
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm start
```

`npm start` runs `node server.js` directly — no PM2/Docker/systemd
dependency, matching Hostinger Node.js hosting's process model.

## Hostinger Deployment Notes

These are the application-side requirements this project satisfies. Exact
hPanel click-paths aren't documented here since they weren't verified as
part of this build.

- **Node.js version:** the app targets Node 18+ (`engines.node` in
  `package.json`). Select a matching Node version in Hostinger's Node.js
  hosting settings.
- **Entry file:** `server.js` (also `npm start` → `node server.js`).
- **Install command:** `npm install` (or `npm ci` if a lockfile is
  committed). `postinstall` automatically runs `prisma generate`.
- **Environment variables:** set `DATABASE_URL`, `NODE_ENV=production`, and
  a real `SESSION_SECRET` (see Authentication section above for how to
  generate one) in Hostinger's environment variable panel. Do not commit
  a `.env` file — it's git-ignored. The app fails to start in production
  without a valid `SESSION_SECRET`, by design.
- **Sessions:** persisted in MySQL (no Redis) via the same `DATABASE_URL` —
  nothing extra to provision. Cookies are `Secure` in production (the app
  sends `secure: true` when `NODE_ENV=production`), so the site must be
  served over HTTPS, which Hostinger's proxy already terminates.
- **MySQL connection:** create a MySQL database + user in hPanel, then build
  `DATABASE_URL` as `mysql://USER:PASSWORD@HOST:3306/DATABASE` using the
  credentials hPanel gives you.
- **Prisma generate:** runs automatically via `postinstall`. If your hosting
  step skips `postinstall`, run `npm run prisma:generate` manually before
  starting the app.
- **Migrations:** run `npm run prisma:migrate:deploy` once per deploy after
  install (this applies committed migrations without prompting — it's the
  non-interactive counterpart to `prisma migrate dev`, which is
  development-only). Run it manually via Hostinger's SSH/terminal access if
  the platform doesn't run it for you.
- **Startup command:** `npm start` (⇒ `node server.js`). The server binds to
  `process.env.PORT`, which Hostinger provides — do not override it.
- **Reverse proxy / HTTPS:** `app.set('trust proxy', 1)` is set in
  `server.js` because Hostinger Node.js hosting terminates HTTPS at a proxy
  in front of the app; this makes `req.secure`, client IPs, and rate
  limiting behave correctly. Document/revisit this if the actual proxy
  topology turns out to be more than one hop.
- **`public/` directory behavior:** served via `express.static`, so
  `/css/main.css`, `/js/main.js`, and everything under `public/assets` and
  `public/uploads` are reachable directly by URL. No separate static file
  server/CDN is required for this to work.
- **Health check:** `GET /api/health` returns
  `{ "success": true, "status": "ok", "database": "connected" | "disconnected" }`
  and actually runs a `SELECT 1` against MySQL — point Hostinger's health
  check (if it has one) or an external uptime monitor at this route.
- No Docker, PM2, Redis, systemd, custom nginx config, or background workers
  are required or assumed anywhere in this codebase.
- All file paths use `path.join(...)`/`process.cwd()`-relative resolution —
  nothing depends on a Windows-style path, and all filenames/imports are
  written case-correctly for Linux's case-sensitive filesystem.

## Next Phase

See the report delivered alongside this implementation for the full Phase 4+
scope (course detail pages, checkout/payments, video delivery, real student
dashboard content, admin CRUD, reviews, certificates, contact/newsletter
backends).
