# Institute of Cosmetology & Dental Sciences — LMS Platform

## Project Overview

A server-rendered LMS / online video-course platform. It replaces the
original static HTML page (preserved in `backup/original/`) with a
Node.js + Express + EJS application backed by MySQL via Prisma, while
keeping the original Bootstrap-based visual design.

This is a phased build. **Phases 1-5 are implemented:** project foundation,
MySQL/Prisma foundation + dynamic homepage, server-side session
authentication/authorization, the full course system (public catalog, admin
management, manual enrollment, student learning/progress), and Razorpay
checkout with automatic, server-verified enrollment. Certificates, coupons,
subscriptions, and real video DRM are not yet built — see "Next Phase" below.

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
| `APP_BASE_URL` | No | Optional absolute base URL of the deployment. Not currently required — the app builds redirects from the current request — reserved for a future need to construct an absolute URL outside a request context. |
| `RAZORPAY_KEY_ID` | No (required to accept payments) | Razorpay key id. The **only** Razorpay credential ever sent to the browser (the Checkout script needs it). Use TEST MODE keys in development. |
| `RAZORPAY_KEY_SECRET` | No (required to accept payments) | Razorpay key secret. Server-side only — never appears in any view or client script. Signs/verifies checkout signatures and authenticates order-creation/payment-fetch API calls. |
| `RAZORPAY_WEBHOOK_SECRET` | No (required for the webhook) | Separate secret from `RAZORPAY_KEY_SECRET`, generated when you create the webhook in the Razorpay dashboard. Verifies `X-Razorpay-Signature`. |

Razorpay variables are deliberately **not** validated at boot — a deployment without payments configured yet still serves the rest of the site normally. Checkout (`/checkout/*`, `/payments/*`) and the webhook (`/webhooks/razorpay`) each fail clearly with `503` at the moment they're invoked if these are missing, rather than the app refusing to start. See "Payments (Razorpay)" below.

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

## Course System

Public catalog, admin management, and the student learning flow, all
database-driven (no more hardcoded homepage course data).

- **Public routes** (`src/routes/course.routes.js`, `src/routes/learn.routes.js`):
  - `GET /courses` — paginated (12/page), server-side filtered catalog.
    Query params: `q` (search), `category` (slug), `level`, `page`. Search
    matches course title/short description/description/instructor
    name/category name via Prisma `contains` (plain MySQL filtering — no
    Elasticsearch/Meilisearch/full-text extension). Query is trimmed and
    capped at 100 characters.
  - `GET /courses/:slug` — only `PUBLISHED` courses are reachable; anything
    else 404s, including to an authenticated non-admin. Shows curriculum
    (published lessons, `sortOrder` then `id`) with title/duration/preview
    flag only — never a lesson's `videoUrl`.
  - `GET /learn/:courseSlug` — course overview/curriculum for the logged-in,
    enrolled student (or an admin, for QA). Guests are sent to `/login`;
    authenticated-but-not-enrolled users are bounced to the course detail
    page with a flash message — never a raw 500 or silent empty page.
  - `GET /learn/:courseSlug/:lessonSlug` — the lesson player. A lesson with
    `preview: true` is reachable by anyone, enrolled or not; everything else
    requires an active enrollment (or admin). This check happens in
    `src/controllers/learn.controller.js`, server-side, regardless of what
    links the UI does or doesn't show.
- **Admin routes** (`src/routes/admin.routes.js`, all under `requireRole('ADMIN')`
  applied once via `router.use(...)` so no route can be added unprotected by
  accident):
  - Courses: `GET/POST /admin/courses`, `/admin/courses/new`,
    `/admin/courses/:id/edit`, `/admin/courses/:id`,
    `/admin/courses/:id/delete`, `/admin/courses/:id/publish`,
    `/admin/courses/:id/unpublish`.
  - Lessons (nested under a course): `GET /admin/courses/:courseId/lessons`,
    `/lessons/new`, `POST .../lessons`, `GET /admin/lessons/:id/edit`,
    `POST /admin/lessons/:id`, `/admin/lessons/:id/delete`.
  - Categories: `GET/POST /admin/categories`, `POST /admin/categories/:id`,
    `/admin/categories/:id/delete` (single-page list with inline
    create/edit forms).
  - Instructors: same shape as courses (`new`/`:id/edit` pages).
  - Students: `GET /admin/students` (paginated, searchable), `GET
    /admin/students/:id` (detail + manual enroll/unenroll).
  - All validation lives in `src/validators/*.validator.js` (never inline in
    controllers); all writes go through `src/services/*.service.js`.
