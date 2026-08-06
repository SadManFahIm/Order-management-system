# Order Management System — V1 Codebase Audit

**Audit date:** 2026-08-07
**Audited by:** Engineering leadership team (CTO / Solution Architect / Dev / QA / DevOps)
**Scope:** Entire monorepo (`backend/`, `frontend/`, `docker-compose.yml`, git history, live SQLite database)
**Current state:** Single-tenant CRUD reference app (README self-describes it as a *"reference implementation for the home task"*)

---

## 1. Executive Summary

The project is a **small, well-structured prototype** — the layering (models → routes → utils) and the promotion engine are genuinely decent for a demo. However it is **not production-ready in any dimension**:

| Dimension | Verdict |
|---|---|
| Architecture | Prototype layering; no services/repos/DTOs, no DI |
| Security | **Critical gaps** — open account-creation endpoint, committed JWT secret, zero authorization, open CORS, no rate limiting |
| Database | Single SQLite file, `sync({alter:true})` in prod, FLOAT money, no migrations |
| Auth | JWT-only, 1 implicit role, no refresh/verification/reset/2FA/RBAC |
| Multi-tenancy | **None** — no restaurant/tenant concept exists |
| Tests / CI / Lint | **Zero** — no tests, no CI, no linting, no type checks |
| Dependencies | 20 backend vulns (1 critical, 13 high), 11 frontend vulns (8 high) |
| DevOps | Docker exists but bakes secrets into images; no healthchecks, monitoring, backups |
| Frontend | Functional but unstyled; inline styles, no theme/loading/error states, no data layer |

**Headline numbers**

- 🔴 **6 Critical** issues (one is a remotely-exploitable unauthenticated account-creation endpoint)
- 🟠 **27 High** issues
- 🟡 **18 Medium** issues
- 🟢 **8 Low** issues

**Bottom line:** Do not put this near production traffic. The good news: the domain logic is small and clean enough that a **phased rewrite (V2.0)** can replace it with enterprise architecture without carrying technical debt forward. Full plan in `docs/02-v2-roadmap.md`.

---

## 2. Severity & Effort Legend

| Mark | Severity |
|---|---|
| 🔴 | **Critical** — exploitable/breaking now; blocks production |
| 🟠 | **High** — serious; must be fixed in Phase 1–3 |
| 🟡 | **Medium** — should fix; meaningful risk at scale |
| 🟢 | **Low** — polish / hygiene |

**Effort:** S = ≤0.5 PD · M = 1–2 PD · L = 3–5 PD · XL = 1–3 weeks (PD = person-days)

---

## 3. Folder Structure

```
./
├── backend/            # Express API
│   ├── src/
│   │   ├── config/db.js        # Sequelize bootstrap
│   │   ├── index.js            # App entry + route mounting
│   │   ├── middleware/auth.js  # JWT verification only
│   │   ├── models/             # 6 Sequelize models
│   │   ├── routes/             # auth, products, promotions, orders
│   │   └── utils/promotionEngine.js
│   ├── .env / .env.example     # ⚠️ committed to git
│   ├── data.sqlite             # ⚠️ committed to git (customer PII)
│   ├── Dockerfile
│   └── package.json
├── frontend/          # React SPA
│   ├── src/
│   │   ├── components/         # Navbar, Cart, forms, ProtectedRoute
│   │   ├── context/AuthContext.jsx
│   │   ├── pages/              # 5 pages
│   │   ├── api.js              # axios instance (hardcoded URL)
│   │   └── main.jsx / App.jsx
│   ├── Dockerfile
│   └── vite.config.js
├── docker-compose.yml
└── README.md
```

**Findings**

| ID | Severity | Issue | Why it's a problem | Recommended solution | Effort |
|---|---|---|---|---|---|
| FS-1 | 🟡 | No feature-based structure anywhere | All logic lives in `routes/`; controllers/services/repos are absent, so business logic isn't unit-testable or reusable | Adopt layered architecture (`controllers → services → repositories → models`) and frontend feature folders (`src/features/orders`, `src/features/menu`, …) | M |
| FS-2 | 🟢 | No `docs/`, no `.github/`, no `.gitignore`, no `.editorconfig` | No place for the required architecture/ER/API docs; no ignore rules (node_modules, .env, DB are committed — see SEC-2); no repo hygiene | Create `docs/`, `.github/workflows/`, `.gitignore`, `.editorconfig`, `CONTRIBUTING.md` | S |
| FS-3 | 🟢 | Stray artifacts: root `package-lock.json` (102 B, untracked), `Orders_backup` table in DB | Indicates ad-hoc experimentation; confusion risk | Remove stray file; clean DB during migration | S |

