# Security Policy

This document describes the security posture of the **Order Management
System** ("Orderly") — a multi-tenant restaurant ordering and management
SaaS platform — and how security issues are handled.

Scope: everything in this repository (`backend/`, `frontend/`, deployment
configuration under `docker-compose.yml`, and the GitHub Actions workflows in
`.github/`).

---

## 1. Security Overview

Security is treated as an engineering discipline in this codebase, not an
afterthought:

- **Fail-closed multi-tenant isolation** — every business-data route resolves a
  workspace membership from the database and rejects anything else.
- **Defense in depth on identity** — bcrypt password hashing, per-account login
  lockout, rotating refresh-token families with reuse detection, TOTP 2FA,
  single-use verification/reset tokens, and an immutable audit trail.
- **Least privilege by default** — a permission-level RBAC catalogue under the
  role matrix, per-user permission flags (grant *and* deny), and read-only
  GitHub Actions tokens.
- **Server-side trust** — payment webhooks are signature-verified, checkout is
  re-priced and availability-checked server-side, and idempotency keys make
  retries safe at the database layer.
- **Continuous scanning** — gitleaks (secrets, full history), dependency audits
  (`npm audit`), CodeQL, and a Dependency Review gate all run in CI.

## 2. Threat Model Summary

The platform runs three trust zones:

| Zone | Actors | Trusted with |
|---|---|---|
| Public internet | Guest customers (storefront, checkout, order tracking) | Public menus, placing orders with their own contact details |
| Authenticated merchants | owner / manager / cashier / kitchen / delivery members of one workspace | That workspace's data only |
| Platform | `platform_admin` accounts | Cross-tenant analytics and workspace administration |

Primary threats and their controls:

- **Cross-tenant data access (IDOR / broken access control)** — a tenant-scoped
  middleware resolves the workspace from the DB membership on every request
  and rejects mismatches with 403/404; role/permission checks gate every
  privileged route. See [`backend/src/middleware/tenant.js`](backend/src/middleware/tenant.js).
- **Credential theft / brute force** — login rate limiting, per-account lockout
  (5 failures → 15 min), refresh-token reuse detection (family revocation),
  httpOnly + SameSite refresh cookies, and optional TOTP 2FA.
- **Payment fraud** — webhook signature verification (SSLCommerz, Stripe),
  execute-and-verify for bKash, server-side amount matching, and pending-only
  idempotent confirmation (a replay can never double-apply).
- **Privilege escalation** — permission-level RBAC, per-user flag overrides that
  are validated against a fixed catalogue, and owner/platform-admin-only
  operations for membership and billing changes.
- **Injection** — Sequelize ORM parameterization (no raw SQL in routes), zod
  schema validation on every payload, and server-generated storage keys.
- **Data exfiltration via uploads** — strict format/size/dimension validation,
  re-encoding to WebP (drops EXIF), and a key allowlist that makes path
  traversal structurally impossible.

## 3. Authentication Security

- Passwords hashed with **bcrypt (cost 10)**; unknown-email logins compare
  against a dummy hash so timing does not reveal account existence.
- Password policy: 8–128 characters with at least one uppercase, one lowercase,
  and one digit (`validatePassword` in `backend/src/services/authService.js`).
- **Login lockout**: 5 failed attempts → 15-minute lock with a `retryAfterSeconds`
  detail; cleared on success or admin unlock.
- **Access tokens**: signed JWTs, 15-minute lifetime.
- **Refresh tokens**: 30-day, stored **SHA-256-hashed at rest**, rotated on
  every refresh, grouped into families; reuse of a rotated token revokes the
  whole family (theft signal). Served as an httpOnly, SameSite=Lax cookie
  (`secure` in production).
- **Email verification** and **password reset** use single-use, hashed,
  expiring tokens; reset revokes all active sessions.
- **TOTP 2FA** (otplib) with QR provisioning; a short-lived purpose-bound token
  gates the second login step.
- **Admin-forced password change** (`mustChangePassword`) and self-service
  change revoke all other sessions.
- SAML 2.0 enterprise SSO with signed-assertion verification against the
  configured IdP certificate only (key-confusion safe), SP metadata, and single
  logout.

## 4. Authorization / RBAC

- Eight roles: `platform_admin`, `owner`, `manager`, `cashier`, `kitchen`,
  `delivery`, `customer`, and legacy `staff` (see
  [`backend/src/config/roles.js`](backend/src/config/roles.js)).