- **Slugs:** generated server-side (`src/lib/slug.js`) from title/name,
  lowercased and hyphenated; a client-supplied slug is still normalized and
  uniqueness-checked, never trusted as-is. Collisions get a `-2`, `-3`, ...
  suffix automatically — verified live (`test-automation-course` →
  `test-automation-course-2` on a duplicate title).
- **Money:** `price`/`salePrice` stay Prisma `Decimal` end-to-end —
  `src/lib/money.js` validates the raw form string with a regex
  (`\d{1,8}(\.\d{1,2})?`, 0–1,000,000) and passes the string straight to
  Prisma, so precision is never lost through a JS float. `salePrice` >
  `price` is rejected server-side.
- **Course deletion safety:** `courseService.deleteCourseIfSafe` blocks
  deletion (and tells the admin to archive instead) whenever the course has
  any enrollment or order-item history — verified live: a course with an
  active/cancelled enrollment refuses to delete, a clean course deletes
  fine. Lessons have no such restriction (no financial record references a
  lesson directly); deleting one cascades only to its own
  `LessonProgress` rows, per the existing schema.
- **Category/instructor deletion:** both use the schema's existing
  `onDelete: SetNull` — deleting either never deletes a course, only clears
  `course.categoryId`/`course.instructorId`. The admin UI asks for
  confirmation and reports how many courses were affected.
- **Manual enrollment (no payments yet):** `src/services/enrollment.service.js#enrollStudentManually`
  creates an `Enrollment` with `orderId: null` (already nullable in the
  schema — no migration needed) rather than fabricating an `Order`.
  Re-enrolling a cancelled student reactivates the existing row instead of
  erroring on the `(userId, courseId)` unique constraint; enrolling an
  already-active student is rejected with a clean message, and this was
  verified live (only one `Enrollment` row ever exists per user/course).
  Unenrollment sets `status: 'CANCELLED'` — it never deletes the row, so
  `LessonProgress` history survives.
- **Lesson progress:** `POST /student/lessons/:lessonId/complete`
  (CSRF-protected, `requireRole('STUDENT','ADMIN')`) always uses
  `req.currentUser.id` — the request body has no `userId` field, so there's
  nothing to tamper with. It re-validates that the lesson is `PUBLISHED`
  and that the caller is actually enrolled in that lesson's course before
  writing anything; verified live that a signed-in student who isn't
  enrolled gets rejected with no `LessonProgress` row created.
- **Course progress:** always recomputed server-side as `completed
  published lessons / total published lessons * 100`
  (`src/services/progress.service.js#computeCourseProgress`) — a
  zero-lesson course returns 0% instead of dividing by zero. The frontend
  never sends a percentage. `Enrollment.progressPercent` is kept as a
  cache, refreshed after every completion, but `LessonProgress` rows remain
  the source of truth.
- **Video embedding:** `src/lib/video.js#parseVideoEmbed` recognizes
  YouTube (`watch?v=`, `youtu.be/`, `/embed/`) and Vimeo links and returns a
  clean, server-constructed `embedUrl` — never raw DB content. Templates
  render it with `<%= embedUrl %>` inside an `<iframe src="...">`, never
  `<%- %>`. Any other/unsupported URL renders a "Video unavailable or
  unsupported." panel instead of guessing or crashing.
- **Pagination:** `src/lib/pagination.js` clamps `page` to a valid integer
  and to `[1, pageCount]` — an out-of-range or non-numeric `page` value
  degrades to a valid page instead of erroring. 12/page on the public
  catalog, 20/page in admin lists.

## Payments (Razorpay)

Single-course "Buy Now" checkout via the official `razorpay` Node SDK, with
automatic, server-verified enrollment. No cart, no coupons, no
subscriptions, no refunds UI yet — see "Next Phase".