---

## 4. Architecture

| ID | Severity | Issue | Why it's a problem | Recommended solution | Effort |
|---|---|---|---|---|---|
| AR-1 | 🟠 | **No multi-tenancy concept exists** — zero restaurant/workspace notion anywhere (no tenant_id on any table) | The entire V2 vision (hundreds of restaurants) is impossible on this schema; every table must be re-scoped | Design tenant model (Phase 3): `tenants` table, `tenant_id` on all business tables, composite indexes, middleware-driven tenant scoping | XL |
| AR-2 | 🟠 | Routes contain business logic (pricing, promotion application, discount math inline in `orders.js`) | Business rules cannot be unit-tested or reused; changes risk the whole handler | Extract services (`OrderService`, `MenuService`, `PromotionService`) + repository layer; keep routes thin | M |
| AR-3 | 🟠 | **No dependency injection / composition root**; every module imports the global `sequelize` singleton | Hard to swap DB, mock in tests, or add a second data source (cache, queue) | Introduce a simple DI container or factory functions; inject `db`, `cache`, `logger` into services | M |
| AR-4 | 🟡 | Single Express app file does everything (middleware, routes, startup, health) | No room for feature flags, health/readiness separation, or worker processes | Split `app.js` (config+middleware) from `server.js` (listen) from `workers/` (jobs) | M |
| AR-5 | 🟡 | Monolith-by-accident, not monolith-by-design | No seam for async jobs (order confirmations, emails, payments) | Introduce a job queue (BullMQ/Redis) from Phase 5; keep monolith modular | L |
| AR-6 | 🟢 | Backend `GET /` health endpoint doesn't check DB | Orchestrators see "up" while DB is down | `/health/live` + `/health/ready` with DB (and later Redis) checks | S |

---

## 5. Dependencies (npm audit — verified live)

**Backend: 20 vulnerabilities — 1 critical, 13 high, 4 moderate, 2 low**

| ID | Severity | Package | Issue | Recommended solution | Effort |
|---|---|---|---|---|---|
| DP-1 | 🔴 | `tar` (via sqlite3 build chain) | Arbitrary file write/overwrite, symlink poisoning (GHSA-8qq5-rm4j-mr97 et al.) | `npm audit fix --force` upgrades `sqlite3` → 6.x; or replace sqlite3 driver in Phase 1 DB move | M |
| DP-2 | 🟠 | `sequelize` 6.37 | SQL injection via JSON column cast type (GHSA-6457-6jrx-69cr); also depends on vulnerable `uuid` | Upgrade sequelize to patched 6.x (or migrate to a typed alternative); bump `uuid` | S |
| DP-3 | 🟠 | `express` 4.21 / `path-to-regexp` <0.1.13 | ReDoS via multiple route parameters — **directly affects this app's routes** | `npm audit fix` (express 4.22.x); consider Express 5 for V2 | S |
| DP-4 | 🟠 | `jws` <3.2.3 | Improperly verifies HMAC signature | Fix via jsonwebtoken upgrade (`npm audit fix`) | S |
| DP-5 | 🟠 | `minimatch` / `picomatch` / `brace-expansion` | ReDoS / DoS (dev-chain and transitive) | `npm audit fix`; pin non-vulnerable ranges | S |
| DP-6 | 🟡 | `qs`, `body-parser` | DoS via arrayLimit bypass; invalid limit disables body size enforcement | Upgrade to patched versions | S |
| DP-7 | 🟡 | `dottie`, `ip-address`, `uuid` | Prototype pollution / XSS / SSRF in transitive deps | Audit fix + dependency review policy | S |
| DP-8 | 🟠 | **No lockfile pinning discipline for prod** | `npm install` in Docker pulls floating ranges → supply-chain drift | Use `package-lock.json` with `npm ci` in CI/Docker; add `npm audit` to CI | S |

**Frontend: 11 vulnerabilities — 8 high, 2 moderate, 1 low**