- A granular **permission catalogue** (e.g. `refund:orders`, `manage:inventory`,
  `view:reports`) is the per-action layer; roles map to permission sets and
  routes guard with `requirePermission(...)`.
- Per-user **flag overrides** on a workspace membership can grant *or deny*
  (negated) permissions beyond the role matrix; unknown names are rejected so
  typos cannot widen access.
- Money-leaving operations (`refund:orders`) are manager-and-above.
- Outlet-level access adds a second scope: `OutletMembership` rows
  (`outlet_manager` / read-only `staff`) gate per-outlet routes.

## 5. Multi-Tenant Isolation

- Every business table carries a `tenant_id`; lookup queries always scope by the
  resolved tenant (`backend/src/middleware/tenant.js`).
- The client never picks a tenant by claim alone: `X-Tenant` / `?tenant=` values
  are validated against the caller's real memberships, and suspended/archived
  workspaces are refused.
- Platform admins can operate across workspaces; everyone else gets 403 on
  anything outside their memberships. Isolation is covered by dedicated
  `tenantIsolation` / `tenantHardening` / `outlets` test suites.

## 6. API Security

- **Helmet** security headers (CSP, HSTS, nosniff, frame protection) on the API
  and mirrored CSP headers in the nginx serving the SPA.
- **CORS** allowlist via `CORS_ORIGINS`; server-to-server calls without an
  Origin header are allowed, everything else must match the list.
- **CSRF**: cookie-authenticated state-changing requests verify
  `Origin`/`Sec-Fetch-Site` against the allowlist (the refresh-token flow is
  protected even though SameSite=Lax is set).
- **Rate limiting**: global API budget (default 120 req/min/IP) plus a stricter
  auth limiter (default 20 req/15 min/IP).
- **Validation**: zod schemas reject malformed payloads before the database;
  responses use a stable error envelope with machine-readable codes and a
  `requestId`; 500s never leak internals.
- **Request IDs**: every request is tagged with a UUID echoed in `X-Request-Id`
  and correlated through structured logs (JSON in production).
- Body size caps (`express.json({ limit: '1mb' })`) and upload limits
  (`MAX_IMAGE_BYTES` 5 MB default, dimension caps, `MAX_IMPORT_BYTES`).

## 7. Payment & Webhook Security

- Three gateway adapters behind one registry: **SSLCommerz**, **Stripe**,
  **bKash** (`backend/src/services/paymentGateway.js`). All credentials come
  from the environment; sandbox is the default until live credentials are set.
- **SSLCommerz** webhooks verified by the documented `verify_sign` checksum;
  **Stripe** webhooks verified by HMAC-SHA256 with timestamp (raw body, mounted
  before the JSON parser); **bKash** callbacks are unsigned by design and are
  therefore **never trusted** — the backend executes the payment with the real
  gateway and only a `Completed` transaction state is applied.
- The gateway-reported amount must match the charged amount (±0.01), or the
  confirmation is rejected (`AMOUNT_MISMATCH`).
- Confirmation is **idempotent**: only `pending` payments can be confirmed, so
  replayed webhooks no-op.
- Verification metadata (never secrets) is persisted per payment for audit.
- Orders are always re-priced and validated server-side at checkout; client
  totals are ignored.

## 8. Secrets Management

- **Never commit secrets.** `.env`, `.env.local`, and local databases are
  gitignored; committed `.env.example` files hold placeholders only.
- All configuration is environment-driven and validated at boot by zod
  (`backend/src/config/env.js`) — the process refuses to start with a missing
  or malformed `JWT_SECRET` rather than running insecure.
- Secrets are not baked into container images; docker-compose injects them at
  runtime from the root `.env` and requires `JWT_SECRET` explicitly
  (`${JWT_SECRET:?…}`).
