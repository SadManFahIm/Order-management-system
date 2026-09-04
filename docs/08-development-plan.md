# Orderly OMS — Ongoing Development Plan

**Status:** living document — updated as phases ship.

This plan answers **how** the project keeps being developed, organized the way a
product team would staff it. [`docs/02-v2-roadmap.md`](02-v2-roadmap.md) defines
**what** the platform should become (target architecture + phased feature
roadmap); this document maps the next moves to **industry roles**, the operating
cadence the repository already enforces, and a concrete 90-day sequence.

Everything ships through the flow already in place: **branch → pull request →
green CI (10 required checks) → squash merge → master**. Docs travel with the
code in the same PR.

---

## 1. Current state (verified snapshot)

| Area | Today |
|---|---|
| Product scope | Multi-tenant restaurant SaaS: workspaces, RBAC + 2FA + SAML SSO, menu/catalog with variants/add-ons/availability scheduling, public storefront + checkout, ordering/fulfillment with realtime KDS, payments (SSLCommerz/Stripe/bKash adapters, refund ledger, settlements, NBR invoice), split bills, analytics + rollups + scheduled reports, outlets, i18n (en/bn) |
| Backend | Express modular monolith (`routes → services`); services for auth, checkout, payments, reconciliation, settlement, invoice, split, import, image pipeline, edit requests, delivery assignment, WhatsApp, SAML, analytics, reports, notifications, audit |
| Frontend | React SPA, route-level code splitting, design tokens + paper-ticket design system ([`docs/06-design-system.md`](06-design-system.md)) |
| Database | PostgreSQL 16 (production tier) + SQLite (dev); versioned migrations; PG16 exercised in CI |
| CI/CD | 10 required checks per PR: backend lint/test/audit, PG16 migrate+test+smoke, Playwright E2E, gateway sandbox E2E, S3/MinIO driver, frontend lint/build/audit, CodeQL + Analyze, gitleaks, dependency review |
| Branch protection | PRs required on `master`, strict up-to-date, linear history, force-push banned everywhere, 1 approval for non-owners (owner bypass), enforced on admins |
| Security posture | CodeQL 0 open alerts, Dependabot 0 open alerts, secret scanning 0; full policy in [`SECURITY.md`](../SECURITY.md) |
| Docs | `docs/01`–`07` + rebuilt README; OpenAPI/API reference still missing |

**Deliberate gaps (not yet built):** Redis/BullMQ (realtime + scheduling are
in-process, single-node), structured logs + metrics/alerting, load testing, an
OpenAPI contract, a real deployment target (Docker + compose and a PG cutover
runbook exist; no managed infra), a mobile app, and any AI/ML capability.

---

## 2. Operating model — mapping roles to what already exists

| Industry role | Repository practice it maps to |
|---|---|
| Product Owner | User stories with acceptance criteria — one per branch/PR |
| QA Automation / AppSec | The 10 CI gates review every PR automatically |
| Release Manager | `ci.yml` + squash merges + conventional commit history |
| Technical Writer | README, SECURITY.md, `docs/01`–`07` updated in-feature |
| Support Engineer | The triage loop: CI failures → root cause → regression test |

---

## 3. Recommended 90-day sequence

### Block A — "Make it operable" (highest ROI; roadmap Phases 9–10)

The product is feature-rich; running it for real customers is not yet proven.
This block closes that gap.

1. **Observability** — structured logging (pino) with request IDs, `/metrics`
   for Prometheus, an error tracker, and an uptime/health story. Owners: SRE,
   DevOps, Backend. Exit: a 404/5xx spike is diagnosable from logs alone.
2. **Load & performance** — k6 scenario for the Dhaka peak-hour window; store
   budgets (storefront < 1.5s LCP, API p95 < 300ms); `EXPLAIN ANALYZE` pass on
   analytics/availability queries; Redis cache for the public menu path. Owners:
   Performance Engineer, QA Automation, Backend. Exit: budgets met on seeded
   data; regressions caught in CI.
3. **Deployment + runbook** — pick a target (managed VPS via Docker Compose or a
   container service); TLS, secrets manager, `pg_dump`/PITR backups with a
   restore drill; write `DEPLOYMENT.md` + `ADMIN_MANUAL.md`. Owners: DevOps,
   Cloud Engineer, Release Manager, DBA.
4. **API contract** — generate OpenAPI from the existing zod schemas; publish
   docs that mobile and partner integrations can build against. Owners:
   Backend, Technical Writer.

### Block B — "Make it commercial"

5. **Plan limits & usage enforcement** — `planService`/`billingService`/
   `trialService` exist; wire real limits (menu/order caps, feature flags) and a
   subscription lifecycle. Owners: Product Owner, Backend, DBA.
6. **Production payment go-live** — take one gateway live with a key ceremony,
   replay/refund drills, and settlement reconciliation. Owners: Security
   Engineer, Backend, QA.

### Block C — "Growth bets" (pick 1–2, after A–B)

7. **Mobile app** — rider + QR-ordering app reusing the public and authenticated
   APIs. Owners: Mobile Developer, Backend, Product Designer.
8. **WhatsApp ordering** — a conversation→order flow on top of the existing
   `whatsappService`. Owners: Full-Stack Developer, Backend.