| ID | Severity | Package | Issue | Recommended solution | Effort |
|---|---|---|---|---|---|
| DP-9 | 🟠 | `react-router-dom` 6.28 / `@remix-run/router` | XSS via open redirect + protocol-relative redirect reinterpretation | Upgrade to patched 6.x/7.x; sanitize redirect targets in code | S |
| DP-10 | 🟠 | `axios` 1.7.9 | Chain of SSRF / prototype-pollution / header-injection advisories (many GHSA entries) | Upgrade axios ≥ 1.18 (patched line); re-run audit; consider fetch-based client | S |
| DP-11 | 🟠 | `@babel/core` ≤7.29 (dev) | Arbitrary file read via sourceMappingURL | `npm audit fix` (dev-only, but still) | S |

**Stack-level findings**

| ID | Severity | Issue | Why it's a problem | Recommended solution | Effort |
|---|---|---|---|---|---|
| DP-12 | 🟠 | **SQLite + `sqlite3` 5.x** | Single-file DB: write-lock contention, no concurrent writes, no row-level locking, weak operational tooling; native module requires node-gyp/tar (the vulnerability source) | Move to **PostgreSQL 16** (row-level locking, JSONB, extensions) in Phase 1; keep Sequelize to soften migration | XL |
| DP-13 | 🟡 | Local Node v26 vs Docker `node:20-alpine` | Behavioral drift between dev and prod (V8, stdlib, ESM) | `.nvmrc` / `.node-version` pinning + CI on the same major as prod | S |
| DP-14 | 🟡 | No Redis / cache / queue in stack | Cannot implement rate limiting (in-memory only), caching, pub/sub, or background jobs at scale | Add Redis in Phase 1–2 (rate limit + cache), BullMQ later | M |

---

## 6. Backend

| ID | Severity | Issue | Why it's a problem | Recommended solution | Effort |
|---|---|---|---|---|---|
| BE-1 | 🔴 | `POST /api/auth/seed-admin` is **unauthenticated and unguarded** — anyone can create an account (with any password) | Total account-takeover vector: attacker creates their own user, logs in, and gets full access (there is no authorization — see SEC-5) | Delete the endpoint; replace with a **CLI seed script** (`npm run seed:admin`) gated by env flag in non-prod only | S |
| BE-2 | 🟠 | No error-handling middleware; several GET handlers have **no try/catch** | In Express 4, async rejections are not caught → unhandled rejection, potential process crash or hung request | Global error middleware + asyncHandler wrapper + process-level guards; structured error responses | M |
| BE-3 | 🟠 | **No input validation** anywhere (no zod/joi/celebrate; Sequelize errors leak to clients as raw messages) | Invalid payloads → 400 with internal detail; mass-assignment; bad data in DB | Validate every request DTO (zod); central error mapper; never surface ORM errors verbatim | L |
| BE-4 | 🟠 | No pagination/filtering/sorting; routes call `findAll()` | At 10k+ rows the API returns entire tables → memory blowup, slow clients, no UX for large menus | Standard `page/size/sort/filter` contract + Sequelize `limit/offset` + indexes | M |
| BE-5 | 🟠 | **Money as FLOAT**, weights as INTEGER | IEEE-754 rounding breaks invoices (`0.1+0.2`); no currency/unit modeling | DECIMAL(12,2) (or integer paisa) for money; unit table; keep weight integer grams | M |
| BE-6 | 🟠 | **`sequelize.sync({ alter: true })`** at startup | Auto-ALTER on every boot: can lock/drop/rename columns destructively in prod (an `Orders_backup` table already proves it ran); no versioned schema control | **Migrations** (sequelize-cli or better: node-pg-migrate / drizzle-kit) from Phase 1; `sync` only in dev | L |
| BE-7 | 🟡 | Promotion date check uses `new Date('YYYY-MM-DD')` (UTC midnight) vs `new Date()` (local) | Off-by-one-day window for Dhaka (+06:00) — promotions start/end a day early | Store timestamps with TZ or compare date-only strings; test around midnight | S |
| BE-8 | 🟡 | Promotions are **global** — apply to all products with no scoping, no caps, no stacking rules | A promo can discount items it shouldn't; no per-restaurant promos in V2 | Scope promos to tenant + optional product/category; add max-discount caps and stacking policy | M |
| BE-9 | 🟡 | Order creation: multiple round-trips (products → promos → create → re-fetch) | N+1-ish; latency and inconsistency window (price changes between fetch and write) | Wrap in a transaction; snapshot prices from a single read; optimistic-lock version where needed | M |
| BE-10 | 🟡 | No audit fields (who created/updated), no soft delete, no optimistic locking | Cannot answer "who changed this" or safely archive; concurrent edits silently overwrite | `created_by/updated_by`, `deleted_at` (soft delete), `version` column with conditional updates | M |
| BE-11 | 🟡 | No request logging / structured logging; only `console.log` | No observability: can't trace a failing order, no request IDs | pino + request-id middleware + JSON logs + log correlation | M |
| BE-12 | 🟡 | No rate limiting | Brute-force login, abuse of unauthenticated endpoints, scraping | `express-rate-limit` (in-memory now, Redis later) on `/auth/*`, per-user limits on orders | S |
| BE-13 | 🟢 | JWT secret read without validation; no startup config validation | Misconfig fails silently at runtime (undefined secret → jwt errors at first login) | Central `config.js` with env validation (zod), fail-fast on boot | S |

