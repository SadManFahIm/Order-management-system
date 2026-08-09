# Order Management System

> A production-ready **Restaurant SaaS Platform** — multi-tenant ordering, menus, orders, fulfillment, and analytics for hundreds of restaurants across Bangladesh.

![CI](https://github.com/SadManFahIm/Order-management-system/actions/workflows/ci.yml/badge.svg)

The Order Management System is evolving from a single-tenant order CRUD app into a commercial, cloud-based **restaurant ordering SaaS** for the Dhaka market (KFC, Pizza Hut, Domino's, Chillox, Sultan's Dine, Star Kabab, Madchef, and hundreds more — all data-driven, never hard-coded). This repository is the **V2 platform**: security hardening, multi-tenancy, RBAC, engineering tooling, testing, CI/CD, and a growing customer-facing storefront — built incrementally on the existing, working v1 features.

**Current status:** Phases 1–4 **done** ✅ (incl. Phase 4 completion rounds 2 & 3: XLSX import, soft delete + optimistic locking, public menu pagination, inventory, merchant dashboard with live analytics charts, CRAV-style landing page, and per-tenant storefront branding) · Phase 5 (ordering & fulfillment) **foundation shipped** ✅ — order status workflow, **fully translated Bangla landing + storefront**, **QR table menus (printable + downloadable + table-aware orders)**, **kitchen/delivery order filters (status/table/open-first)**, **WhatsApp order alerts (webhook + wa.me)**, and the Deliveroo-style design system are live; the customer-facing checkout flow is the next sprint.

---

## 📋 Scrum Master's Delivery Summary

| Sprint / Phase | Delivered | Verification |
|---|---|---|
| **Phase 1** — Foundation | Security hardening (Helmet, CORS, rate limiting, zod validation, central errors), hotfix wave, PostgreSQL stack (migration runner, migrations 001–005, PG dev service), CI/CD pipeline | Backend + PG CI jobs green |
| **Phase 2** — Auth & RBAC | Register/login/verify/reset flows, rotating refresh tokens with reuse detection, TOTP 2FA, role-based access control (admin/owner/manager/cashier/kitchen/delivery), session management | Full auth + RBAC test suites |
| **Phase 3** — Multi-tenant SaaS | Tenant workspaces, team members & roles, plans/subscriptions/feature flags, tenant-scoping middleware (fail-closed isolation), CSRF protection, Dhaka seed data (20 workspaces, 89 menu items) | Tenant isolation + CSRF suites |
| **Phase 4** — Menu & Media | Menu catalog (categories/variants/add-ons), image pipeline (sharp → WebP, S3-compatible storage, CDN-ready), bulk **CSV + XLSX** import, public menu API with HTTP caching + pagination, **DELETE endpoints**, **soft delete + optimistic locking**, **inventory**, **merchant dashboard with analytics charts**, **CRAV-style landing page**, **per-tenant storefront branding**, **MinIO S3 test tier in CI** | 21 suites · 204 tests passing |
| **Phase 5 (foundation)** — Ordering | **Order fulfillment workflow** (placed → preparing → ready → delivered, role-gated, cancel rules), **fully translated English/Bangla i18n** (landing, storefront & merchant app), **QR table menus** (tables CRUD + printable QR sheet + per-table **PNG download** + hide/show + public tables API), **table-aware orders** (orders carry `table_no`, validated against the workspace tables, shown to kitchen/delivery), **order filters** (status / table / open-first sort), **WhatsApp order alerts** (webhook on new orders + wa.me manual links), Deliveroo-inspired design system | 224 tests passing (SQLite) + PG · live UI verified |

---

## ✨ Features

### Currently working

**Multi-tenancy & SaaS operations (Phase 3)**
- Every product, promotion, order, and team membership is scoped to a `tenant_id`; workspace CRUD, team member invites (owner/manager/cashier/kitchen/delivery/staff), plans, subscriptions, feature flags, and usage counters
- `X-Tenant` header switching with fail-closed isolation — cross-tenant reads/writes return 403/404; platform admins see and can operate on every workspace

**Authentication, RBAC & security (Phase 2)**
- Register / login / verify-email / password-reset flows · rotating refresh tokens (httpOnly, SameSite cookie) with **session revocation + reuse detection** · optional **TOTP 2FA**
- Role-based access control (platform_admin / owner / manager / cashier / kitchen / delivery) with permission-gated routes and fine-grained `req.userHas()` checks · auth audit logging
- CSRF protection (Origin / `Sec-Fetch-Site` verification) · Helmet headers · CORS allowlist · rate limiting · zod validation · centralized error envelope with request IDs

**Ordering & fulfillment (Phase 5 foundation)**
- **Order status workflow** — `PATCH /api/orders/:id/status` advances orders through `placed → preparing → ready → delivered`; transitions are sequential and role-gated (`fulfill:orders` for kitchen, `deliver:orders` for delivery, `manage:orders` for managers)
- **Cancel rules** — managers can cancel `placed`/`preparing` orders; terminal/canceled orders cannot transition (409)
- **Orders UI** — Status column with color-coded badges + one-click advance/cancel actions, tenant-scoped and RBAC-aware
- Server-side pricing with per-item discount, subtotal, discount, and grand total

**Menu management (Phase 4)**
- Tenant-scoped `menu_categories` (self-ref subcategories + ordering), `item_variants` (size/price adjustments) and `item_addons` (paid extras) with full CRUD + RBAC (`view:menu` vs `manage:menu`)
- Merchant **Menu page** (Wolt/Deliveroo style) with grouped category view and an item editor modal for variants/add-ons
- **Delete support** — products and promotions can be removed (FK-safe: order history preserved via `SET NULL`, children cascade)
- **Soft delete + optimistic locking** — products are soft-deleted (`deleted_at`, order history stays intact); every edit carries a `version` and stale writes get **409 VERSION_CONFLICT** (all update paths bump the version, including bulk menu operations)

**Image pipeline (Phase 4)**
- Authenticated, tenant-scoped uploads (`POST /api/uploads/images`) processed with **sharp** into optimized WebP (standard 1600px + 320px thumbnail): MIME sniffing, size/dimension caps, EXIF stripping, cleanup on failure
- Modular storage abstraction — `local` driver (zero-config dev) or any **S3-compatible bucket** (AWS/MinIO/R2) with optional CDN URLs (`CDN_BASE_URL`); delete removes standard + thumb
- **S3 driver tested against a real MinIO instance in CI** — see `.github/workflows/ci.yml` job "Backend — S3 driver vs MinIO"

**Bulk import (Phase 4)**
- `POST /api/products/import` accepts **CSV and XLSX** (Excel template at `/api/products/import/template`; `.xlsx` detected by filename/mime and parsed via exceljs): per-row validation, duplicate handling (`skip` / `error` / `update`), auto-creation of unknown categories, batched transactional writes, structured summary (`succeeded/failed/skipped` + per-row errors) — partial success by design
- Soft-delete aware: re-importing a soft-deleted item never spawns a phantom duplicate — `update` resurrects it, `skip` counts it as existing; oversized files/sheets are rejected up front

**Public storefront menu (Phase 4)**
- Read-only, unauthenticated `GET /api/public/restaurants/:slug[/menu]` with whitelist-only serialization (never internal/user fields), category + availability filters, suspended/archived tenants 404
- **HTTP caching** — `Cache-Control: public, max-age=60` + `ETag` with `304 Not Modified` round-trips (10× faster storefront reads); **pagination** via `?limit&offset` + `X-Total-Count` (storefront "Show more" loads in pages); live demo page at `/m/:slug`

**Inventory (Phase 4 completion)**
- `inventory_items` snapshots per menu item (stock qty, low-stock threshold, unit) — set via product create/edit or `PATCH /api/products/:id/inventory`; low-stock items get a warning badge in the Products table

**Analytics dashboard (Phase 4 R3)**
- `GET /api/dashboard` returns today's revenue/orders, open fulfillment load, **top items**, a **zero-filled 7-day revenue & order-volume trend**, and a **status breakdown** over the same window — all tenant-scoped
- The dashboard renders it with a **dependency-free SVG chart kit** (area trend with draw-in animation + hover readout, rounded order bars, status donut) that adapts to light/dark and per-tenant brand accents; `npm run seed:orders` backfills a realistic 7-day history so charts are live on a fresh install

**Marketing site & per-tenant branding (Phase 4 R3)**
- **CRAV-style landing page** at `/` — animated gradient hero with floating food orbs, brand marquee, how-it-works steps, feature grid, phone storefront mockup, and scroll-reveal animations (reduced-motion aware), all on the light/dark design tokens
- **Per-tenant brand theming** — each workspace stores a `brand` theme (`primaryColor`, `accentColor`, `tagline`, `announcement`, logo) in its settings; the **public storefront** (`/m/:slug`) themes its hero, chips and buttons from it, and the new **Settings → Storefront branding** editor (colour pickers + quick presets + live preview) updates it instantly; only public-safe brand fields ever leave the API

**Localization (Phase 5 foundation)**
- **English/Bangla i18n toggle** — dependency-free `I18nProvider` with EN/BN dictionaries, localStorage persistence, `<html lang>` sync, and graceful English fallback for untranslated keys; nav, login, page headers, order statuses, action buttons, **the entire landing page** (hero, feature grid, marquee label, phone mockup) and **the public storefront chrome** (open-line, table pill, options, load-more) all switch instantly — a key differentiator for the Dhaka market

**QR table menu (Phase 5)**
- **`tables` table + CRUD** — every workspace manages physical tables (`table_no` unique per tenant, name, capacity, active toggle) via `GET/POST/PATCH/DELETE /api/tables`, RBAC-gated (`view:menu` vs `manage:menu`), tenant-isolated
- **Scannable QR codes** — `GET /api/tables/qr` renders each active table's storefront URL (`/m/:slug?table=N`, built from `APP_BASE_URL`) into an SVG data URI using the same `qrcode` package as TOTP 2FA (no new dependency)
- **Print-ready QR sheet** — the **QR menu page** (`/tables`) shows every table with its QR, copy-link and open-menu actions, **per-table PNG download** (canvas-rendered 600px with quiet zone, SVG fallback), **hide/show toggle** (hidden tables leave the QR sheet & storefront but stay re-enableable), an add-table modal, and an A4 print sheet (`🖨️ QR শিট প্রিন্ট`) with cut marks — customers scan and land on the menu with their table pre-selected
- **Public tables API** — `GET /api/public/restaurants/:slug/tables` returns only active tables with storefront-safe fields (cached + ETag like the menu); the storefront shows a **table pill** (`🪑 Table 3`) from the `?table=` param

**Table-aware orders (Phase 5)**
- Orders carry a physical **`table_no`** (migration 007) — validated against the workspace's active tables at creation (unknown/inactive/other-tenant tables → `400 INVALID_TABLE`), then stored denormalised so history survives table renames/deletes
- **New Order page** gets a dine-in **table selector** (populated from `/api/tables`); the **Orders list** shows a `🪑 Table N` badge per order so kitchen/delivery see exactly where the order belongs — demo orders seeded with table numbers

**Kitchen/delivery order filters (Phase 5)**
- `GET /api/orders` accepts **`?status=`**, **`?table_no=`** (or `none` for no-table) and **`?sort=open`** — open-first ordering surfaces `placed → preparing → ready` before finished orders, so the busiest work is at the top
- The **Orders page** gets a filter bar (status dropdown, table dropdown populated from `/api/tables`, newest/open-first sort, default **open-first** for the fulfillment view)

**WhatsApp order alerts (Phase 5)**
- **Webhook** — with WhatsApp enabled + a `webhookUrl` (Twilio, WATI, Infobip or any gateway), every new order is POSTed as JSON (`event: order.created` with order no, table, customer, items, total) authenticated by an optional Bearer secret; **fire-and-forget** with a short timeout — a dead gateway never delays or breaks order creation
- **wa.me manual flow** — Settings → WhatsApp lets merchants set their number, toggle alerts, and hit **Send test alert** (posts a test payload or returns the manual `wa.me` link when no webhook is set); the Orders list shows a **💬 WhatsApp** action per order that opens a pre-filled message for that exact order
- Config lives in `tenant.settings.whatsapp`, validated (phone + URL), and only the public-safe `{ enabled, number }` whitelist leaves the API in the tenant list

**Design system**
- Deliveroo-inspired UI: theme engine with light/dark mode + design tokens, shared UI kit (Button, Card, Input, Table, Modal, Toast, Skeleton, Badge, EmptyState…), workspace switcher, glassy navbar, playful motion (bounce, lift, shimmer). See [`docs/06-design-system.md`](docs/06-design-system.md)

**PostgreSQL foundation & data migration (Phase 1–4)**
- Versioned migration runner (`npm run db:migrate` / `db:migrate:down` / `db:migrate:status`) with migrations 001–007; dialect-selectable DB config (`DB_DIALECT` / `DATABASE_URL`, default SQLite); PostgreSQL 16 service in `docker-compose.yml`; migrations run at boot on both dialects
- Every Sequelize model maps to migration tables/columns (`tableName` + `field` mappings) — the app runs unchanged against a *migrations-only* database on SQLite **and** PostgreSQL (v1 `sync()` bridge removed), guarded by a drift test and a dedicated PG CI job
- **v1 → v2 data migration** — `npm run db:migrate:v1 -- --source data.sqlite` copies legacy data into the migrated schema (id maps, `password → password_hash`, DECIMAL conversion, order/status remapping) with blocking verification: row-count parity, money invariants, FK integrity
- **Production cutover runbook** — [`docs/04-pg-cutover-runbook.md`](docs/04-pg-cutover-runbook.md): backup → dry-run → migrate → copy → verify → flip → rollback

**Dhaka seed data (Phase 3)**
- `npm run seed:restaurants` provisions 20 data-driven restaurant workspaces (KFC, Pizza Hut, Domino's, Chillox, Sultan's Dine, Star Kabab, Madchef, Takeout, Handi, and more) with 89 realistic menu items **and 12 QR tables each** — idempotent, rerunnable

**End-to-end tests (Playwright)**
- `cd frontend && npx playwright test`: boots the real API on a scratch DB + the Vite app and drives login, product CRUD, order creation, and the fulfillment UI through the actual browser · runs in CI (dedicated `e2e` job)

### Roadmap (V2)
Customer storefront checkout & tracking · WhatsApp notifications · payments (bKash, Nagad, SSLCommerz, Stripe) · deeper analytics dashboards · SaaS admin portal · hardening (performance, observability, load) · production release.

> Full audit and phased roadmap: [`docs/01-codebase-audit.md`](docs/01-codebase-audit.md) · [`docs/02-v2-roadmap.md`](docs/02-v2-roadmap.md) · [`docs/03-database-schema.md`](docs/03-database-schema.md)

---

## 📸 Screenshots

> Live captures from the running app (Deliveroo-inspired teal theme). Re-capture with `cd frontend && node scripts/screenshots.mjs` while the dev servers are up.

| | |
|---|---|
| **Public storefront** — live menu demo at `/m/:slug` | **Login — dark mode** |
| ![Public storefront](docs/screenshots/public-menu-light.png) | ![Login dark](docs/screenshots/login-dark.png) |
| **Products — light mode** | **Products — dark mode** |
| ![Products light](docs/screenshots/products-light.png) | ![Products dark](docs/screenshots/products-dark.png) |
| **Login — light mode** | |
| ![Login light](docs/screenshots/login-light.png) | |

---

## 🧱 Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20 · Express · Sequelize · SQLite (dev, default) → PostgreSQL 16 (V2) · pg · versioned migrations · JWT · zod · sharp · @aws-sdk/client-s3 · multer · csv-parse · exceljs · qrcode |
| Frontend | React 18 · Vite 7 · Axios · React Router 7 · Playwright (e2e) |
| Security | Helmet · express-rate-limit · bcrypt · otplib (2FA) · strict CORS · CSRF origin checks |
| Quality | Vitest · Supertest · ESLint · GitHub Actions CI (5 jobs incl. MinIO + PG) |
| DevOps | Docker · docker-compose · nginx (SPA + API proxy) |

---

## 📁 Repository Structure

```
.
├── backend/                  # Express API
│   ├── src/
│   │   ├── app.js            # App assembly (middleware, routes, errors)
│   │   ├── index.js          # Server bootstrap + graceful shutdown
│   │   ├── config/           # Validated environment config + DB + storage
│   │   ├── middleware/       # Auth, RBAC, tenant, CSRF, rate limits, errors
│   │   ├── models/           # Sequelize models (aligned to migrations)
│   │   ├── routes/           # auth, products, promotions, orders, menu, uploads, public, dashboard, tables
│   │   ├── utils/            # promotion engine, pagination
│   │   ├── test/             # Test environment setup
│   │   └── __tests__/        # 22 suites · 224 tests
│   ├── migrations/           # Versioned schema migrations (001–007)
│   ├── scripts/              # CLI utilities (seed, migrate runner, v1→v2 copy)
│   └── Dockerfile
├── frontend/                 # React SPA
│   ├── src/
│   │   ├── components/       # Shared UI kit + forms + cart
│   │   ├── context/          # Auth context (session state)
│   │   ├── i18n/             # EN/BN localization (I18nProvider + dictionaries)
│   │   ├── pages/            # Login, Products, Menu, Promotions, Orders, Storefront
│   │   ├── theme/            # Theme engine + design tokens
│   │   └── api.js            # Axios client (env-based URL, 401 handling)
│   ├── e2e/                  # Playwright browser tests
│   ├── scripts/              # Screenshot capture tooling
│   └── Dockerfile
├── .github/workflows/ci.yml  # CI pipeline (5 jobs)
└── docs/                     # Audit + roadmap + architecture docs
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js **20+** (see `.nvmrc`)
- npm 10+

### 1. Backend

```bash
cd backend
cp .env.example .env          # then set a strong JWT_SECRET (see below)
npm install
npm run dev                   # http://localhost:4000
```

Generate a strong secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Provision the first admin (replaces the old unauthenticated seed endpoint — **which was a critical vulnerability and has been removed**):

```bash
npm run seed:admin -- --name "Admin" --email admin@example.com --password "your-strong-password"
```

Optionally seed 20 Dhaka restaurant workspaces with realistic menus (idempotent — safe to rerun):

```bash
npm run seed:restaurants
```

#### PostgreSQL (optional — the V2 database)

```bash
# 1. Start the local PostgreSQL 16 (repo root) — or point at any PG 14+:
docker compose up -d db

# 2. Configure the backend to use it (backend/.env):
#    DB_DIALECT=postgres
#    DATABASE_URL=postgres://oms:oms@localhost:5432/oms

# 3. Apply the versioned migrations, then seed:
npm run db:migrate
npm run db:migrate:status
npm run seed:restaurants
```

`npm run db:migrate:down` rolls back the most recent migration. The backend runs pending migrations automatically at boot on **both** dialects (`sync()` is no longer used anywhere — the models are aligned to the migration DDL). Migrating an existing dev SQLite database: back it up, delete it, `npm run db:migrate`, then re-seed (`seed:admin` + `seed:restaurants`) — or preserve the old data with `npm run db:migrate:v1 -- --source <old-data.sqlite> --force`.

> **Cutover to PostgreSQL in production?** Follow [`docs/04-pg-cutover-runbook.md`](docs/04-pg-cutover-runbook.md) — backup, dry-run, migrate, copy, verify, flip, rollback.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173 (proxies /api to the backend)
```

Log in with the seeded admin credentials. Toggle **বাংলা / English** from the navbar to switch the whole UI language.

### End-to-end tests (Playwright)

```bash
cd frontend
npx playwright test           # boots a scratch backend (:4100) + Vite (:5174) automatically
```

Uses your installed Chrome locally (`channel: 'chrome'`) — CI installs its own Chromium. The suite covers login, product CRUD, order creation, and the fulfillment UI through the real browser.

### 3. Docker (optional)

```bash
cp .env.example .env          # root-level file for docker-compose secrets
docker compose up --build
```

- PostgreSQL 16 (`db`) · Backend: http://localhost:4000 · Frontend: http://localhost:5173
- The frontend's nginx proxies `/api` to the backend — no CORS issues in production
- Containers include healthchecks; the backend waits for `db` healthy, then runs migrations automatically on first boot (data persists in the `pgdata` volume)
- `JWT_SECRET` is **required** via the root `.env` (never hard-coded)

---

## ⚙️ Configuration

| Variable | Where | Purpose |
|---|---|---|
| `JWT_SECRET` | backend `.env` / root `.env` | Signs access tokens (min 16 chars — **never commit real values**) |
| `PORT` | backend `.env` | API port (default 4000) |
| `DB_STORAGE` | backend `.env` | SQLite file path (dev, default dialect) |
| `DB_DIALECT` | backend `.env` | `sqlite` (default) or `postgres` |
| `DATABASE_URL` | backend `.env` | PostgreSQL connection string |
| `DB_HOST` / `DB_PORT` | backend `.env` | PostgreSQL host/port when not using `DATABASE_URL` |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | backend `.env` | PostgreSQL credentials when not using `DATABASE_URL` |
| `DB_SSL` | backend `.env` | Set `1` for TLS to managed PostgreSQL (e.g. Neon) |
| `CORS_ORIGINS` | backend `.env` | Comma-separated allowed browser origins (CSRF origin checks) |
| `NODE_ENV` | backend `.env` | `development` / `test` / `production` |
| `TRUST_PROXY` | backend `.env` | Set `1` behind a reverse proxy |
| `APP_BASE_URL` | backend `.env` | Public app URL used to build verification/reset links |
| `STORAGE_DRIVER` | backend `.env` | `local` (default) or `s3` |
| `S3_BUCKET` / `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | backend `.env` | S3-compatible bucket credentials (AWS/MinIO/R2) — never hardcode |
| `S3_ENDPOINT` / `S3_FORCE_PATH_STYLE` | backend `.env` | Custom endpoint for MinIO/R2 |
| `CDN_BASE_URL` | backend `.env` | CDN base for public image URLs (falls back to bucket/API URL) |
| `MAX_IMAGE_BYTES` / `MAX_IMAGE_DIMENSION` | backend `.env` | Upload caps (default 5 MB / 4096 px) |
| `MAX_IMPORT_BYTES` / `MAX_IMPORT_ROWS` | backend `.env` | Import caps (default 2 MB / 2000 rows) |
| `VITE_API_URL` | frontend `.env` | Custom API base URL (defaults to same-origin `/api`) |

Full media/import/S3 setup details: [`docs/05-media-import-public-menu.md`](docs/05-media-import-public-menu.md).

---

## 🧪 Testing & Quality

```bash
cd backend
npm test                      # Vitest — 187 tests across 20 suites (2 S3 tests skip locally, run in CI/MinIO)
npm run test:coverage         # with coverage report
npm run lint                  # ESLint

cd frontend
npm run lint                  # ESLint
npm run build                 # production build
npx playwright test           # browser-level e2e suite
```

Coverage highlights: promotion engine (all discount types, date windows, best-discount selection), full auth lifecycle (register, verify, login, refresh rotation + reuse detection, logout, password reset), TOTP 2FA, RBAC + tenant isolation (cross-tenant 403/404, ID injection, suspended/archived workspaces, role switching), CSRF rejection, order creation with promotions + **fulfillment workflow** (role denials, invalid skips, cancel rules, cross-tenant isolation), DELETE endpoints, public menu caching (ETag/304), image pipeline, bulk import (CSV + XLSX, mixed success, duplicate policies, **soft-delete resurrection**), **optimistic-lock version conflicts (409)**, inventory, dashboard aggregates, S3 storage round-trip, v1→v2 migration parity, and models↔migrations drift.

---

## 🔄 CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs on every push/PR to `master` — **5 parallel jobs**:

1. **Backend:** `npm ci` → lint → test → `npm audit --audit-level=high`
2. **Backend — PostgreSQL 16:** real `postgres:16` service → `db:migrate` → `db:migrate:status` → full suite with `DB_DIALECT=postgres` → seed + production-mode boot smoke
3. **Backend — S3 driver vs MinIO:** runs a MinIO server in-process → bucket setup → real S3 driver round-trip tests
4. **E2E — Playwright:** installs Chromium → boots scratch backend + Vite → browser suite
5. **Frontend:** `npm ci` → lint → build → `npm audit` (informational)

The workflow exposes a `workflow_dispatch` trigger so CI can always be run manually (`gh workflow run ci.yml`) even when GitHub's webhook events are delayed.

---

## 🔐 Security Posture

- **No open account creation** — admins are provisioned via CLI only; customer registration requires email verification
- **RBAC + tenant isolation** — every route enforces at least `authenticated`; privileged routes check permissions; tenant scoping is fail-closed (cross-tenant 403/404)
- **Fulfillment authorization** — order status transitions are gated by role-appropriate permissions (`fulfill:orders` / `deliver:orders` / `manage:orders`)
- **Helmet** security headers (CSP, HSTS, nosniff, frame protection)
- **CORS allowlist + CSRF origin checks** — cookie-authenticated routes verify `Origin` / `Sec-Fetch-Site`
- **Rate limiting** — strict limits on auth endpoints, global API limit
- **Input validation** — every payload validated with zod before reaching the database
- **Upload safety** — MIME sniffing, size/dimension caps, EXIF stripping, path-traversal guards, storage credentials never exposed to the frontend
- **Central error handling** — unified error envelope with request IDs; internal errors never leak details
- **Environment hygiene** — `.env`, databases, and `node_modules` are gitignored; secrets are never committed
- **Dependency discipline** — CI gates on known vulnerabilities; `npm ci` for reproducible installs

**Remaining known advisories (non-blocking):** react-router 7.18.x reports an RSC-mode CSRF advisory that does not apply to this declarative-mode SPA (no server actions). Tracked in CI with an informational audit step.

---

## 🗺️ Roadmap — Phase by Phase

| Phase | Focus | Deliverables | Status |
|---|---|---|---|
| **1** | Foundation | Security hardening, hotfix wave, engineering tooling, PostgreSQL stack (migration runner, migrations 001–005, PG dev service), CI pipeline | ✅ **Done** |
| **2** | Authentication & RBAC | Register/login/verify/reset, rotating refresh tokens + reuse detection, TOTP 2FA, 6-role RBAC, session management | ✅ **Done** |
| **3** | Multi-tenant SaaS | Tenant workspaces + members/roles, tenant-scoping middleware (fail-closed), CSRF protection, Dhaka seed data (20 workspaces, 89 items) | ✅ **Done** |
| **4** | Menu & Media | Menu catalog (categories/variants/add-ons), image pipeline (sharp → WebP, S3/CDN), bulk **CSV + XLSX** import, public menu API, **delete endpoints, HTTP caching + pagination, soft delete + optimistic locking, inventory, merchant dashboard, MinIO CI tier** | ✅ **Done** |
| **5** | Ordering & fulfillment | **✅ Shipped:** order status workflow (role-gated transitions, cancel rules), English/Bangla i18n, Deliveroo design system, CRAV-inspired landing page, per-tenant brand theming · **⬜ Next sprints:** storefront checkout (cart → order → tracking), QR table menus, WhatsApp notifications | 🟡 **In progress** |
| **6** | Payments | bKash, Nagad, SSLCommerz, Stripe — tender tracking + split payments | ⬜ Planned |
| **7** | Analytics | Merchant dashboard — revenue, peak hours, top items, daily closeout | ⬜ Planned |
| **8** | Admin portal & SaaS ops | Platform admin console, subscription management, invoicing (VAT/NBR-ready) | ⬜ Planned |
| **9** | Hardening | Performance, observability, load testing (k6), offline-first POS | ⬜ Planned |
| **10** | Production release | Cutover, monitoring, go-live | ⬜ Planned |

See [`docs/02-v2-roadmap.md`](docs/02-v2-roadmap.md) for the detailed plan with objectives, deliverables, dependencies, effort, risks, and acceptance criteria per phase.

---

## 📚 Documentation

- [`docs/01-codebase-audit.md`](docs/01-codebase-audit.md) — full V1 audit (59 findings with severity, impact, solution, effort)
- [`docs/02-v2-roadmap.md`](docs/02-v2-roadmap.md) — target architecture, multi-tenancy strategy, ER diagram, phased roadmap
- [`docs/03-database-schema.md`](docs/03-database-schema.md) — normalized multi-tenant PostgreSQL schema (DDL, indexes, constraints, soft delete, audit), migration system, and the v1 → v2 data migration plan
- [`docs/04-pg-cutover-runbook.md`](docs/04-pg-cutover-runbook.md) — production SQLite → PostgreSQL cutover runbook
- [`docs/05-media-import-public-menu.md`](docs/05-media-import-public-menu.md) — image pipeline, bulk CSV import, public menu API (endpoints, filters, response shape, caching)
- [`docs/06-design-system.md`](docs/06-design-system.md) — the Deliveroo-inspired design system: tokens, colors, typography, motion, component library, page patterns

---

## 🤝 Contributing

1. Fork the repo and create a feature branch from `master`
2. Run `npm run lint` and `npm test` (backend) before pushing
3. Open a pull request — CI (5 jobs) must pass

---

## 📄 License

Private / internal — all rights reserved.