9. **AI layer** — demand forecasting on rollup data, dish recommendations, photo
   auto-tagging. Owners: ML/AI Engineers, Data Analyst. Only after the analytics
   are exposed via a clean public API.

---

## 4. Role-by-role next steps

### Product & leadership
- **Product Manager / Product Owner** — convert Blocks A–C into a prioritized
  backlog with acceptance criteria per story; revisit after every merged PR.
- **Project Manager** — track the 90-day sequence with owners + risks; re-baseline
  estimates from CI cycle time.
- **Scrum Master** — run the PR cadence as the heartbeat; unblock flaky gates
  (as done for the npm-audit endpoint outages).
- **Business / System Analyst** — document the order lifecycle end-to-end
  (place → edit-approve → fulfill → split → refund → settle) and hunt
  state-machine gaps between storefront, KDS, and payments.

### Architecture & engineering
- **Solution / Software Architect** — write the ADR for when Redis + BullMQ are
  introduced (realtime fan-out, scheduled jobs) vs. keeping the modular monolith
  single-node; keep tenant-scoping and payment invariants first-class.
- **Technical Lead** — enforce layering (routes → services → repos), fail-closed
  tenant scoping, and migration discipline on every feature.
- **Engineering Manager** — definition of done per PR: tests on SQLite **and**
  PostgreSQL, en/bn i18n, audit logging for sensitive mutations, migration,
  docs, 10 green checks.
- **Backend Developer** — Block A items 1–2, 4; extract in-process realtime and
  the report scheduler behind interfaces so a Redis/BullMQ swap is a driver
  change.
- **Frontend Developer** — design-token/component audit, storefront LCP budget,
  TanStack Query consolidation.
- **Full-Stack Developer** — growth bet UI+API pairs (WhatsApp flow, plan-limits
  UI).
- **Mobile App Developer** — rider + QR-ordering apps on the existing APIs.

### Data & database
- **Database Administrator / Database Engineer** — index audit against live
  query patterns (analytics rollups, availability scans, tenant lookups); plan
  archival of `orders`/`audit_logs`; backup/restore runbook with a drill.
- **Data Engineer / Data Analyst / BI Developer** — expose analytics via public
  API + scheduled exports (closeout + NBR CSV exist); build retention and
  fulfillment dashboards.
- **Data Scientist / Machine Learning / AI/ML Engineers** — forecasting +
  recommendations on rollup data once an export path exists.

### Platform
- **DevOps / Cloud / Release / Build Engineer** — staging parity with CI,
  artifact publishing, tag-based releases, zero-downtime strategy.
- **Site Reliability Engineer** — SLOs, alerting, on-call runbook, game-day
  incident drill.

### Quality
- **QA Engineer** — expand Playwright coverage to the riskiest flows: split pay,
  refunds, closures/scheduling, SSO; accessibility pass.
- **QA Automation Engineer** — keep fast tiers in the 10-gate PR bar; run the
  slow matrix nightly.
- **Performance Engineer** — k6 load model, bundle budgets, query budgets.

### Security
- **Security / Application Security Engineer** — keep CodeQL, gitleaks,
  Dependabot and secret scanning at zero (current state); add a CSP/headers
  audit, live-gateway key ceremony, OWASP review pass, and refresh the
  production checklist in [`SECURITY.md`](../SECURITY.md).

### Design & content
- **UI/UX Designer / Product Designer** — systemize the design-token component
  library; usability-test checkout and settings (the densest screens); mobile
  patterns.
- **UX Researcher** — interview 2–3 real restaurant owners/cashiers and feed
  findings into the backlog.
- **Technical Writer** — OpenAPI reference, `DEPLOYMENT.md`, `ADMIN_MANUAL.md`,
  `DEVELOPER_GUIDE.md` (roadmap Phase 10 deliverables).

### Support
- **Support / Application Support / Reliability Engineers** — turn the existing
  triage loop into a discipline: issue templates from real failures (e.g. the
  migration-028 SQLite path, npm-audit endpoint outages), a runbook-first
  escalation path, monitoring-backed diagnosis.

---

## 5. Suggested first sprint (one developer, ~2 weeks)

1. Pino structured logs + request IDs across the API (Backend/SRE) — quick win.
2. OpenAPI generation from the zod validators (Backend/Tech Writer).
3. k6 smoke load test + a first storefront LCP budget (Performance/QA).
4. ADR: Redis/BullMQ adoption point (Architect).
5. Deployment runbook skeleton + `pg_dump` backup + restore drill (DevOps/DBA).

**Exit criteria for the sprint:** every item lands as a PR with the 10 checks
green; logs from a seeded load run answer "which endpoint is slow"; an OpenAPI
file is browsable; the ADR is reviewed; a restore drill succeeds on a throwaway
database.

---

## 6. Definition of done (applies to every change)

- Branched from `master`; never committed to directly (protected).
- Migrations for schema changes; tests run on SQLite **and** PostgreSQL.
- User-facing text is i18n'd (en/bn); sensitive mutations write audit logs.
- Docs updated in the same PR (`docs/` + README where behavior is user-visible).
- All 10 CI checks green; CodeQL/gitleaks/Dependabot stay at zero.
- Merged via PR with a conventional, descriptive commit message.