---

## 7. Frontend

| ID | Severity | Issue | Why it's a problem | Recommended solution | Effort |
|---|---|---|---|---|---|
| FE-1 | 🟠 | **No UI system** — every component has inline styles; no theme, no dark mode, no design tokens | Cannot deliver the Stripe/Linear-grade UI; light/dark impossible without refactor | Design-token system (CSS variables) + shared UI library (Button, Card, Input, Table, Modal, Toast, Skeleton) | L |
| FE-2 | 🟠 | No loading/empty/error states; pages assume `res.data` exists; `alert()` for feedback | White screens on slow/failed requests; no skeleton loading; poor UX (explicitly required in V2) | Loading skeletons, error boundaries, toast system, `useAsync`-style hooks, React Query for server state | M |
| FE-3 | 🟠 | No client-side validation on forms | Bad input reaches server; no inline field errors | zod + form library (react-hook-form); inline errors, disabled submit on invalid | M |
| FE-4 | 🟠 | `api.js` hardcodes `http://localhost:4000/api` | Breaks in any env other than local dev; no Vite proxy; no env-based config | `import.meta.env.VITE_API_URL` + Vite dev proxy; relative API path in prod (same origin) | S |
| FE-5 | 🟠 | No global state beyond auth context; no server-state layer | Cart/restaurant/order state will be unmanageable as features grow | Zustand/Redux Toolkit for client state + TanStack Query for server state; optimistic UI hooks | M |
| FE-6 | 🟡 | No code splitting / lazy loading | Single bundle grows with dozens of pages; first paint suffers | `React.lazy` + route-based splitting; dynamic import of charts (heavy libs) | M |
| FE-7 | 🟡 | No accessibility work: focus management, aria labels, keyboard nav, contrast | Required by V2 spec; currently tab order is accidental | a11y audit per component; focus rings, aria patterns, `prefers-reduced-motion` | M |
| FE-8 | 🟡 | No error boundaries | One render error blanks the entire SPA | Error boundaries at route + page level with friendly fallback | S |
| FE-9 | 🟢 | Mixed naming: snake_case API fields consumed directly in JSX | Typo-prone, no type safety | API layer mapping to typed domain models (or TS) | M |
| FE-10 | 🟢 | No image handling at all | V2 requires premium food imagery, lazy loading, CDN | `Image` component with lazy loading + blur-up placeholder; CDN URL builder | M |

---

## 8. Database

Live schema (verified from `backend/data.sqlite`): `Users`, `Products`, `Promotions`, `PromotionSlabs`, `Orders`, `OrderItems` (+ stray `Orders_backup`).