**Flow:** `GET /courses/:slug` → "Buy Now" → `GET /checkout/:courseSlug` →
`POST /checkout/:courseSlug/create-order` (local `PENDING` `Order` +
`OrderItem` snapshot, then a Razorpay order) → Razorpay Checkout popup →
`POST /payments/razorpay/verify` (signature-verified server-side) →
`GET /payment/success/:orderId` or `/payment/failed/:orderId`.

- **Server-side pricing:** `src/lib/pricing.js#getCoursePurchasePrice(course)`
  is the one place that decides what a course costs — sale price if it's
  valid (non-null, ≥0, and less than the regular price) and the regular
  price otherwise. Every payable-amount decision (checkout page, order
  creation, free-enroll) calls this against a freshly-fetched `Course` row;
  nothing from the client (`amount`, `price`, `salePrice`) is ever trusted.
- **Paise conversion:** `src/lib/money.js#toPaise` converts the decimal
  amount string via string splitting/padding, never `price * 100` on a JS
  float — verified (`"5499.00"` → `549900`, `"0.50"` → `50`).
- **Order model:** the existing `Order`/`OrderItem` schema already snapshots
  `OrderItem.price` at purchase time (never re-reads `Course.price` later),
  so historical order value stays stable even if a course's price changes
  afterward. The only schema change this phase made was adding
  `@unique` to `Order.providerOrderId` (migration
  `20260902072334_order_provider_order_id_unique`) — required so a webhook
  or verify request can reliably map a Razorpay order id back to exactly
  one local `Order` via `findUnique`, with no in-memory state involved.
- **Order reference:** displayed as `ICDS-{id}` (e.g. `ICDS-42`) using the
  existing `Order.id` — no separate `orderNumber` column was added, since
  authorization is by session ownership (`userId` match), never by the
  reference string's secrecy, so nothing depended on a dedicated field.
- **Idempotent finalization:** `src/services/order.service.js#finalizePaidOrder`
  is the **one** canonical function that turns a verified payment into a
  `PAID` order + active `Enrollment` — both the client-verify endpoint and
  the webhook call this exact function, so there is no second/competing
  "what happens on payment success" implementation. The `PENDING → PAID`
  transition is gated by `prisma.order.updateMany({ where: { id, status:
  'PENDING' } })` inside a transaction; MySQL row-locks that statement, so
  if client-verify and the webhook race each other, only one can win the
  transition — the other sees `count === 0` and treats it as an
  already-processed no-op instead of double-enrolling. Verified live: the
  same webhook event replayed several times, and a signature-valid-but-
  already-PAID client-verify call, both produced exactly one `Enrollment`
  row and no state corruption.
- **Automatic enrollment:** only `finalizePaidOrder` ever creates/reactivates
  an `Enrollment` for a paid course — never a query param, frontend
  callback, `localStorage`, or session flag. A Razorpay popup reporting
  "success" is not trusted by itself; enrollment happens only after the
  server verifies the payment.
