# Order Management System

> A production-ready **Restaurant SaaS Platform** — multi-tenant ordering, menus, orders, and analytics for hundreds of restaurants.

![CI](https://github.com/SadManFahIm/Order-management-system/actions/workflows/ci.yml/badge.svg)

The Order Management System is evolving from a single-tenant order CRUD app into a commercial, cloud-based **restaurant ordering SaaS** for the Dhaka market (KFC, Pizza Hut, Domino's, Chillox, Sultan's Dine, Star Kabab, Madchef, and hundreds more — all data-driven, never hard-coded). This repository is the **V2 foundation**: security hardening, engineering tooling, testing, and CI/CD — built incrementally on the existing, working v1 features.

---

## ✨ Features

### Currently working
- **Authentication & RBAC (Phase 2)** — register / login / verify-email / password-reset flows · rotating refresh tokens (httpOnly, SameSite cookie) with **session revocation + reuse detection** · optional **TOTP 2FA** · role-based access control (`platform_admin`, `owner`, `manager`, `cashier`, `kitchen`, `delivery`, `customer`) with permission-gated routes · tenant-scoping middleware · auth audit logging
- **Session management** — short-lived access JWT + revocable refresh sessions; `GET /api/auth/me` session validation
- **Product management** — create, edit, enable/disable, paginated listing
- **Promotion engine** — percentage, fixed, and weighted (slab-based) promotions with best-discount selection
- **Order management** — server-side pricing with per-item discount, subtotal, discount, and grand total
- **Security hardening** — Helmet security headers, CORS allowlist, rate limiting, centralized error handling, validated payloads (zod), no secrets in code

### Roadmap (V2)
Multi-tenant workspaces · RBAC (owner/manager/cashier/kitchen/delivery) · rich menu management (categories, variants, add-ons, allergens, images) · customer storefront & ordering · kitchen workflow & live order tracking · payments (SSLCommerz, bKash, Nagad, Stripe) · analytics dashboards · SaaS admin portal · subscriptions & feature flags.

> Full audit and phased roadmap: [`docs/01-codebase-audit.md`](docs/01-codebase-audit.md) · [`docs/02-v2-roadmap.md`](docs/02-v2-roadmap.md)

---

## 🧱 Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20 · Express · Sequelize · SQLite (dev) → PostgreSQL (V2) · JWT · zod |
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
│   │   ├── routes/           # auth, products, promotions, orders
│   │   ├── services/         # auth service, audit service, email adapter
│   │   ├── validators/       # zod request schemas
│   │   ├── utils/            # promotion engine, pagination
│   │   ├── test/             # Test environment setup
│   │   └── __tests__/        # Unit + integration tests
│   ├── scripts/              # CLI utilities (seed-admin)
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

- Backend: http://localhost:4000 · Frontend: http://localhost:5173
- The frontend's nginx proxies `/api` to the backend — no CORS issues in production.
- Containers include healthchecks; `JWT_SECRET` is **required** via the root `.env` (never hard-coded).

---

## ⚙️ Configuration

| Variable | Where | Purpose |
|---|---|---|
| `JWT_SECRET` | backend `.env` / root `.env` | Signs access tokens (min 16 chars — **never commit real values**) |
| `PORT` | backend `.env` | API port (default 4000) |
| `DB_STORAGE` | backend `.env` | SQLite file path (dev) |
| `CORS_ORIGINS` | backend `.env` | Comma-separated allowed browser origins |
| `NODE_ENV` | backend `.env` | `development` / `test` / `production` |
| `TRUST_PROXY` | backend `.env` | Set `1` behind a reverse proxy |
| `APP_BASE_URL` | backend `.env` | Public app URL used to build verification/reset links |
| `VITE_API_URL` | frontend `.env` | Custom API base URL (defaults to same-origin `/api`) |

---

## 🧪 Testing & Quality

```bash
cd backend
npm test                      # Vitest — 53 unit + integration tests
npm run test:coverage         # with coverage report
npm run lint                  # ESLint

cd frontend
npm run lint                  # ESLint
npm run build                 # production build
```

The test suite covers the promotion engine (all discount types, date windows, best-discount selection), the full auth lifecycle (register, verify, login, refresh rotation + reuse detection, logout, password reset), TOTP 2FA setup/verify/disable, RBAC + tenant isolation, and API integration (order creation with promotions, validation errors, security regressions).

---

## 🔄 CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs on every push/PR to `master`:

- **Backend:** `npm ci` → lint → test → `npm audit --audit-level=high`
- **Frontend:** `npm ci` → lint → build → `npm audit` (informational — see workflow comment)

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
| 1 | Foundation: security, tooling, tests, CI | ✅ Done |
| 2 | Authentication & RBAC (roles, refresh tokens, 2FA) | ✅ Done |
| 3 | Multi-tenant restaurant management | ⏳ Next |
| 4 | Rich menu management + image pipeline | ⬜ |
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

---

## 🤝 Contributing

1. Fork the repo and create a feature branch from `master`
2. Run `npm run lint` and `npm test` (backend) before pushing
3. Open a pull request — CI must pass

---

## 📄 License

Private / internal — all rights reserved.