| ID | Severity | Issue | Why it's a problem | Recommended solution | Effort |
|---|---|---|---|---|---|
| DB-1 | 🔴 | **Production data committed to git** — `backend/data.sqlite` contains customer names, phones, addresses | PII leak in the repository history, forever | Remove from git + history rewrite (or at minimum purge going forward); move data to managed Postgres; `.gitignore` the DB | M |
| DB-2 | 🟠 | No `restaurant_id`/`tenant_id` on any table | Every table must be re-scoped for multi-tenancy; impossible to serve 2+ restaurants | V2 schema with `tenants` + tenant FK on all business tables + composite tenant indexes | XL |
| DB-3 | 🟠 | No indexes beyond PKs (and email unique) | Queries degrade linearly: order listing by customer, order-by-tenant, product search all full scans | Index `tenant_id`, `(tenant_id, status)`, `order.customer_phone`, `order.created_at`, `product.name` (or FTS) | M |
| DB-4 | 🟠 | No FK constraints in some paths; `ON DELETE SET NULL` on product_id | Orphaned/ambiguous references; **order history loses product identity when a product is deleted** | Keep `product_id` + snapshot product name/price on the item; restrict deletes, use soft-delete instead | M |
| DB-5 | 🟠 | No CHECK constraints, no default enforcement at DB layer | App-only validation means bad data can arrive via any code path | CHECKs (qty > 0, price ≥ 0, dates valid), NOT NULL everywhere meaningful | M |
| DB-6 | 🟠 | Money as FLOAT (see BE-5); no `status`/timeline on Orders | No kitchen workflow possible — an order has no lifecycle | `status` enum + `status_history`/timeline table in V2 | M |
| DB-7 | 🟡 | No audit columns, no soft-delete, no versioning (see BE-10) | Operational and compliance gaps | Add in Phase 1 schema design | M |
| DB-8 | 🟡 | DATEONLY strings + local-vs-UTC compare (see BE-7) | Timezone bugs for Dhaka operators | Store `timestamptz`; compare with explicit TZ | S |
| DB-9 | 🟡 | SQLite can't run `VACUUM`/hot backup while serving; no backup story | Data loss risk: single file, no automated backups | Postgres + `pg_dump` cron/volume snapshots + restore drill (Phase 9) | M |

---

## 9. APIs

| ID | Severity | Issue | Why it's a problem | Recommended solution | Effort |
|---|---|---|---|---|---|
| API-1 | 🟠 | No OpenAPI/Swagger documentation | Consumers (frontend team, partner integrations) can't self-serve; no contract to test against | OpenAPI 3 spec (generate from zod schemas) + Swagger UI in dev/staging | M |
| API-2 | 🟠 | No consistent error contract (`{message}` strings only; Sequelize errors leak raw) | Clients can't programmatically handle errors; internal details exposed | `{ error: { code, message, details?, requestId } }` envelope + error catalog | M |
| API-3 | 🟠 | No pagination/filtering/sort contract (see BE-4) | Unusable at scale | Standard query contract; document in OpenAPI | M |
| API-4 | 🟡 | No versioning strategy | Breaking changes will break the (future) customer storefront and mobile apps | `/api/v1/…` prefix from V2 start; keep v1 routes working during migration | S |
| API-5 | 🟡 | No idempotency for order creation | Double-click / retry duplicates an order (and future payment charge!) | `Idempotency-Key` header on POST /orders (+ payments in Phase 6) | M |
| API-6 | 🟡 | Response payloads unshaped — raw ORM objects with internal columns | Over-fetching, leaking fields; no DTO layer | Serialize via DTO mappers; never return model instances directly | M |
| API-7 | 🟢 | No ETag/conditional requests | No cache validation for GET menus/products | ETags / cache-control headers on public GET endpoints (Phase 7) | S |

---

## 10. Authentication & Authorization

| ID | Severity | Issue | Why it's a problem | Recommended solution | Effort |
|---|---|---|---|---|---|
| AU-1 | 🔴 | **Single implicit role — every user is omnipotent** | No authorization anywhere: any logged-in user can create/edit/delete everything (only "delete" is missing by accident); no RBAC exists to build on | RBAC model: `roles` (admin, owner, manager, cashier, kitchen, delivery, customer), `permissions`, `requireRole`/`requirePermission` middleware | L |
| AU-2 | 🔴 | Open account-creation endpoint (see BE-1) | Combined with AU-1 = anyone becomes full admin | Remove endpoint; CLI/seed-based provisioning | S |
| AU-3 | 🔴 | **JWT secret committed** (`backend/.env` = `supersecretjwt`, duplicated in `docker-compose.yml`) | Anyone with repo access can forge valid tokens for any user | Rotate secret, move to env/secrets manager, never commit; add `.gitignore` + secret scanning (gitleaks) in CI | S |
| AU-4 | 🟠 | JWT stored in `localStorage`; read by any XSS; no refresh tokens | Token theft = full account takeover; 8h token can't be revoked (stateless) | **Refresh-token rotation** (httpOnly+Secure cookie or hashed refresh row), short-lived access token, session management + revocation | L |
| AU-5 | 🟠 | No rate limiting on `/login` (see BE-12) | Unlimited credential brute-forcing | Per-IP + per-account throttling with lockout backoff | S |
| AU-6 | 🟠 | No email verification, no password reset, no 2FA | Standard SaaS account-security features missing entirely | Verify-on-signup, reset tokens (short-lived, single-use), optional TOTP 2FA | L |
| AU-7 | 🟡 | No tenant scoping on auth: a user's token doesn't bind to a workspace | In V2 a user belongs to restaurants with roles per tenant | Multi-workspace claims (`tenant_id`, `role`), tenant-switch endpoint, middleware enforces scope on every request | L |
| AU-8 | 🟡 | Password policy not enforced (README seeds `123456`) | Weak credentials | Min-length + strength validation; reject common passwords; hashing already good (bcryptjs, 10 rounds) but move to `argon2` for V2 | S |