- **Checkout signature verification** (`src/services/razorpay.service.js#verifyCheckoutSignature`):
  Razorpay's documented formula, `HMAC_SHA256(order_id + "|" + payment_id,
  key_secret)`, implemented directly (not the SDK's internal helper, which
  compares with plain `===`) so the actual comparison is constant-time
  (`crypto.timingSafeEqual`). Beyond signature validity, `POST
  /payments/razorpay/verify` also fetches the payment from Razorpay
  directly and cross-checks its `order_id`, `amount` (in paise, via the
  same `toPaise` conversion as the local order), `currency`, and status
  (`captured`/`authorized`) before finalizing — a technically-valid
  signature alone is not enough.
- **Webhook** (`POST /webhooks/razorpay`): verifies `X-Razorpay-Signature`
  against `RAZORPAY_WEBHOOK_SECRET` using the same HMAC-SHA256 formula, and
  is **not** session/CSRF-protected — its authority is entirely the
  verified signature. Handles `payment.captured`/`order.paid` (finalize, via
  the same `finalizePaidOrder`, after the same amount/currency cross-check)
  and `payment.failed` (mark a still-`PENDING` order `FAILED` — this can
  never downgrade an already-`PAID` order, since `markOrderFailed`'s
  `updateMany` is scoped to `status: 'PENDING'`). Unrecognized event types
  are acknowledged with `200` and logged, never processed or crashed on.
- **Raw body requirement:** Razorpay signs the *exact* request bytes, so
  `server.js` mounts `app.use('/webhooks', webhookRoutes)` — with
  `express.raw({ type: 'application/json' })` scoped to just that route —
  **before** the app's global `express.json()`/`express.urlencoded()`. If
  that order were reversed, the global JSON parser would consume the body
  first and re-serializing it for verification would not reliably match
  the bytes Razorpay actually signed. Verified live end-to-end: a
  locally-constructed HMAC over a raw JSON payload was accepted; the same
  payload with a wrong/missing signature was rejected.
- **No in-memory state:** every payment decision is re-derived from the
  `orders`/`order_items`/`enrollments` tables via `providerOrderId`/`id` —
  nothing depends on a process-local `Map`/cache. This matters because
  Hostinger can restart the Node process at any time; a webhook arriving
  after a restart works identically to one arriving mid-session.
- **Free courses:** a course whose server-computed purchase price is
  exactly `0` never touches Razorpay. `POST /courses/:slug/enroll-free`
  (authenticated STUDENT, CSRF-protected) re-validates the price is `0`
  server-side and calls `enrollmentService.enrollFree`, which creates the
  `Enrollment` directly with `orderId: null` — no fake `Order`/`OrderItem`
  is ever created for a free enrollment.
- **Manual admin enrollment** (from Phase 4) is unchanged and still uses
  `orderId: null` — a paid enrollment is the only kind that ever links to a
  real `Order`, so `Enrollment.orderId` reliably distinguishes "how did
  this student get in": `null` for free/manual, a real id for paid.
- **Checkout concurrency:** double-clicking "Pay Securely" or opening two
  tabs can create more than one local `PENDING` order for the same course —
  this is allowed (kept simple, as the spec calls for) rather than
  deduplicated, because it's harmless: `finalizePaidOrder`'s idempotent gate
  and the `Enrollment` unique `(userId, courseId)` constraint mean only the
  order that's actually paid ever produces an enrollment, and the checkout
  page itself immediately redirects an already-enrolled student to
  `/learn/:slug` on the next visit rather than letting them start a second
  purchase.
- **Rate limiting:** `src/middleware/paymentRateLimit.js` (30 req/15min/IP)
  applies to `create-order` and `verify` — **not** to the webhook, since
  Razorpay retries webhooks on non-2xx responses and throttling it could
  drop a legitimate retry.
- **Logging:** payment lifecycle events log the internal order id, provider
  order/payment id, event type, and outcome (`[payment] ...` / `[webhook]
  ...` prefixes) — never the key secret, webhook secret, signature values,
  or card/UPI details.
- **Admin orders** (`GET /admin/orders`, `/admin/orders/:id`) are
  **read-only** — there is no "mark as paid" override. Order status only
  ever changes via a verified Razorpay event (client-verify or webhook),
  by design (a manual override would need its own separately-designed,
  audited feature).
- **Dashboard revenue:** `src/services/order.service.js#getPaymentStats`
  sums `amount` via `prisma.order.aggregate({ where: { status: 'PAID' } })`
  — a Decimal-safe database-side sum, summing only `PAID` orders, never
  `PENDING`/`FAILED`/`CANCELLED` ones.

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
- **Razorpay webhook:** in the Razorpay Dashboard, add a webhook pointing at
  `https://YOUR-DOMAIN.com/webhooks/razorpay` (replace with your real
  production domain), subscribed to at least `payment.captured` and
  `payment.failed` (and `order.paid` if desired — handled identically to
  `payment.captured`). Copy the webhook secret it generates into
  `RAZORPAY_WEBHOOK_SECRET`. This is a plain HTTPS Express route — no
  special Hostinger configuration is required beyond the site already being
  served over HTTPS (which Hostinger's proxy terminates).
- No Docker, PM2, Redis, systemd, custom nginx config, or background workers
  are required or assumed anywhere in this codebase.
- All file paths use `path.join(...)`/`process.cwd()`-relative resolution —
  nothing depends on a Windows-style path, and all filenames/imports are
  written case-correctly for Linux's case-sensitive filesystem.

## Next Phase

See the report delivered alongside this implementation for the full Phase 6+
scope (coupons/discount codes, subscriptions, refunds UI, invoices/GST,
PDF certificates, real video DRM/upload storage, SMTP email, notifications,
analytics, instructor accounts, instructor payouts).
# Phase 6 — student accounts, certificates, and support

- Student account routes: `/student/profile`, `/student/security`, and `/student/certificates`.
- Certificates are issued only after an active student completes every published lesson. `LessonProgress` is the source of truth; `Enrollment.progressPercent` is never trusted for eligibility.
- Issuance is idempotent by the unique user/course record. PDFs are generated on demand with pure-JS `pdf-lib`; no certificate files are stored on the Hostinger filesystem. Public verification is at `/certificates/verify/:certificateNumber`.
- Contact submissions and newsletter signups are database-backed, CSRF-protected and rate-limited. SMTP delivery is intentionally pending.
- Public contact and branding values are centralized through `SITE_NAME`, `SUPPORT_EMAIL`, `CONTACT_EMAIL`, `CONTACT_PHONE`, and `WHATSAPP_NUMBER` in `.env`; see `.env.example`.
- `/privacy` and `/terms` are clearly marked placeholder pages and require client/legal review before production.
- Hostinger compatibility is preserved: Node, Express, MySQL/Prisma (via the TiDB HTTPS adapter in production — see "Production Operations" below), Prisma-backed sessions, and pure-JS dependencies only.

## Payment launch warning

Razorpay architecture is **IMPLEMENTED: YES**. **REAL PROVIDER VERIFIED: NO**. **PRODUCTION READY: NO**. Real Razorpay TEST/LIVE verification remains mandatory before launch. SMTP, final legal text, and real contact/branding details are also required before production.

## Production Operations

### Runtime database: Hostinger → HTTPS → TiDB Cloud

Hostinger's Node.js Web App runtime cannot reach raw MySQL over TCP (verified
against both Hostinger's own managed MySQL and an external TiDB Cloud
database — every DB-backed route returned 500 until this was worked
around). Production therefore uses **TiDB Cloud Serverless** as the
database, accessed at runtime through **TiDB's official HTTPS serverless
driver** (`@tidbcloud/serverless` + `@tidbcloud/prisma-adapter`) instead of
a normal TCP connection:

```
Hostinger Node.js app → HTTPS → TiDB Cloud Data Service → lms_production
```

This is wired up in `src/config/db.js`: when the `USE_TIDB_HTTP_ADAPTER=1`
environment variable is set, the shared `PrismaClient` is constructed with
a `PrismaTiDBCloud` adapter built from the same `DATABASE_URL` (no separate
credential). When unset (local day-to-day dev against a local MySQL
container), Prisma uses its normal TCP query engine. Hostinger's
environment has `USE_TIDB_HTTP_ADAPTER=1` set permanently.

`generator client` in `prisma/schema.prisma` has `previewFeatures =
["driverAdapters"]` enabled to support this. The `datasource` block is
still plain `provider = "mysql"` — the schema itself is unchanged.

**Known adapter limitation:** unique-constraint violations do not come back
as Prisma's normal `P2002` error code through this adapter — only the raw
driver error, with the underlying MySQL error embedded in the message text.
`src/lib/prismaErrors.js` (`isUniqueConstraintError`) checks both forms;
use it anywhere idempotent-on-conflict logic is needed. Verified separately
that `P2025` (record not found on update/delete) *is* still synthesized
correctly by Prisma's own engine even through the adapter, so no equivalent
workaround was needed there. Both interactive (`prisma.$transaction(async
tx => ...)`) and sequential-array transactions were verified working
end-to-end (order/certificate/password-reset flows) against the adapter.

### Migrations: TCP only, run from a machine that can reach the database

**Prisma Migrate always uses a normal MySQL TCP connection — it does not
go through the HTTPS adapter, regardless of `USE_TIDB_HTTP_ADAPTER`.**
Since Hostinger cannot make that TCP connection, `prisma migrate deploy`
must **never** be run from Hostinger. Instead:

```
# From a developer machine or CI runner that can reach TiDB directly:
DATABASE_URL="mysql://...tidbcloud.com:4000/lms_production?sslaccept=strict" \
  npx prisma migrate deploy
```

Apply new migrations this way **before** deploying application code that
depends on them, then deploy the code to Hostinger separately (code
deployment does not run migrations).

### Sessions: Prisma-backed, not express-mysql-session

`express-mysql-session` needed the same raw MySQL TCP connection that's
unavailable on Hostinger, so it has been replaced with a custom store
(`src/lib/prismaSessionStore.js`) backed by the `Session` Prisma model —
reads/writes go through the same TiDB HTTPS adapter as everything else.
No Redis, no in-memory store, no background worker: expired rows are
opportunistically swept (at most once per 30 minutes per running process)
during normal `set`/`touch` calls, but correctness never depends on that
sweep running — `get()` always re-checks `expiresAt` itself. Password-reset
session invalidation (`invalidateUserSessions` in `auth.service.js`) uses
the store's `destroyUserSessions(userId)` method, an indexed query against
`Session.userId` rather than a full-table scan.

### Local video storage & persistence

Local (Hostinger-hosted) lesson videos live under the path in
`VIDEO_STORAGE_ROOT` (`src/lib/videoStorage.js`) — **not** inside
`public/`, and not web-servable. In production this **must** point outside
the app's deployment directory (`hbuilds/current/nodejs` on Hostinger,
which is replaced wholesale on every redeploy); it's currently set to a
dot-prefixed directory under `public_html/` (Hostinger's build pipeline
does not touch `public_html` itself, and the dotfile-blocking `.htaccess`
rule keeps it inaccessible over HTTP). Locally it defaults to
`./storage/videos`.

Admin attaches a local video to a lesson two ways (lesson edit page):
upload directly (multer, capped at 200MB, streamed to disk), or register a
filename already placed into `storage/videos/<course-slug>/` via Hostinger
File Manager/SFTP — the latter is the recommended path for real
full-length course videos, since Hostinger's actual HTTP upload limits for
large files were never independently confirmed. Videos are served only
through the authorized `GET /media/lessons/:lessonId/video` route
(enrollment/preview checked server-side; HTTP Range support for seeking).

### Production admin

Use `scripts/create-admin.js`, not the dev-only seed admin (which is
guarded off in production by design). Reads `ADMIN_EMAIL` / `ADMIN_PASSWORD`
/ optional `ADMIN_NAME` from the environment, requires `NODE_ENV=production`
(or `ALLOW_ADMIN_SCRIPT_OUTSIDE_PRODUCTION=1` to override), hashes with
bcryptjs, upserts by email, and never logs the password:

```
ADMIN_EMAIL=owner@example.com ADMIN_PASSWORD='...' node scripts/create-admin.js
```

Run this from a machine that can reach the database directly (same
constraint as migrations), then remove `ADMIN_PASSWORD` from wherever it
was set once the account is created.

### Manual enrollment (until Razorpay is verified)

Razorpay is implemented but not production-verified, so **admin manual
enrollment is the production access-grant method**: `/admin/students` →
select a student → enroll/unenroll into a course. No payment record is
created for a manual enrollment (`Enrollment.orderId` stays `null`),
identical to a genuinely free course.

### Deployment / redeploy steps

1. Apply any new migrations from a TCP-capable machine (see above) —
   **before** deploying code that depends on them.
2. `git archive HEAD` → upload via Hostinger's Node.js build pipeline
   (equivalent to `npm ci` → `postinstall` runs `prisma generate` →
   restart).
3. Local lesson videos are unaffected — they live outside the directory
   this build step replaces (see "Local video storage" above).
4. Verify `GET /api/health` returns `"database": "connected"`.

### Backups

TiDB Cloud Serverless includes automatic backups on its standard plan;
confirm current retention in the TiDB Cloud console for this cluster.
Local videos under `VIDEO_STORAGE_ROOT` are **not** covered by that and
have no automated backup — periodically archive that directory via File
Manager/SFTP once real course videos exist.
