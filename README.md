# Orderly — Multi-Tenant Restaurant Order Management

Orderly is a full-stack **restaurant ordering and operations platform**: a
public customer storefront (browse, cart, checkout, order tracking), a
merchant dashboard (menu, orders, kitchen/delivery queue, payments,
analytics), and the multi-tenant SaaS plumbing beneath them — plans, quotas,
teams, RBAC, enterprise SSO, and per-branch ("outlet") management.

It is built as a monorepo: a Node.js/Express API with PostgreSQL, a React
single-page app, and the CI/CD, container, and security tooling that ship
them.

![CI — main workflow](https://github.com/SadManFahIm/Order-management-system/actions/workflows/ci.yml/badge.svg)

> Status: actively developed. No open-source license is granted (see
> [License](#license)).

---

## Overview

Restaurants in the target market operate across channels — counter (POS),
QR table ordering, delivery aggregators, and phone orders — and reconcile
them at the end of the day against cash, mobile wallets (bKash, Nagad), bank
cards, and online gateways (SSLCommerz, Stripe). Orderly puts those channels
and the back office on one platform:

- A **public storefront** per restaurant with its own branding, bilingual
  EN/বাংলা UI, live availability (opening hours, per-item windows, closure
  days, stock), and guest checkout that is re-priced and validated
  server-side.
- A **merchant workspace** where teams (owner / manager / cashier / kitchen /
  delivery) run the operation: menu and inventory, order acceptance and
  fulfillment, split payments and refunds, VAT-aware invoicing, daily
  closeouts, and analytics.
- A **multi-tenant SaaS core**: workspaces, teams and roles, plans and quota
  enforcement, audit trails, SAML SSO, and platform-admin tooling.

Everything described in this README exists in the repository and is covered
by automated tests; feature claims trace to source, migrations, or CI
configuration. Nothing is hard-coded per restaurant — workspaces, menus, and
branding are data-driven.

## Why This Project Exists

The codebase began as a single-tenant order CRUD application (a reference
implementation of a home task — see `docs/01-codebase-audit.md`). The V2
program rebuilt it into a commercial, cloud-based restaurant SaaS:

- **Business problem**: independent and chain restaurants need one tool that
  spans ordering, payments, and reporting without engineering staff, and that
  fits local payment and compliance habits (bKash/Nagad/cash, WhatsApp, NBR
  VAT invoices).
- **Engineering problem**: the original app was not production-ready in any
  dimension — no auth, no tenant isolation, no tests or CI, a demo-grade
  schema. The V2 roadmap (`docs/02-v2-roadmap.md`) drove a full rebuild:
  security hardening, multi-tenancy, RBAC, an ordered migration system,
  PostgreSQL, and a real test/CI culture — while keeping v1 features working
  throughout (migrations `001–028`).

## Key Capabilities

### Platform (multi-tenant SaaS)

| Capability | Notes |
|---|---|
| Workspaces & teams | Tenant CRUD, member invites with expiry and revoke, role assignment, ownership transfer |
| Plans & quotas | Starter/Growth/Pro plans, subscriptions, feature flags, live usage meters (products, orders/day, members, storage) with quota gates |
| RBAC | 8 roles + an 18-permission catalogue + per-user grant/deny flag overrides |
| Enterprise SSO | SAML 2.0 SP (metadata, signed assertions, SLO), per-workspace config, platform-admin SSO overview |
| Audit trail | Append-only `audit_logs` across auth, money, membership, and settings events, surfaced in the UI |
| Multi-outlet / franchise | Outlets with memberships and per-outlet menu price/availability overrides |
| Usage-based billing meter | Scheduled, HMAC-signed usage snapshots to a billing webhook |

### Restaurant operations

| Capability | Notes |
|---|---|
| Menu management | Categories, items, variants (sizes), add-ons, tags, drag-and-drop sort, bulk edit, category duplication, CSV/XLSX import |
| Availability | Per-item windows, weekday rules, per-day overrides, restaurant closure days, timezone-aware scheduling |
| Inventory | Stock tracking (item and variant level), low-stock alerts, decrement on order |
| Orders | Counter and storefront orders; pickup / delivery / scheduled types; status workflow with role-gated transitions; cancellation with required reason |
| Kitchen & delivery | Accept/reject with reason, KDS bump bar + prep timer, zone-based auto-assignment, live queue over WebSocket with polling fallback |
| Tables & QR | Table registry, printable/downloadable QR menus, table-aware orders |
| Order editing | Staff/customer edit requests with manager approval and server-side re-pricing |
| Realtime | JWT-authenticated WebSocket hub (`/ws`) with tenant-room isolation, heartbeat, reconnect resync |

### Customer experience

| Capability | Notes |
|---|---|
| Public storefront | `/m/:slug` — per-restaurant branding, EN/বাংলা, paper light/dark themes, availability calendar per dish |
| Guest checkout | Server-side pricing and validation, `Idempotency-Key` retry safety, empty-cart/stock/closure protection |
| Order tracking | Public order-no + phone-verified lookup with live status |
| Scheduled orders | Pickup/delivery at a chosen time, validated against the restaurant's availability and timezone |
| Notifications | Email (SMTP) and WhatsApp (webhook or wa.me) order/status alerts; PDF order tickets attached to emails |

### Payments

| Capability | Notes |
|---|---|
| Payment records | Cash, bKash, Nagad, and card/online records per tenant, with cashier confirm/refund |
| Online gateways | SSLCommerz, Stripe, and bKash behind one provider registry; hosted checkout; sandbox-first config |
| Webhook security | Signature verification per gateway; bKash verified by execute-and-check (never trusting unsigned callbacks) |
| Split payments | One order across multiple methods (e.g. bKash + cash), per-diner split billing with receipts |
| Refunds | Full/partial, manager-gated (`refund:orders`), ledger-audited |
| Reconciliation | Stale online intents auto-expire; manual verify fallback; per-payment gateway verification metadata |
| Settlements | Ledger-derived wallet balance and settlement requests |
| Compliance | VAT-aware invoices (per-item NBR split, supplier block, QR), Mushak-style reporting, daily closeout with PDF + email |

### Analytics & reporting

| Capability | Notes |
|---|---|
| Merchant dashboard | Revenue curves, method mix, peak-hours heatmap, category mix, retention, fulfillment-time stats |
| Platform analytics | Cross-tenant revenue, top restaurants, method mix for platform admins |
| Funnel | Storefront Browse → Cart → Checkout → Paid over anonymous sessions |
| Operations | Rider performance vs SLA, anomaly alerts, live order queue, alerts (low stock, cancellations, idle) |
| Reports | Daily closeout, VAT compliance, nightly rollup layer, CSV export for every chart |

## Architecture

```mermaid
flowchart LR
    subgraph Browser
        C[Guest customer<br/>storefront / checkout / tracking]
        S[Merchant staff<br/>dashboard / orders / kitchen]
    end

    subgraph Web["Frontend — nginx + React SPA"]
        N[nginx<br/>static SPA, proxies /api /uploads /ws]
        R[React 18 SPA<br/>lazy routes, EN/BN, theme tokens]
    end

    subgraph Api["Backend — Node.js / Express"]
        MW[Middleware<br/>request-id, helmet, CORS, CSRF, rate limits]
        RT[Routes — auth, tenants, menu, orders,<br/>payments, reports, analytics, outlets]
        SV[Services — checkout, payments,<br/>idempotency, notifications, schedulers]
        ORM[Sequelize ORM]
    end

    DB[(PostgreSQL 16 —<br/>SQLite in development)]

    WS[WebSocket /ws<br/>realtime order queue]
    GW[Payment gateways<br/>SSLCommerz · Stripe · bKash]
    MAIL[SMTP email]
    WA[WhatsApp gateways]
    OBJ[(S3-compatible storage<br/>AWS / MinIO / R2 + CDN)]
    IDP[SAML IdP]

    C --> N
    S --> N
    N --> R
    R --> N
    N -->|"/api, /uploads, /ws"| MW
    MW --> RT --> SV --> ORM --> DB
    WS <--> SV
    WS <--> S
    SV <--> GW
    SV <--> MAIL
    SV <--> WA
    SV <--> OBJ
    MW <--> IDP
```

The backend is a single Express process. It runs versioned migrations at boot
on both dialects, then starts five schedulers (nightly closeout emails,
trial-expiry sweep, billing meter, payment reconciliation, analytics rollup),
and attaches the WebSocket hub. Multi-instance scaling is a documented
roadmap item; the realtime hub exposes a `publish()` seam so a Redis
pub/sub layer can slot in without changing callers.

## Technology Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20 · Express 4 · Sequelize 6 · zod · JSON Web Tokens |
| Frontend | React 18 · Vite 7 · React Router 7 · Axios · Playwright |
| Database | PostgreSQL 16 (production) · SQLite (zero-config development) · versioned migrations `001–028` |
| Auth & identity | bcrypt · rotating refresh tokens · TOTP (otplib) · SAML 2.0 (node-forge, xml-crypto) |
| Payments | SSLCommerz, Stripe, bKash adapters (no SDKs — `fetch` + `node:crypto`) |
| Media | sharp (WebP pipeline) · @aws-sdk/client-s3 · multer · qrcode |
| Notifications | nodemailer (SMTP) · WhatsApp webhooks/wa.me · pdfkit (PDF tickets) |
| Realtime | ws |
| Testing | Vitest · Supertest · @vitest/coverage-v8 · Playwright |
| Quality gates | ESLint 9 (backend + frontend) · `npm audit` · coverage thresholds · gitleaks · CodeQL · Dependency Review |
| DevOps | Docker · docker-compose · nginx · GitHub Actions (7-job pipeline) |

Version floor: Node **20** (`.nvmrc`, backend `engines`). PostgreSQL **16** is
the tested production database (CI tier + docker-compose).

## Project Structure

```
.
├── backend/                 # Express API
│   ├── src/
│   │   ├── app.js           # Middleware, route mounting, error envelope
│   │   ├── index.js         # Boot: migrations, schedulers, WebSocket, shutdown
│   │   ├── config/          # zod-validated env, Sequelize, storage drivers
│   │   ├── middleware/      # auth, tenant, RBAC, outlet, CSRF, rate limits
│   │   ├── models/          # Sequelize models (aligned to migration DDL)
│   │   ├── routes/          # 20 routers — auth → analytics, outlets
│   │   ├── services/        # checkout, payments, notifications, schedulers…
│   │   ├── validators/      # zod schemas per domain
│   │   ├── utils/           # logger, timezone, promotion engine…
│   │   └── __tests__/       # 55 Vitest suites
│   ├── migrations/          # 001–028 versioned schema migrations
│   ├── scripts/             # seed, migrate runner, v1→v2 copy, gateway sandbox
│   └── Dockerfile           # node:20-alpine, non-root, healthcheck
├── frontend/                # React SPA
│   ├── src/
│   │   ├── pages/           # login, products, menu, orders, storefront…
│   │   ├── components/      # shared UI kit, forms, cart, charts
│   │   ├── context/         # auth + workspace state
│   │   ├── theme/           # design tokens, light/dark/paper themes
│   │   ├── i18n/            # EN/বাংলা dictionaries
│   │   └── api.js           # axios client (refresh-on-401, X-Tenant header)
│   ├── e2e/                 # 7 Playwright specs
│   └── Dockerfile           # multi-stage → nginx
├── .github/
│   ├── workflows/           # ci.yml, codeql.yml, dependency-review.yml
│   └── dependabot.yml
├── docs/                    # audit, roadmap, schema, runbooks, design
├── docker-compose.yml       # db (PostgreSQL 16) + backend + frontend
└── .gitleaks.toml           # secret-scan config (extends defaults)
```

## Security Architecture

- **Authentication** — bcrypt-hashed passwords (cost 10) with a dummy-hash
  login path that prevents timing-based account enumeration; access JWTs live
  15 minutes. Refresh tokens are stored **hashed (SHA-256)** at rest, rotate
  on every refresh, and belong to a *family* — reuse of a rotated token
  revokes the entire family. Refresh cookies are `httpOnly` + `SameSite=Lax`
  and `Secure` in production. Single-use, expiring tokens gate email
  verification and password reset; resets revoke all sessions.
- **Login protection** — per-account lockout after 5 failed attempts
  (15 minutes, `retryAfterSeconds` surfaced), cleared on success or admin
  unlock, plus a strict per-IP auth rate limiter.
- **2FA** — TOTP with QR provisioning and a purpose-bound, 5-minute
  pre-authentication token.
- **Authorization** — permission-level RBAC (see
  [`backend/src/config/roles.js`](backend/src/config/roles.js)): roles map to
  permission sets; routes call `requirePermission`; per-user flag overrides
  are catalogue-validated so typos can't widen access; platform admins are the
  only wildcard role.
- **Tenant isolation** — every business route resolves the workspace
  membership from the database (never from client claims) and is fail-closed;
  suspended/archived workspaces are rejected; cross-tenant reads/writes return
  403/404. Dedicated `tenantIsolation`/`tenantHardening` suites cover ID
  injection and role-switch attempts.
- **API hardening** — Helmet headers; CORS allowlist; CSRF origin/site checks
  on cookie-authenticated mutations; global + auth rate limits; 1 MB body cap;
  zod validation on every payload; unified error envelope that never leaks
  500 internals; per-request UUID (`X-Request-Id`) correlated through
  structured logs.
- **Payments** — webhook authenticity enforced per gateway (SSLCommerz
  checksum, Stripe HMAC + timestamp on the raw body, bKash
  execute-and-verify); gateway-reported amounts must match the charge;
  confirmation only touches `pending` payments, so replays are idempotent;
  verification metadata is persisted per payment.
- **Idempotency** — DB-backed `Idempotency-Key` handling (unique index +
  stored responses) makes checkout retries safe even across application
  instances; failed runs never poison the key.
- **Uploads & storage** — images are re-encoded to WebP server-side (drops
  EXIF), bounded in size/dimensions, and stored under server-generated,
  tenant-namespaced keys; an object-key allowlist makes path traversal
  structurally impossible. S3-compatible buckets are configured by env only.
- **Audit** — append-only `audit_logs` for auth events, refunds, permission
  and membership changes, and settings mutations; never breaks the triggering
  request.
- **CSRF/XSS posture** — SameSite cookies + origin checks; React escapes
  rendered content; CSP headers set by Helmet and mirrored in the SPA's
  nginx.
- **CI security** — read-only workflow tokens by default, nightly gitleaks
  scan of full history, `npm audit` gates, CodeQL, Dependency Review.

## Security Tooling

| Tool | Purpose | Status |
|---|---|---|
| [Gitleaks](.gitleaks.toml) | Secret detection across full git history | Configured + runs in CI (`ci.yml` security job, every push/PR + nightly) |
| Dependabot | Dependency & action updates, security updates | Configured (`.github/dependabot.yml`) — **must be enabled in GitHub repo settings** |
| CodeQL | Static analysis / code scanning | Workflow configured (`.github/workflows/codeql.yml`) — **must be enabled in GitHub repo settings** |
| Dependency Review | Blocks PRs adding High/Critical-advisory dependencies | Configured (`.github/workflows/dependency-review.yml`) — **requires GitHub Advanced Security** |
| `npm audit` | Known vulnerability gate | CI backend job (hard gate `--audit-level=high`); frontend informational (see workflow comment) |
| Coverage gate | Enforces test floor on security-sensitive code | CI (`vitest.config.js` thresholds) |

> GitHub-side features (Dependabot alerts/security updates, secret scanning,
> push protection, code scanning, branch protection) cannot be enabled from
> repository files — see the [production security checklist](SECURITY.md).

## Testing

**Backend unit & integration (Vitest + Supertest).** 55 test files, 670 tests
(668 passing, 2 skipped in a local run). Suites cover the auth lifecycle
(registration, verification, refresh rotation + reuse detection, lockout,
2FA), RBAC and tenant isolation (cross-tenant 403/404, ID injection,
suspended workspaces, permission overrides), menu/availability logic, the
checkout contract (server-side pricing, idempotency, stock/closure guards),
payments (gateways, splits, refunds, reconciliation), CSRF, uploads, S3
storage, SAML, schedulers, migrations, and model↔migration drift.

```bash
cd backend
npm test               # full suite (SQLite)
npm run test:coverage  # coverage report — CI enforces lines ≥85, functions ≥85,
                       # branches ≥68, statements ≥87
npm run lint
```

**PostgreSQL tier.** The same suite runs against a real PostgreSQL 16 in CI
after applying all migrations from scratch — plus a v1→v2 data-copy check, a
seed, and a production-mode boot smoke. Reproduce locally with
`cd backend && npm run db:pg:test` (needs a local PostgreSQL).

**Browser E2E (Playwright).** 27 scenarios across 7 specs (`frontend/e2e`),
run in CI against a scratch backend on PostgreSQL: login, product CRUD, order
creation, the public storefront, split billing, guest checkout (browse →
cart → checkout → tracking), and tracking. Negative cases are included —
client-supplied totals are ignored server-side, duplicate `Idempotency-Key`
submissions produce one order, and tracking is phone-verified.

```bash
cd frontend
npx playwright test    # boots its own backend (:4100) + Vite (:5174)
```

**Gateway sandbox E2E.** CI boots the real backend against a local gateway
sandbox (mock SSLCommerz/Stripe/bKash with real signature math) and drives
order → payment → confirmation for all three gateways.

**Storage tier.** The S3 driver round-trips against a real MinIO instance in
CI (put → public URL → remove).

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs on pushes and pull requests
to `master`, nightly at 03:00 UTC (09:00 Dhaka — the PostgreSQL and full
matrix re-validate master daily), and manually via `workflow_dispatch`.
One live run is kept per branch/PR (`concurrency` + `cancel-in-progress`).

```mermaid
flowchart TB
    Push[Push / PR / nightly / manual] --> J1
    Push --> J2
    Push --> J3
    Push --> J4
    Push --> J5
    Push --> J6
    Push --> J7
    J1[Backend — lint, tests, coverage gate, npm audit] --> Gate{Quality gates}
    J2[Backend — PostgreSQL 16 — migrate, full suite, v1→v2 copy, boot smoke]
    J3[Security — gitleaks secret scan (full history)]
    J4[E2E — Playwright browser suite on PostgreSQL]
    J5[Gateway sandbox E2E — SSLCommerz + Stripe + bKash]
    J6[S3 driver vs MinIO]
    J7[Frontend — lint, build, npm audit]
    Gate --> Green[Green run]
```

Jobs receive **read-only** GitHub tokens by default; only the E2E report
artifact upload and CodeQL SARIF uploads get a narrow job-scoped grant.
Third-party actions are pinned to major-version tags and tracked by
Dependabot.

## Local Development

Prerequisites: Node.js **20** (`.nvmrc`), npm, and optionally Docker for the
PostgreSQL service.

Fastest path — one command from the repo root (backend `:4000` + frontend
`:5173` together, with a demo dataset):

```bash
npm install --prefix backend && npm install --prefix frontend  # first time only
npm run seed:demo          # optional: demo admin + restaurant data
npm run dev                # backend (:4000) + frontend (:5173)
```

Open http://localhost:5173. The demo seed creates `admin@oms.dev` with
password `Str0ngPass!42` (dev-only default; override with `SEED_PASSWORD`).

### Backend, step by step

```bash
cd backend
cp .env.example .env       # then set a strong JWT_SECRET (16+ chars)
npm install
npm run dev                # http://localhost:4000
```

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Provision the first admin — deliberately **not** an unauthenticated signup
endpoint:

```bash
npm run seed:admin -- --name "Admin" --email admin@example.com --password "Your-Strong-Password"
# or: SEED_PASSWORD=... npm run seed:admin -- --name Admin --email admin@example.com
```

### PostgreSQL (production database)

SQLite is the zero-config development default. To develop against the real
database:

```bash
docker compose up -d db              # PostgreSQL 16 (repo root)
# backend/.env: DB_DIALECT=postgres
#                DATABASE_URL=postgres://oms:oms@localhost:5432/oms
cd backend && npm run db:migrate && npm run db:migrate:status
npm run seed:restaurants              # optional demo workspaces
```

Migrations also run automatically at boot on both dialects. Roll back with
`npm run db:migrate:down`. A v1→v2 data copy exists for pre-V2 databases
(`npm run db:migrate:v1 -- --source <old-data.sqlite>`), and the production
cutover procedure is documented in
[`docs/04-pg-cutover-runbook.md`](docs/04-pg-cutover-runbook.md).

### Frontend, step by step

```bash
cd frontend
npm install
npm run dev                # http://localhost:5173 (proxies /api, /uploads, /ws)
```

### Root scripts

| Command | What it does |
|---|---|
| `npm run dev` | Backend + frontend dev servers together |
| `npm run seed:demo` | Demo dataset (admin + workspaces + orders) |
| `npm run db:migrate` / `db:migrate:status` | Apply / verify migrations |
| `npm run test:backend` | Full backend Vitest suite |
| `npm run test:e2e` | Playwright browser suite |

## Environment Variables

Configuration is environment-driven and validated at boot by zod — the
process refuses to start with a missing `JWT_SECRET` or a malformed value.
Never commit real values.

- Root `.env` — used by docker-compose (`JWT_SECRET`, `CORS_ORIGINS`,
  optional PostgreSQL overrides). Template: [`.env.example`](.env.example).
- `backend/.env` — the API's full surface: database, CORS, storage (local or
  S3-compatible), SMTP, payment gateways (SSLCommerz/Stripe/bKash), and
  billing webhook. Template: [`backend/.env.example`](backend/.env.example)
  (every variable documented inline).
- `frontend/.env` — optional `VITE_API_URL` (defaults to same-origin `/api`).

Key variables:

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Signs access tokens — required, ≥16 chars |
| `DB_DIALECT` / `DATABASE_URL` | `sqlite` (default) or `postgres` + connection string |
| `DB_SSL` | `1` for TLS to managed PostgreSQL |
| `CORS_ORIGINS` | Comma-separated allowed browser origins (also feeds CSRF checks) |
| `TRUST_PROXY` | `1` behind a reverse proxy (rate-limit IPs) |
| `PAYMENT_GATEWAY` | `sslcommerz` / `stripe` / `bkash` (plus per-gateway credentials) |
| `STORAGE_DRIVER` | `local` or `s3` (bucket/endpoint/CDN vars when s3) |
| `MAIL_DRIVER` | `stub` (dev) or `smtp` (SMTP_HOST/USER/PASS) |
| `APP_BASE_URL` | Public base for verification/reset email links |

## API Documentation

There is no generated OpenAPI/Swagger artifact in the repository. The API is
an Express app whose routes are grouped under `/api` — `auth`, `tenants`,
`invites`, `saml`, `products`, `menu`, `promotions`, `orders`, `payments`,
`settlements`, `webhooks`, `uploads`, `reports`, `analytics`, `dashboard`,
`tables`, `outlets`, plus public storefront routes under
`/api/public/restaurants/:slug` and health endpoints at `/health` and
`/health/ready`. Route-by-route intent is documented in source comments; the
domain behavior is pinned by the 55 backend suites. Public endpoints
(storefront menu, checkout, tracking) are described in
[`docs/05-media-import-public-menu.md`](docs/05-media-import-public-menu.md).

## Database

- **PostgreSQL 16** is the production database (docker-compose `db` service;
  managed providers supported via `DATABASE_URL` + `DB_SSL`). **SQLite** is
  the default development storage for zero-config onboarding.
- Schema is owned by **versioned migrations `001–028`**, run by a custom
  runner at boot and via `npm run db:migrate` — `sync()` is not used
  anywhere. Models are aligned to the migration DDL, and a drift test keeps
  them honest.
- Domain entities include users/refresh/auth tokens, tenants and memberships,
  plans/subscriptions/usage counters, menu (categories, items, variants,
  add-ons), inventory, promotions, orders + items + splits + edit requests,
  payments/refunds/settlements, tables, delivery zones, closures and
  availability rules, daily stats, analytics events, idempotency keys, audit
  logs, and outlets/outlet memberships/outlet menu overrides.
- Multi-tenancy is column-based (`tenant_id` on every business table, indexed
  hot queries); outlets add an `outlet_id` scope on 10 operational tables.

The authoritative schema documentation is
[`docs/03-database-schema.md`](docs/03-database-schema.md).

## Deployment

The repository ships a **Docker Compose stack** (`docker-compose.yml`) with
three services:

| Service | Image | Notes |
|---|---|---|
| `db` | `postgres:16-alpine` | Named volume, healthcheck, credentials from root `.env` |
| `backend` | `node:20-alpine` (non-root `node` user) | Runs migrations at boot; `JWT_SECRET` **required** via env; healthcheck on `/health` |
| `frontend` | multi-stage build → `nginx:alpine` | Serves the SPA, proxies `/api` `/uploads` `/ws` to the backend; CSP and cache headers set in `nginx.conf` |

```bash
cp .env.example .env       # root .env for compose secrets
docker compose up --build
```

All containers carry healthchecks; the backend waits for a healthy database
before starting. There is no managed-cloud or Kubernetes configuration in the
repository — the PostgreSQL cutover runbook (`docs/04-pg-cutover-runbook.md`)
and the production security checklist (`SECURITY.md`) cover what a production
host must add (TLS termination, managed PostgreSQL with SSL, S3/CDN storage,
live gateway and SMTP credentials).

## Screenshots

Live captures from the running app (light/dark and the paper theme). The full
gallery lives in [`docs/screenshots/`](docs/screenshots/); re-capture anytime
with `cd frontend && node scripts/screenshots.mjs` while the dev servers run.

| | |
|---|---|
| **Storefront** — public menu with availability | **Guest checkout** — the order ticket |
| ![Public menu](docs/screenshots/public-menu-ticket-light.png) | ![Checkout](docs/screenshots/checkout-light.png) |
| **Merchant dashboard** — live queue, charts | **Orders** — split/refund/invoice actions |
| ![Dashboard](docs/screenshots/dashboard-light.png) | ![Orders](docs/screenshots/orders-phase6-light.png) |
| **Settings — security & team** (lockout, sessions, audit, permissions) | **Analytics** — merchant + platform views |
| ![Auth hardening settings](docs/screenshots/auth-hardening-settings.png) | ![Analytics](docs/screenshots/admin-analytics-light.png) |

## Roadmap

**Completed** — the scope described in this README: foundation hardening,
auth & RBAC, multi-tenant SaaS, menu & media, ordering & fulfillment,
payments, analytics, and multi-outlet management — each delivered with
migrations, tests on SQLite **and** PostgreSQL, and a UI.

**Planned** (tracked in [`docs/02-v2-roadmap.md`](docs/02-v2-roadmap.md)):

- Platform admin console and subscription management
- Hardening: performance, observability, load testing, multi-instance
  realtime (Redis pub/sub), offline-first POS
- Production release: cutover, monitoring, go-live

## Documentation

- [`docs/01-codebase-audit.md`](docs/01-codebase-audit.md) — the original V1
  audit (59 findings with severity, impact, and remediation)
- [`docs/02-v2-roadmap.md`](docs/02-v2-roadmap.md) — target architecture,
  multi-tenancy strategy, phased roadmap
- [`docs/03-database-schema.md`](docs/03-database-schema.md) — the
  multi-tenant schema, migration system, and v1→v2 data migration plan
- [`docs/04-pg-cutover-runbook.md`](docs/04-pg-cutover-runbook.md) —
  SQLite → PostgreSQL production cutover runbook
- [`docs/05-media-import-public-menu.md`](docs/05-media-import-public-menu.md) —
  image pipeline, bulk import, public menu API
- [`docs/06-design-system.md`](docs/06-design-system.md) — design tokens,
  theming, and the component system
- [`docs/07-analytics.md`](docs/07-analytics.md) — analytics filters, funnel,
  rider SLA, anomaly alerts, CSV export
- [`docs/08-development-plan.md`](docs/08-development-plan.md) — role-based ongoing development plan: verified current-state snapshot, 90-day sequence, role-by-role next steps, and the per-PR definition of done

## Contributing

Outside contributions are currently by invitation only. For invited
contributors:

1. Branch from `master` — never commit to it directly.
2. Match existing conventions (ESLint configs, `docs/` updates for new
   behavior, migrations for schema changes).
3. Run the quality gates before opening a PR:
   - `cd backend && npm run lint && npm test`
   - `cd frontend && npm run lint && npm run build`
4. CI runs seven jobs on every PR (including the PostgreSQL tier and the
   secret scan) — all must pass. Coverage is enforced by thresholds in
   `backend/vitest.config.js`.
5. Never commit `.env` files, databases, or real credentials; template new
   configuration in the appropriate `.env.example`.

## Security

See [SECURITY.md](SECURITY.md) for the full security policy: threat model,
authentication and authorization controls, tenant isolation, payment/webhook
security, secrets management, CI/CD hardening, and the vulnerability
reporting process.

## License

**All rights reserved.** The repository carries no license file, so no rights
to copy, modify, or redistribute are granted — this project is not open
source.

## Author

Maintained by the Orderly development team. Repository owner:
[SadManFahIm](https://github.com/SadManFahIm).