---

## 11. Code Quality

| ID | Severity | Issue | Why it's a problem | Recommended solution | Effort |
|---|---|---|---|---|---|
| CQ-1 | 🟠 | **Zero tests** (no unit/integration/e2e at all) | No regression safety for any refactor — the single biggest blocker to the V2 rewrite | Vitest (unit) + supertest (API integration) + Playwright (e2e) from Phase 1; CI gates on coverage | XL |
| CQ-2 | 🟠 | No ESLint/Prettier config | No style/quality enforcement; drift inevitable | ESLint (flat config) + Prettier + hooks/pre-commit; include in CI | S |
| CQ-3 | 🟡 | No TypeScript | 9 of 10 V2 risks (typos on snake_case fields, DTO contracts, refactors) disappear with types | Adopt TS incrementally: new backend modules in TS first; frontend too. Alternative: keep JS + zod schemas + JSDoc types | L |
| CQ-4 | 🟡 | Business logic untestable inside route handlers (see AR-2) | Same | Extract services | M |
| CQ-5 | 🟢 | No consistent naming conventions (snake_case columns, camelCase JS mixing) | Readability cost; easy to leak to API responses | One convention per layer; DTOs translate | S |
| CQ-6 | 🟢 | No code review/PR conventions documented | Team onboarding cost | CONTRIBUTING.md + PR template + branch strategy (GitHub Flow) | S |

---

## 12. Scalability

| ID | Severity | Issue | Why it's a problem | Recommended solution | Effort |
|---|---|---|---|---|---|
| SC-1 | 🔴 | SQLite single-writer | Cannot serve concurrent tenants; write lock contention at >1 restaurant | Postgres + connection pool (`pg` pool) in Phase 1 | XL |
| SC-2 | 🟠 | Unbounded `findAll()` (see BE-4) | Memory/response blowup; no way to handle 100k orders | Pagination + keyset cursor for orders | M |
| SC-3 | 🟠 | No caching layer | Every menu request hits DB; hot menus under load | Redis cache (menus, product catalog, session metadata) with invalidation on writes | M |
| SC-4 | 🟡 | Synchronous everything — no queues | Email confirmations, SMS, push, invoice generation would block request handlers | BullMQ workers for notifications, invoices, exports | L |
| SC-5 | 🟡 | No horizontal scaling story (no statelessness plan, no shared session) | Node processes can't scale out today | Stateless API (Redis-backed sessions/rate-limit), load balancer, health checks | M |
| SC-6 | 🟡 | No CDN/static asset strategy; no image pipeline | Image-heavy food catalog will crush the origin server | S3-compatible storage + CDN + image resizing (sharp) + signed upload URLs | L |
| SC-7 | 🟢 | No connection pooling / keep-alive tuning | Startup latency, dropped connections at load | Pool config, `server.timeout`, keep-alive settings | S |

---

## 13. Security (OWASP mapping)

