# Order Management System

> A production-ready **Restaurant SaaS Platform** — multi-tenant ordering, menus, orders, and analytics for hundreds of restaurants.

![CI](https://github.com/SadManFahIm/Order-management-system/actions/workflows/ci.yml/badge.svg)

The Order Management System is evolving from a single-tenant order CRUD app into a commercial, cloud-based **restaurant ordering SaaS** for the Dhaka market (KFC, Pizza Hut, Domino's, Chillox, Sultan's Dine, Star Kabab, Madchef, and hundreds more — all data-driven, never hard-coded). This repository is the **V2 foundation**: security hardening, engineering tooling, testing, and CI/CD — built incrementally on the existing, working v1 features.

---

## ✨ Features

### Currently working
- **Multi-tenant workspaces (Phase 3)** — every product, promotion, order, and team membership is scoped to a `tenant_id`; workspace CRUD, team member invites (owner/manager/cashier/kitchen/delivery/staff), plans, subscriptions, feature flags, and usage counters · `X-Tenant` header switching with fail-closed isolation (cross-tenant reads/writes return 403/404) · platform admins see and can operate on every workspace
- **Authentication & RBAC (Phase 2)** — register / login / verify-email / password-reset flows · rotating refresh tokens (httpOnly, SameSite cookie) with **session revocation + reuse detection** · optional **TOTP 2FA** · role-based access control with permission-gated routes · auth audit logging
- **CSRF protection (Phase 3)** — Origin / `Sec-Fetch-Site` verification for cookie-authenticated routes; safe methods and non-browser clients unaffected
- **Dhaka seed data (Phase 3)** — `npm run seed:restaurants` provisions 20 data-driven restaurant workspaces (KFC, Pizza Hut, Domino's, Chillox, Sultan's Dine, Star Kabab, Madchef, Takeout, Handi, and more) with 89 realistic menu items — idempotent, rerunnable
- **Menu management (Phase 4)** — tenant-scoped `menu_categories` (with self-ref subcategories + ordering), `item_variants` (size/price adjustments) and `item_addons` (paid extras) with full CRUD + RBAC (`view:menu` vs `manage:menu`); products extended with `category_id`, `prep_minutes`, `image_url`; the seed now enriches every brand with categories, sizes and add-ons; merchant **Menu page** (Wolt/Deliveroo style) with grouped category view and an item editor modal for variants/add-ons
- **Session management** — short-lived access JWT + revocable refresh sessions; `GET /api/auth/me` session validation
- **Product management** — create, edit, enable/disable, paginated listing (tenant-scoped)
- **Promotion engine** — percentage, fixed, and weighted (slab-based) promotions with best-discount selection (tenant-scoped)
- **Order management** — server-side pricing with per-item discount, subtotal, discount, and grand total (tenant-scoped)
- **Design system** — Wolt/Deliveroo-inspired UI: theme engine with light/dark mode + design tokens, shared UI kit (Button, Card, Input, Table, Modal, Toast, Skeleton, Badge, EmptyState…), workspace switcher, glassy navbar
- **Security hardening** — Helmet security headers, CORS allowlist, rate limiting, centralized error handling, validated payloads (zod), no secrets in code
- **PostgreSQL foundation (Phase 1 follow-up)** — versioned migration runner (`npm run db:migrate` / `db:migrate:down` / `db:migrate:status`) with migrations 001–004 (identity/auth, tenancy/SaaS, menu catalog, orders/promotions); dialect-selectable DB config (`DB_DIALECT` / `DATABASE_URL`, default SQLite); PostgreSQL 16 service in `docker-compose.yml`; production boots run migrations instead of `sync()`; **a dedicated CI job runs the full suite against a real PostgreSQL 16**
- **v1 → v2 data migration** — `npm run db:migrate:v1 -- --source data.sqlite` copies the legacy SQLite data into the migrated schema under a default tenant (id maps, `password` → `password_hash`, DECIMAL money conversion, order/status remapping) with blocking verification: row-count parity, money invariants and FK integrity

### Roadmap (V2)
Rich menu management (categories, variants, add-ons, allergens, images) · customer storefront & ordering · kitchen workflow & live order tracking · payments (SSLCommerz, bKash, Nagad, Stripe) · analytics dashboards · SaaS admin portal · hardening (performance, observability, load) · production release.

> Full audit and phased roadmap: [`docs/01-codebase-audit.md`](docs/01-codebase-audit.md) · [`docs/02-v2-roadmap.md`](docs/02-v2-roadmap.md) · [`docs/03-database-schema.md`](docs/03-database-schema.md)

---

## 🧱 Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20 · Express · Sequelize · SQLite (dev, default) → PostgreSQL 16 (V2) · pg · versioned migrations · JWT · zod |
| Frontend | React 18 · Vite 7 · Axios · React Router 7 |
| Security | Helmet · express-rate-limit · bcrypt · strict CORS |
| Quality | Vitest · Supertest · ESLint · GitHub Actions CI |
| DevOps | Docker · docker-compose · nginx (SPA + API proxy) |

---

## 📁 Repository Structure

```
.
├── backend/                  # Express API
│   ├── src/
│   │   ├── app.js            # App assembly (middleware, routes, errors)
│   │   ├── index.js          # Server bootstrap + graceful shutdown
│   │   ├── config/           # Validated environment config + DB
│   │   ├── middleware/       # Auth, RBAC, tenant, rate limits, errors, request IDs
│   │   ├── models/           # Sequelize models (users, sessions, tenants, audit)
│   │   ├── routes/           # auth, products, promotions, orders, menu
│   │   ├── services/         # auth service, audit service, email adapter
│   │   ├── validators/       # zod request schemas
│   │   ├── utils/            # promotion engine, pagination
│   │   ├── test/             # Test environment setup
│   │   └── __tests__/        # Unit + integration tests
│   ├── migrations/           # Versioned SQL/schema migrations (001–004)
│   ├── scripts/              # CLI utilities (seed-admin, migrate runner, v1→v2 copy, smoke)
│   └── Dockerfile
├── frontend/                 # React SPA
│   ├── src/
│   │   ├── components/       # Shared UI components
│   │   ├── context/          # Auth context (session state)
│   │   ├── pages/            # Login, Products, Promotions, Orders
│   │   └── api.js            # Axios client (env-based URL, 401 handling)
│   └── Dockerfile
├── .github/workflows/ci.yml  # CI pipeline
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

The default dev setup is zero-config SQLite. To develop against PostgreSQL instead:

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

`npm run db:migrate:down` rolls back the most recent migration. The backend also runs pending migrations automatically at boot when `DB_DIALECT=postgres` (production boots migrations only — never `sync()`).

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173 (proxies /api to the backend)
```

Log in with the seeded admin credentials.

### 3. Docker (optional)

```bash
cp .env.example .env          # root-level file for docker-compose secrets
docker compose up --build
```

- PostgreSQL 16 (`db`) · Backend: http://localhost:4000 · Frontend: http://localhost:5173
- The frontend's nginx proxies `/api` to the backend — no CORS issues in production.
- Containers include healthchecks; the backend waits for `db` healthy, then runs migrations automatically on first boot (data persists in the `pgdata` volume).
- `JWT_SECRET` is **required** via the root `.env` (never hard-coded).

---

## ⚙️ Configuration

| Variable | Where | Purpose |
|---|---|---|
| `JWT_SECRET` | backend `.env` / root `.env` | Signs access tokens (min 16 chars — **never commit real values**) |
| `PORT` | backend `.env` | API port (default 4000) |
| `DB_STORAGE` | backend `.env` | SQLite file path (dev, default dialect) |
| `DB_DIALECT` | backend `.env` | `sqlite` (default) or `postgres` |
| `DATABASE_URL` | backend `.env` | PostgreSQL connection string (`postgres://user:pass@host:port/db`) |
| `DB_HOST` / `DB_PORT` | backend `.env` | PostgreSQL host/port when not using `DATABASE_URL` |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | backend `.env` | PostgreSQL database/credentials when not using `DATABASE_URL` |
| `DB_SSL` | backend `.env` | Set `1` for TLS to managed PostgreSQL (e.g. Neon) |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` / `DB_PORT` | root `.env` | Provision the compose `db` service (defaults: `oms`/`oms`/`oms`/`5432`) |
| `CORS_ORIGINS` | backend `.env` | Comma-separated allowed browser origins |
| `NODE_ENV` | backend `.env` | `development` / `test` / `production` |
| `TRUST_PROXY` | backend `.env` | Set `1` behind a reverse proxy |
| `APP_BASE_URL` | backend `.env` | Public app URL used to build verification/reset links |
| `VITE_API_URL` | frontend `.env` | Custom API base URL (defaults to same-origin `/api`) |
| `CORS_ORIGINS` | backend `.env` | Comma-separated allowed origins (defaults to localhost:5173/5174) — required for CSRF origin checks |

---

## 🧪 Testing & Quality

```bash
cd backend
npm test                      # Vitest — 105 unit + integration tests
npm run test:coverage         # with coverage report
npm run lint                  # ESLint

cd frontend
npm run lint                  # ESLint
npm run build                 # production build
```

The test suite covers the promotion engine (all discount types, date windows, best-discount selection), the full auth lifecycle (register, verify, login, refresh rotation + reuse detection, logout, password reset), TOTP 2FA setup/verify/disable, RBAC + tenant isolation (cross-tenant 403/404, ID injection, suspended/archived workspaces, role switching), CSRF rejection, and API integration (order creation with promotions, validation errors, security regressions).

---

## 🔄 CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs on every push/PR to `master`:

- **Backend:** `npm ci` → lint → test → `npm audit --audit-level=high`
- **Backend — PostgreSQL 16:** real `postgres:16` service → `db:migrate` → `db:migrate:status` → full test suite with `DB_DIALECT=postgres` → seed + production-mode boot smoke
- **Frontend:** `npm ci` → lint → build → `npm audit` (informational — see workflow comment)

The workflow also exposes a `workflow_dispatch` trigger, so CI can always be run manually from the
Actions tab (or `gh workflow run ci.yml`) even when GitHub's webhook-triggered events are delayed.

---

## 🔐 Security Posture

- **No open account creation** — admins are provisioned via CLI only; customer registration requires email verification
- **RBAC + tenant isolation** — every route enforces at least `authenticated`; privileged routes check permissions; tenant scoping is fail-closed
- **Helmet** security headers (CSP, HSTS, nosniff, frame protection)
- **CORS allowlist** — origins restricted via environment configuration
- **Rate limiting** — strict limits on auth endpoints, global API limit
- **Input validation** — every payload validated with zod before reaching the database
- **Central error handling** — unified error envelope with request IDs; internal errors never leak details
- **Environment hygiene** — `.env`, databases, and `node_modules` are gitignored; secrets are never committed
- **Dependency discipline** — CI gates on known vulnerabilities; `npm ci` for reproducible installs

**Remaining known advisories (non-blocking):** react-router 7.18.x reports an RSC-mode CSRF advisory that does not apply to this declarative-mode SPA (no server actions). Tracked in CI with an informational audit step.

---

## 🗺️ Roadmap

| Phase | Focus | Status |
|---|---|---|
| 1 | Foundation: security, tooling, tests, CI + PostgreSQL stack (migration runner, PG dev service) | ✅ Done |
| 2 | Authentication & RBAC (roles, refresh tokens, 2FA) | ✅ Done |
| 3 | Multi-tenant workspaces + Dhaka seed data | ✅ Done |
| 4 | Menu management (categories, variants, add-ons) — image pipeline deferred | ✅ Menu core shipped |
| 5 | Ordering & fulfillment (storefront, kitchen workflow) | ⬜ |
| 6 | Payments (SSLCommerz, bKash, Nagad, Stripe) | ⬜ |
| 7 | Analytics & dashboards | ⬜ |
| 8 | Admin portal & SaaS operations | ⬜ |
| 9 | Hardening (performance, observability, load) | ⬜ |
| 10 | Production release | ⬜ |

See [`docs/02-v2-roadmap.md`](docs/02-v2-roadmap.md) for the detailed plan with objectives, deliverables, dependencies, effort, risks, and acceptance criteria per phase.

---

## 📚 Documentation

- [`docs/01-codebase-audit.md`](docs/01-codebase-audit.md) — full V1 audit (59 findings with severity, impact, solution, effort)
- [`docs/02-v2-roadmap.md`](docs/02-v2-roadmap.md) — target architecture, multi-tenancy strategy, ER diagram, phased roadmap
- [`docs/03-database-schema.md`](docs/03-database-schema.md) — normalized multi-tenant PostgreSQL schema (DDL, indexes, constraints, soft delete, audit), migration system, and the v1 → v2 data migration plan

---

## 🤝 Contributing

1. Fork the repo and create a feature branch from `master`
2. Run `npm run lint` and `npm test` (backend) before pushing
3. Open a pull request — CI must pass

---

## 📄 License

Private / internal — all rights reserved.