- **Gitleaks** scans the whole git history nightly in CI and on every PR run;
  repository-level secret scanning and push protection should be enabled in
  GitHub settings (see [Security Tooling](#security-tooling)).
- If you believe a secret has been committed, treat it as compromised: rotate
  it, then report it per [Vulnerability Reporting](#12-vulnerability-reporting).

## 9. Dependency Security

- `npm ci` for reproducible installs; `npm audit --audit-level=high` gates the
  backend CI job (frontend job runs it as informational — see the workflow's
  comment about a react-router advisory that does not apply to this
  declarative-mode SPA).
- **Dependabot** is configured (`.github/dependabot.yml`) for npm, GitHub
  Actions, and Docker base images.
- **Dependency Review** workflow blocks PRs that add dependencies with
  High/Critical advisories.
- **CodeQL** (`security-and-quality`) runs on push, PRs, and weekly.

## 10. CI/CD Security

- Workflows declare **read-only permissions** by default; only the jobs that
  must write (Playwright report artifact upload, CodeQL SARIF upload) receive a
  narrow, job-scoped grant.
- Third-party actions are version-pinned at `@vN` tags and tracked by Dependabot.
- CI never prints secrets; test credentials in workflows are explicit
  non-secret placeholders for scratch services (SQLite/MinIO/local gateway
  sandbox).
- Full pipeline per PR and nightly against master: lint → tests (SQLite and
  PostgreSQL 16) → coverage gate → dependency audit → gitleaks → gateway
  sandbox E2E → S3/MinIO round-trip → Playwright E2E → frontend build.

## 11. Logging and Auditing

- Structured request logging with request IDs (see §6).
- An append-only **audit trail** (`audit_logs`) records logins, failures,
  lockouts, refreshes, reuse detection, password changes, 2FA changes, refunds,
  permission edits, membership changes, and settings mutations — with actor,
  workspace, IP, and metadata where applicable. Audit writes never break the
  request that triggered them.
- Payment confirmations persist gateway verification metadata for
  reconciliation and dispute handling.
- Never log secrets: webhook/WhatsApp failures log hosts and statuses only.

## 12. Vulnerability Reporting

**Please do not open a public issue for suspected security vulnerabilities.**

Report privately:

1. **Preferred:** GitHub **Private vulnerability reporting** (Security →
   Advisories → New draft advisory) if enabled on this repository.
2. Otherwise, open a regular issue with `security` in the title and *do not*
   include proof-of-concept code, credentials, or live data — a maintainer
   will move the discussion to a private channel.

What to include:

- Repository and branch/commit where the issue was found.
- Affected component/endpoint and a step-by-step description.
- Impact assessment (what an attacker can do) and any suggested fix.
- Severity estimate (CVSS if you have one).

We aim to acknowledge reports within **3 business days** and to ship a fix
according to severity: Critical within 7 days, High within 14, Medium within
30. Please allow time for the fix to land before public disclosure.

## 13. Security Development Practices

- Every route that touches tenant data is tenant-scoped and role/permission
  gated; new routes must follow the same middleware chain.
- Payloads are validated with zod before use; new endpoints should add schema
  validators, not hand-rolled checks.
- Money mutations require audit entries and (where applicable) idempotency.
- Prefer ORM queries over raw SQL; never interpolate user input into SQL.
- Backend tests must stay green on both SQLite and PostgreSQL 16 — the CI
  PostgreSQL tier catches dialect-specific gaps.
- The coverage gate (lines ≥ 85, functions ≥ 85, branches ≥ 68, statements ≥ 87)
  is a hard CI floor; security-sensitive modules should exceed it.
- Review secrets hygiene on every change: run `git diff` for stray keys and let
  the gitleaks job catch the rest.

## 14. Production Security Checklist

Before any production deployment:

- [ ] `JWT_SECRET` is a fresh, long random value (≥ 32 bytes) injected via the
      environment — never committed.
- [ ] `DB_DIALECT=postgres` with TLS (`DB_SSL=1`) to a managed PostgreSQL; no
      default `oms/oms` credentials.
- [ ] `NODE_ENV=production` (secure cookies, JSON logs, no dev token leaks).
- [ ] `CORS_ORIGINS` set to the real frontend origin(s); `TRUST_PROXY=1` behind
      the TLS-terminating proxy.
- [ ] Payment gateways configured with **live** credentials and sandbox flags
      off; webhook secrets set and verified with a test transaction.
- [ ] `MAIL_DRIVER=smtp` with real SMTP credentials; verify reset/verification
      emails arrive.
- [ ] Storage: `STORAGE_DRIVER=s3` (or equivalent) with least-privilege bucket
      keys, `CDN_BASE_URL` set if an edge cache is used.
- [ ] Run the PostgreSQL cutover runbook (`docs/04-pg-cutover-runbook.md`) with
      backup + dry-run before the flip.
- [ ] Enable in GitHub repository settings (cannot be configured from this
      repo): Dependabot alerts & security updates, secret scanning + push
      protection, code scanning, private vulnerability reporting, and branch
      protection on `master` with required CI checks.
- [ ] Confirm scheduled jobs (nightly CI, CodeQL weekly) are active and green.