| ID | Severity | Control | Issue | Why it's a problem | Recommended solution | Effort |
|---|---|---|---|---|---|---|
| SEC-1 | 🔴 | Broken Access Control (A1) | No authorization; anyone authenticated = everything (AU-1) | Total compromise of all tenants | RBAC + tenant-scoped middleware (Phase 2–3) | L |
| SEC-2 | 🔴 | Sensitive Data Exposure (A2) | `.env` (JWT secret) + `data.sqlite` (PII) committed to git; no `.gitignore` | Credential + PII leak in history; secret cannot be "uncommitted" | Purge from history, rotate secret, gitignore, secret scanning in CI | M |
| SEC-3 | 🔴 | Security Misconfiguration (A5) | **CORS wide open** (`app.use(cors())`), no helmet/secure headers, no CSP | Any origin can call API with stolen bearer token; clickjacking; XSS amplification | Restrict CORS to known origins; helmet; strict CSP; HSTS behind TLS | S |
| SEC-4 | 🟠 | Identification & Auth Failures (A7) | Open account creation, brute-forceable login, no lockout (BE-1, AU-5) | Account abuse | Remove open endpoint; rate limit; lockout | M |
| SEC-5 | 🟠 | Injection (A3) | Sequelize is parameterized (good), but the **sequelize 6.37 JSON-cast SQLi advisory applies** (DP-2); raw error leakage aids recon | Potential SQLi path | Upgrade; never interpolate user input; zod validation before ORM | M |
| SEC-6 | 🟠 | XSS (A3) | React escapes by default (good) but **no CSP**, and localStorage JWT is XSS-stealable (AU-4) | Token theft via any XSS | CSP headers, token in httpOnly cookie (refresh) or hardened storage, sanitize `dangerouslySetInnerHTML` (none used today — keep it that way) | M |
| SEC-7 | 🟡 | Security Logging & Monitoring Failures (A9) | No audit log, no failed-login tracking, no structured logs | Cannot detect or investigate breaches | Audit log table + login events + alerting (Phase 8) | M |
| SEC-8 | 🟡 | SSRF (A10) | Frontend axios advisories include SSRF/prototype-pollution chains (DP-10); backend has no outbound request surface today but will (webhooks, image fetch) | Future risk | Upgrade axios; validate/allowlist outbound URLs; no user-controlled hosts in fetch | S |
| SEC-9 | 🟡 | CSRF (A1) | Bearer-token model is CSRF-resistant today, but **V2 refresh-token cookies will be CSRF-able** | Plan for it now | SameSite=Strict/Lax cookies + CSRF tokens where cookies are used; never accept token from query string | S |
| SEC-10 | 🟢 | Cryptographic failures | bcryptjs ok; no encryption-at-rest for sensitive columns (phone, address) | Compliance (PII) | Encrypt PII columns at rest (app-level) or rely on DB encryption; least-privilege DB users | M |
| SEC-11 | 🟢 | Insecure Docker config | Backend image runs as root; `COPY .env.example ./.env` **bakes a secret file into the image**; no non-root user | Secret in image layers; container breakout risk | Never bake .env; env from compose/secrets at runtime; non-root user; read-only FS | S |
| SEC-12 | 🟢 | Dependency supply chain | No `npm audit` gate, no lockfile `npm ci`, floating ranges (DP-8) | Vulnerable code ships silently | CI gates on `npm audit --audit-level=high`; Dependabot/Renovate | S |

---

## 14. Performance

| ID | Severity | Issue | Why it's a problem | Recommended solution | Effort |
|---|---|---|---|---|---|
| PF-1 | 🟠 | Unpaginated queries + no indexes (BE-4, DB-3) | Degrades linearly | Pagination + indexes + `EXPLAIN ANALYZE` discipline | M |
| PF-2 | 🟠 | N+1 fetch pattern in order creation (BE-9) | Latency per order | Single transaction, batch reads | M |
| PF-3 | 🟡 | No caching (SC-3) | Repeated DB hits for identical public data | Redis cache + CDN cache headers | M |
| PF-4 | 🟡 | No image pipeline (SC-6) | Food images unoptimized → slow storefront | sharp resizing + AVIF/WebP + lazy loading + CDN | L |
| PF-5 | 🟡 | No bundle splitting (FE-6) | Frontend bundle grows unbounded | Route-level code splitting; charts loaded lazily | M |
| PF-6 | 🟢 | No compression middleware on API responses | JSON payloads uncompressed | `compression` middleware; HTTP/2 behind reverse proxy | S |

---

## 15. Maintainability

