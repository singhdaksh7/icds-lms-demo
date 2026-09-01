# Institute of Cosmetology & Dental Sciences — LMS Platform

## Project Overview

A server-rendered LMS / online video-course platform. It replaces the
original static HTML page (preserved in `backup/original/`) with a
Node.js + Express + EJS application backed by MySQL via Prisma, while
keeping the original Bootstrap-based visual design.

This is a phased build. **Phase 1 (project foundation) and Phase 2
(MySQL/Prisma foundation + dynamic homepage) are implemented.**
Authentication, checkout, video delivery, dashboards, and the admin panel are
not yet built — see "Next Phase" below.

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
| `SESSION_SECRET` | No (default placeholder) | Reserved for session/cookie signing once auth is implemented (Phase 3+). Not used yet. |
| `DEV_ADMIN_EMAIL` / `DEV_ADMIN_PASSWORD` | No | Only read by `prisma/seed.js`, and only when `NODE_ENV !== production`. If both are unset, no admin user is created. There is no hardcoded/default admin account. |

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
  `SESSION_SECRET` in Hostinger's environment variable panel. Do not commit
  a `.env` file — it's git-ignored.
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

See the report delivered alongside this implementation for the full Phase 3+
scope (authentication, course detail pages, checkout/payments, video
delivery, student dashboard, admin panel, reviews, certificates, contact/
newsletter backends).