| ID | Severity | Issue | Why it's a problem | Recommended solution | Effort |
|---|---|---|---|---|---|
| MT-1 | 🟠 | No migrations (BE-6) | Schema drift between dev/prod; the `sync({alter:true})` trap | Versioned migrations from Phase 1 | L |
| MT-2 | 🟠 | No CI/CD (no `.github/workflows`) | Every deploy is manual and unreviewed | GitHub Actions: lint → test → build → docker push → deploy (staging/prod) | L |
| MT-3 | 🟡 | No monitoring/alerting; no structured logs (BE-11) | Blind in production | pino + Grafana/Loki or hosted (Sentry for errors), uptime + DB metrics | M |
| MT-4 | 🟡 | No feature flags | Can't ship safely | Feature-flag module (DB-backed, admin-managed) in Phase 8 | M |
| MT-5 | 🟡 | No documentation (only README) | Required docs (architecture, ER, API, setup, deployment, admin, developer) don't exist | Write docs alongside each phase (see roadmap) | M |
| MT-6 | 🟢 | README hardcodes credentials (`admin@test.com` / `123456`) | Encourages weak credentials; reveals seed flow | Remove credentials from README; document provisioning script | S |

---

## 16. DevOps

| ID | Severity | Issue | Why it's a problem | Recommended solution | Effort |
|---|---|---|---|---|---|
| DV-1 | 🟠 | Backend Dockerfile bakes `.env.example` → `.env` into image | Secret in image layers (SEC-11) | Remove; runtime env only | S |
| DV-2 | 🟠 | No healthchecks in compose/images | Orchestrators can't route around unhealthy instances | HEALTHCHECK (curl to `/health/ready`) in both images + compose `healthcheck:` | S |
| DV-3 | 🟠 | No non-root user in images | Container escape risk | `USER node` + read-only rootfs where possible | S |
| DV-4 | 🟡 | No reverse proxy / TLS termination in compose | No HTTPS story for production | nginx/traefik/caddy in front; TLS via Let's Encrypt | M |
| DV-5 | 🟡 | No backup strategy for SQLite volume | Silent data loss | Postgres + automated pg_dump + point-in-time strategy + restore drill | M |
| DV-6 | 🟡 | No staging environment, no env strategy | Config drift; prod surprises | `dev/staging/prod` env files + `.env.production.example`; secrets manager | M |
| DV-7 | 🟡 | No monitoring stack (MT-3) | Blind deploys | Uptime checks, Sentry, Grafana dashboards | M |
| DV-8 | 🟢 | No .dockerignore (build context includes node_modules + DB + .git) | Slow builds; secret/DB leak risk into build context | Add `.dockerignore` for both services | S |
| DV-9 | 🟢 | `version: "3.9"` legacy compose; single-file config | Hard to extend for DB/Redis/workers | Compose with `postgres`, `redis`, `worker` services (V2) | S |

---

## 17. What's Actually Good (keep these)

Balanced engineering requires acknowledging what works:

- ✅ **Promotion engine is cleanly extracted** and unit-testable in principle — good seed for `PromotionService`.
- ✅ **Sequelize models are simple and consistent**; the domain is small enough to migrate cleanly.
- ✅ **bcrypt hashing** (10 rounds) for passwords; generic 401 on bad login (no user enumeration).
- ✅ **Sequelize parameterized queries** by default (no raw SQL string concatenation found).
- ✅ **React Router + ProtectedRoute pattern** is the right shape to build on.
- ✅ **Docker multi-stage frontend build** is correct in principle.
- ✅ No `dangerouslySetInnerHTML`, no `eval`, no obvious XSS sinks in the frontend.

---

## 18. Prioritized Fix Order (immediate → V2)

1. **Today (hotfixes, keep current app working):** remove/guard `seed-admin`, rotate JWT secret, gitignore + purge secrets/DB from history, `npm audit fix`, restrict CORS, add helmet + rate limiting, try/catch on GET routes. *(Effort: ~2–3 PD)*
2. **Phase 1 (Foundation):** Postgres + migrations, repo hygiene, lint/format, test harness, CI, docker security fixes. *(1–2 weeks)*
3. **Phase 2 (Auth & RBAC):** roles, refresh tokens, verification/reset, tenant scoping. *(2–3 weeks)*
4. Then proceed through the phases in `docs/02-v2-roadmap.md`.

---

*Generated from live inspection: all source files read, DB schema dumped from `data.sqlite`, `npm audit` run against both packages, git history and tracked files examined.*
