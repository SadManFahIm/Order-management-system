# Order Management System

> A production-ready **Restaurant SaaS Platform** — multi-tenant ordering, menus, orders, fulfillment, and analytics for hundreds of restaurants across Bangladesh.

![CI](https://github.com/SadManFahIm/Order-management-system/actions/workflows/ci.yml/badge.svg)

The Order Management System is evolving from a single-tenant order CRUD app into a commercial, cloud-based **restaurant ordering SaaS** for the Dhaka market (KFC, Pizza Hut, Domino's, Chillox, Sultan's Dine, Star Kabab, Madchef, and hundreds more — all data-driven, never hard-coded). This repository is the **V2 platform**: security hardening, multi-tenancy, RBAC, engineering tooling, testing, CI/CD, and a growing customer-facing storefront — built incrementally on the existing, working v1 features.

**Current status:** Phases 1–5 **done** ✅ (Phase 5 = ordering & fulfillment: **customer storefront checkout** — browse → cart → checkout → order → tracking, **pickup / delivery / scheduled pickup / scheduled delivery** order types, **delivery assignment + out_for_delivery lifecycle**, **kitchen accept/reject** with reason, **database-backed Idempotency-Key** retry safety, and a **JWT-authenticated WebSocket real-time kitchen queue** with 30s polling fallback; plus the earlier Phase 4 rounds: XLSX import, soft delete + optimistic locking, public menu pagination, inventory, merchant dashboard with analytics charts, CRAV-style landing page, per-tenant storefront branding) · **Phase 6 (payments) done** ✅ — **bKash Tokenized Checkout gateway adapter** (SSLCommerz + Stripe + bKash behind one provider registry, sandbox + 3-gateway E2E in CI), **split payments** (one order, multiple methods — partial → paid recompute, New Order editor), **full/partial refunds** (audit trail + audit_logs entry), **payment reconciliation** (stale online intents auto-expire), **VAT-aware order invoices** (per-item NBR VAT split + linked payments + print/PDF), `seed:payment-demo` — order status workflow, **fully translated Bangla landing + storefront**, **QR table menus (printable + downloadable + table-aware orders)**, **kitchen/delivery order filters (status/table/open-first)**, **WhatsApp order alerts + customer status notifications (webhook + wa.me)**, **bKash/Nagad payment records + SSLCommerz/Stripe gateway integration** (payments table, per-tenant payment methods, hosted checkout sessions, signed webhooks, **local gateway sandbox harness + test-mode E2E in CI**), **daily closeout report** (JSON + CSV + **print/PDF + nightly email via real SMTP**, Dhaka-day), **closeout trend dashboard** (7/30-day revenue curve by payment method, best day, day-over-day, **3-day forecast + month-over-month**), **VAT compliance report** (per-item VAT split, NBR-ready, migration 009), **nightly merchant digest** (top sellers + low stock in the closeout email + signed WhatsApp push), **customer order tracking page** (order no + phone, public API), revenue-by-method analytics, the Deliveroo-style design system, and **Phase 7 analytics** — **peak-hours heatmap** (7×24 Dhaka-time grid + busiest-slot insight), **category-mix donut**, **customer retention** (repeat rate, avg order value, masked top customers), **fulfillment-time stats** (placed → delivered per order type), **live order queue** (auto-refreshing) + **dashboard alerts** (low stock / high cancellation / idle hours), **platform-admin cross-tenant analytics** (SaaS-wide revenue, top restaurants, method mix), and a **nightly rollup layer + 6-month performance test** (<2s p95, measured 279ms) — all live; plus the **storefront ticket remaster**: an **animated food-orb hero behind the ticket stub**, a **dark-paper (ink) variant** of the ticket (auto/light/dark paper toggle), and the **checkout + confirmation redesigned as the same hand-held ticket** (stub hero, scalloped tear, ticket cards, gold-foil order number). · **Phase 8 (The Table Ticket everywhere) done** ✅ — a **global paper theme context** (`PaperThemeProvider` — one 🌓 auto/light/dark toggle now drives the storefront ticket, the merchant dashboard and the invoice), the **ink-paper dashboard** (the merchant ledger: gold “Daily ledger” stub, ink sheets, sage ink, chilli money — charts adapt via token overrides), the **ticket-styled closeout email** (gold stub + date stamp + dashed ticket stat/order rows + top-sellers/low-stock digest; still CSV-attached and prints clean white), and **PDF ticket attachments** on the confirmation + status emails (pdfkit — `order-<no>.pdf`, no browser needed, fallback-safe). · **Phase 1 (foundation) hardened** ✅ — **liveness/readiness endpoints** (`/api/health` + `/api/health/ready`), **request-ID + structured logging** (per-request lines + errors carry the same `requestId` echoed in `X-Request-Id`), **hot-query indexes** (migration 015: `orders`/`payments` by tenant + day), **route-level frontend code splitting** (initial bundle ~310 kB, warning gone), and CI **gitleaks secret-scan + coverage gates**. · **Phase 2 (Auth & RBAC) hardened** ✅ — **failed-login lockout** (5 strikes → 15-min lock with retry-after, reset on success/unlock), **login audit trail UI** (sessions + security events with IP/device on Settings), **stronger password policy + admin-forced password change** (uppercase/lowercase/digit, `mustChangePassword` gate + force-reset per member), **permission-level RBAC** (granular `refund:orders` / `manage:inventory` / `view:reports` … catalogue + per-user **flag overrides** on the team membership — grant/deny beyond the role matrix), and **refunds now manager-and-above only** (cashiers confirm but never refund). · **Phase 4 follow-ups round 4 (migration 023) done** ✅ — **storefront-wide closure days** (one-off dates + recurring weekday closures dark the whole storefront with a “We're closed today” banner; checkout + scheduled orders rejected), **per-item recurring weekday rules** (a Sun–Sat editor in the Product form), **scarcity cues in the checkout cart** (sold-out lines blocked + low-stock chips) and the **scheduled-order availability preview** (public availability API + live per-line preview that blocks placement before a surprise rejection). · **Phase 4 follow-ups round 5 done** ✅ — **closure-conflict warnings** in Settings (items that would open on a closed day are flagged before saving), a **storefront next-open countdown** on the closed banner (“Back open Mon at 11:00”, computed by a 14-day forward scan) and the **per-dish availability calendar** (a “Check times” button on every dish — seven-day chips + an hourly slot grid from the availability API's new windows mode). · **Phase 4 follow-ups round 6 done** ✅ — **timezone-safe scheduling** (an Intl-based `timezone` util + a validated `PATCH /api/tenants/:id` field resolve availability windows, closure dates and scheduled orders against the restaurant's IANA wall clock — server-local until a merchant configures one), **schedule straight from the calendar** (clicking an open slot in the per-dish “Check times” modal adds the dish and pre-fills the checkout's scheduled time) and the **closure day on the merchant calendar** (a Settings month grid — closure dates in red, recurring weekday closures tinted, per-day override counts — plus a timezone picker). · **Phase 4 follow-ups round 7 done** ✅ — **schedule the whole cart from the calendar** (a “Schedule my order” button in the cart bar picks one date + hour where EVERY cart line is orderable — server-verified line-by-line before jumping to checkout), **customer-side timezone display** (availability endpoints return the restaurant's IANA zone; when it differs from the customer's browser zone the slot grids are re-labelled in the customer's own hours — “Times shown in your timezone · Restaurant runs on …”), and **bulk closure import** (closure dates carry optional holiday **labels** via migration 024; Settings accepts pasted `YYYY-MM-DD` / `YYYY-MM-DD Holiday name` lists, merging them into the pending list and reporting invalid lines). **Phase 5 follow-ups done** ✅ — **order editing with an approval flow** (staff/customer request changes on a live order, manager approve/reject, server-side re-pricing), **delivery auto-assignment by zone + rider load** (delivery_zones catalogue + rider coverage, least-loaded in-zone rider, never overwrites manual), **KDS bump bar / prep timer / overdue highlight**, **cancellation reasons** (required, audited), and an **offline submit queue** (orders parked locally and replayed when back online) — migration 025, +9 backend tests, **566 backend tests** · **Phase 6 round 2 (payments) done** ✅ — **bKash callback-execute verification + idempotent auto-confirm** (unsigned callbacks never trusted, `verification_metadata` + gateway stamp, manual verify fallback), **delivery tips** (delivery-only, charged in the grand total, never VAT-able), **settlements + wallet balance** (ledger-computed, request + history UI), **NBR invoice supplier block + QR** (registered name / address / 13-digit BIN), **full/partial refund UI** (RefundModal with ledger history, `refund:orders`-gated) — migration 026, +23 backend tests, **589 backend tests**. ✅ **Phase 7 round 2 (analytics maturity) done** — a **custom-range analytics API** (`/api/analytics/*` — date range + channel + order-type filters, tenant-timezone aware), a **storefront conversion funnel** (Browse → Cart → Checkout → Paid over distinct anonymous sessions, POS-excluded so conversion never exceeds 100%), **rider performance vs SLA**, **revenue anomaly alerts** (persisted, cooldown-deduped, nightly + on-demand), and **one-click CSV export for every chart**, surfaced on a filterable merchant dashboard (cashier-safe graceful degradation) — migration 027, +18 backend tests, **621 backend tests**, full details in [`docs/07-analytics.md`](docs/07-analytics.md).

---

## 📋 Scrum Master's Delivery Summary

| Sprint / Phase | Delivered | Verification |
|---|---|---|
| **Phase 1** — Foundation | Security hardening (Helmet, CORS, rate limiting, zod validation, central errors), hotfix wave, PostgreSQL stack (migration runner, migrations 001–015, PG dev service), CI/CD pipeline — plus **liveness/readiness endpoints** (`/api/health` + `/api/health/ready`), **request-ID + structured logging** (X-Request-Id correlation), **hot-query indexes** (migration 015), **route-level frontend code splitting**, and CI **gitleaks secret-scan + coverage gates** | Backend + PG CI jobs green · **435+ tests** · 27 e2e |
| **Phase 2** — Auth & RBAC | Register/login/verify/reset flows, rotating refresh tokens with reuse detection, TOTP 2FA, role-based access control (admin/owner/manager/cashier/kitchen/delivery), session management — **hardened**: **failed-login lockout** (5 strikes → 15-min lock, retry-after, admin unlock), **login audit trail UI** (active sessions + security events), **password policy + admin-forced password change** (migration 016), **permission-level RBAC** (granular permission catalogue + per-user flag overrides), **refund gate `refund:orders` (manager+)** | Full auth + RBAC suites green — **458 backend tests** + 27 e2e |
| **Phase 3** — Multi-tenant SaaS | Tenant workspaces, team members & roles, plans/subscriptions/feature flags, tenant-scoping middleware (fail-closed isolation), CSRF protection, Dhaka seed data (20 workspaces, 89 menu items) — **hardened**: **plan quota enforcement** (products / orders-per-day / members / storage gates with live usage meters), **expiring team invites** (token links, 1–30 day expiry, revoke, accept-with-account flow), **ownership transfer**, **tenant audit-log UI** (who changed what), **platform-admin plan changes** (migration 017) | Tenant isolation + CSRF suites + **quota/invite/transfer/audit suites — 490 backend tests** · **27 e2e** · PG job green |
| **Phase 4** — Menu & Media | Menu catalog (categories/variants/add-ons), image pipeline (sharp → WebP, S3-compatible storage, CDN-ready), bulk **CSV + XLSX** import, public menu API with HTTP caching + pagination, **DELETE endpoints**, **soft delete + optimistic locking**, **inventory**, **merchant dashboard with analytics charts**, **CRAV-style landing page**, **per-tenant storefront branding**, **MinIO S3 test tier in CI** — **hardened**: **item-level availability schedules**, **bulk edit + category duplication**, **dietary/merch tags**, **drag-and-drop menu sort** (+ **category drag-sort**), **variant-level stock** (enforce + decrement, **low-stock alerts + digest flags**), **image crop/compress + CDN invalidation** (migrations 020–021) | **535 backend tests** + **27 e2e** · coverage gate green · PG 16 green |
| **Phase 5** — Ordering & fulfillment | **Customer storefront checkout** (`POST /api/public/restaurants/:slug/checkout` — guest order, server-side pricing, `Idempotency-Key` retry safety, empty-cart/price/availability protection, WhatsApp alert + realtime broadcast), **order types** (pickup / delivery / scheduled pickup / scheduled delivery — address + schedule validation, delivery fee), **delivery assignment** (manager assign/reassign to delivery members, delivery-only filtered views, `out_for_delivery` lifecycle), **kitchen accept/reject** (reason-required reject, invalid-transition 409), **real-time kitchen queue** (JWT-authenticated WebSocket `/ws`, tenant-room isolation that follows the active workspace, reconnect backoff + resync, 30s polling fallback), order status workflow, fully translated EN/BN i18n, QR table menus, table-aware orders, order filters, WhatsApp alerts, customer tracking, Deliveroo design system | Checkout, delivery, idempotency, realtime + fulfillment suites green — **385 tests passing** |
| **Phase 6** — Payments | **bKash/Nagad/cash payment records** (`payments` table + per-tenant methods + cashier confirm/refund with trxID), **SSLCommerz + Stripe + bKash gateway integration** (one provider registry, hosted checkout, signed webhooks + callback-execute, **local sandbox harness + 3-gateway E2E in CI**), **split payments** (multi-method per order, partial → paid recompute, New Order editor), **full/partial refunds** (audit trail: amount/at/reason/by + `audit_logs`), **payment reconciliation** (stale online intents auto-expire), **VAT-aware order invoices** (per-item NBR VAT split + linked payments + print/PDF), **daily closeout** (JSON + CSV + print/PDF + nightly email via real SMTP), **closeout trend dashboard** (7/30-day curve + method mix + day-over-day + 3-day forecast + month-over-month), **VAT compliance report** (migration 009), **nightly merchant digest** (email + signed WhatsApp push), `seed:payment-demo` | Gateway, split, refund, reconciliation, invoice & closeout suites green (3-gateway sandbox E2E in CI) |
| **Phase 6 follow-ups** — Payments round 2 (migration 026) | **bKash callback-execute verification + idempotent auto-confirm** (an unsigned callback is never trusted — the backend `execute`s the payment and checks `transactionStatus === 'Completed'` + the exact amount before marking paid; `verification_metadata` + `payment.gateway` stored; an already-paid payment is never double-confirmed; manual `POST /api/payments/:id/verify` fallback, `place:orders`), **delivery tips** (`orders.tip_amount`, delivery order types only, `normalizeTip` cap ৳100,000/2dp, charged in the grand total, never VAT-able, reported in the invoice + closeout), **settlements + wallet balance** (`GET /api/settlements/balance` ledger-derived: Σ paid online − refunds − settlements; request a settlement + history with `pending → processing → completed`, Settings card), **NBR invoice (Mushak-6.3) supplier block + QR** (registered name / address / 13-digit BIN from `settings.vat`, identity-only QR data-URL, Settings Invoice card), **full/partial refund UI** (`RefundModal`: amount, reason, ledger history, remaining/already badges, `refund:orders`-gated) | **paymentsUpgrade suite — 23/23 green** + regressions green (migrations/payments/drift 36 · reports/checkout/webhooks/gateway 52 · tenant/delivery/checkout 55) · frontend lint + build green |
| **Phase 7** — Analytics | **Peak-hours heatmap** (7×24 Dhaka grid + busiest-slot insight), **category-mix donut**, **customer retention** (repeat rate, avg order value, masked top customers), **fulfillment-time stats** (placed → delivered per type), **live order queue** (30s auto-refresh) + **dashboard alerts** (low stock / high cancellation / idle), **platform-admin cross-tenant analytics** (SaaS revenue, top restaurants, method mix), **nightly rollup layer** (migration 011 `daily_stats` + `?source=rollup`) + **6-month perf acceptance** (<2s p95 — measured 279ms), `seed:analytics` demo data | **334 tests** passing (SQLite) + PG · live UI verified · perf p95 279ms |
| **Phase 8** — The Table Ticket everywhere | **Global paper theme context** (`PaperThemeProvider` — one auto/light/dark toggle now drives the storefront ticket, the merchant ledger and the invoice), **ink-paper merchant ledger dashboard** (gold “Daily ledger” stub, ink sheets, sage ink, chilli money — charts adapt via token overrides), **ticket-styled closeout email/PDF** (gold stub + date stamp + dashed ticket stat/order rows + top-sellers/low-stock digest), **PDF ticket attachments** on the confirmation + status emails (pdfkit — `order-<no>.pdf`, Latin-sanitized, fallback-safe), **ticket-styled auth pages** (sign-in/register/reset/verify as one ticket — gold-foil ORDERLY stub, scalloped tear, food orbs, paper theme + 🌙 toggle) | Email, PDF, reports, digest & e2e suites green — **458 backend tests** + **27 e2e** |
| **Phase 3 hardening** — Multi-tenant | See the summary row above: plan quotas + usage meters, expiring invites, ownership transfer, tenant audit log UI, platform-admin plan changes | **477 backend tests** + **27 e2e** · PostgreSQL 16 job green |
| **Phase 3 follow-ups** — SSO, alerts & trial expiry | **SAML 2.0 enterprise SSO** (SP-initiated + IdP-initiated round trips, signed-assertion verification against the *configured* certificate only — key-confusion safe, user provisioning + role mapping, `GET/PUT /api/tenants/:id/saml`, Login-ticket SSO entry, `/sso/success` landing), **quota-exceedance alerts** (WhatsApp webhook with HMAC signature + ticket-styled owner email at 80/90/100% of any plan metric, once per day), **trial-expiry sweep** (minutely scheduler downgrades expired trials to Free, ticket-styled upgrade nudge email, audited) (migration 018) | **SAML / alerts / trial suites — 490 backend tests** (SQLite **and** PostgreSQL 16) + **27 e2e** |
| **Phase 3 follow-ups (2)** — SAML SLO, billing meter & SSO admin | **SAML single logout** (SP metadata XML at `GET /api/auth/saml/metadata`, SP signing identity auto-generated once into `saml_sp_config`, signed LogoutRequest redirect, verified LogoutResponse/LogoutRequest round trips that revoke the local session and reply to the IdP, migration 019), **usage-based billing meter** (`GET /api/tenants/:id/billing/meter` snapshot + scheduled reporter POSTing HMAC-signed `billing.usage_snapshot` events to `BILLING_WEBHOOK_URL`, dedupe-friendly period key), **platform-admin SSO overview** (`GET /api/admin/sso` — every workspace's SAML config status + recent `auth.saml_login` activity, never the certificates) | **SLO / meter / admin suites — 505 backend tests** (SQLite **and** PostgreSQL 16) + **27 e2e** |
| **Phase 4 follow-ups** — Menu & media power tools | **Item-level availability schedule** (per-item `HH:MM` window — an enabled item is *hidden* from the storefront and *rejected* at checkout outside its window, incl. overnight windows; migration 020), **bulk edit** (`POST /api/products/bulk` — price / enabled / tags / inventory stock across up to 200 items in one audited request), **category duplication** (deep copy with items, variants & add-ons, `(copy)` suffix), **dietary/merch tags** (`veg · spicy · new · bestseller` badges surfaced on the public menu), **drag-and-drop menu sort** (`POST /api/products/sort` — the storefront reorders instantly), **variant-level stock** (per-variant quantity on hand; over-ordering is rejected with `VARIANT_OUT_OF_STOCK` and successful orders decrement it), and the **image-optimization UI** (`POST /api/uploads/images/:key/optimize` — crop box + 10–95 quality re-encode in place + best-effort CDN cache invalidation) | **Phase 4 suites — 520 backend tests** (SQLite **and** PostgreSQL 16, coverage gate green) + **27 e2e** |
| **Phase 4 follow-ups (2)** — Storefront reorder, variant alerts & schedule preview | **Category drag-and-drop reorder** (`POST /api/menu/categories/sort` — sequential `sort_order` across categories; the storefront menu follows instantly, same pattern as item sort), **variant-level low-stock alerts** (`item_variants.low_stock_at`, migration 021 — a `LOW_VARIANT_STOCK` dashboard alert + nightly-digest entry when a tracked variant hits its own threshold, editable in the size editor with a live “N left” badge) and the **availability preview calendar** (a 7-day strip in the Product form — each weekday's open window drawn on a 24h rail, today highlighted, overnight windows as two segments; “Schedule…” opens a sensible 09:00–22:00 default) | **Reorder / alert / preview suites — 535 backend tests** (SQLite **and** PostgreSQL 16, coverage gate green) + **27 e2e** |
| **Phase 4 follow-ups (3)** — Per-day overrides, storefront scarcity cues & menu bulk organize | **Per-day availability overrides** (`availability_overrides`, migration 022 — one override per item + date that replaces the repeating window: both bounds empty = “closed all day” for a holiday, a windowed override extends/opens hours for an event; enforced on the storefront (hidden outside the effective window) and at checkout, **scheduled orders validated against the scheduled date**; `GET/PUT /api/products/:id/overrides` replace-all editor in the Product form, audited as `menu.availability_overrides`), **storefront scarcity cues** (the public menu now serializes product + variant stock and low-stock thresholds — dishes show “Only N left” urgency, sold-out variants are disabled in the size picker, and zero-stock dishes get a muted “Sold out” state with the add button disabled, EN/বাংলা) and **menu bulk organize** (`POST /api/products/bulk` accepts `category_id` + `available_from`/`available_to` — move up to 200 selected items into a category and stamp an availability window in one audited request; the Products bulk panel gains a “Move to category” picker and a window editor) | **Override / scarcity / organize suites — 542 backend tests** (SQLite **and** PostgreSQL 16, coverage gate green) + **27 e2e** |
| **Phase 4 follow-ups (4)** — Storefront-wide closure days, checkout scarcity & scheduled availability preview | **Restaurant-wide closure days** (`tenant_closure_dates`, migration 023 — one row per tenant + date closes the WHOLE storefront that day: holidays/private events; the public menu returns a `closedToday` flag + hides every item, checkout is rejected with `AVAILABILITY_WINDOW`, and scheduled orders are blocked for the closure date), **recurring weekday rules** (`availability_weekday_rules`, migration 023 — restaurant-wide “closed every Saturday” toggles + per-item weekday rules that replace the base window per weekday, e.g. weekend hours / “closed Mondays”; a `GET/PUT /api/products/:id/weekday-rules` replace-all editor in the Product form + closure-days card in Settings, audited as `menu.weekday_rules` / `menu.tenant_closures`), **storefront closed-today state** (a “We're closed today” ticket banner + add buttons gated), **scarcity cues in checkout + cart** (sold-out lines flagged, qty controls disabled, low-stock “Only N left” chips, submit blocked) and the **scheduled-order availability preview** (`GET /api/public/restaurants/:slug/availability?date=&time=` — per-item availability + reason, restaurant-closed flag; the checkout shows a live preview at the chosen datetime and blocks placement while items are unavailable) | **Closure / weekday / preview suites — 547 backend tests** (SQLite **and** PostgreSQL 16, coverage gate green) + **27 e2e** |
| **Phase 4 follow-ups (5)** — Closure-conflict warnings, next-open countdown & per-dish availability calendar | **Closure-conflict warnings** (`GET /api/tenants/:id/closure-conflicts` — items whose WINDOWED override or weekday rule opens them on a day/weekday the restaurant is closed are flagged with their window; the Settings closure card renders the warnings so the contradiction is visible before saving), **storefront next-open countdown** (while `closedToday`, the public menu computes `nextOpenAt` — a 14-day forward scan of closure dates/weekday closures + the earliest item opening — and the closed banner says “Back open {weekday} at {HH:MM}” instead of a dead end) and the **per-dish availability calendar** (the availability API gains a **windows mode** — `?date=YYYY-MM-DD` returns each item's effective open segments that day (overnight splits, all-day `[{00:00,24:00}]`, `[]` = closed) — and every menu dish has a **“Check times”** button opening a 7-day chip + hourly-slot calendar so customers plan scheduled orders before adding to the cart) | **Conflict / next-open / calendar suites — 551 backend tests** (SQLite **and** PostgreSQL 16, coverage gate green) + **27 e2e** |
| **Phase 4 follow-ups (6)** — Timezone-safe scheduling, merchant closure calendar & schedule-from-calendar | **Timezone-safe scheduling** (a new Intl-based `timezone` util resolves availability windows, closure dates and scheduled orders against the tenant's IANA zone — `PATCH /api/tenants/:id` accepts a validated `timezone` (e.g. `Asia/Dhaka`), the public menu + availability endpoints expose it, and checkout interprets a customer's chosen wall time in the restaurant's clock: `11:30Z` = 17:30 Dhaka), **schedule straight from the calendar** (the per-dish “Check times” modal's slots are now clickable — picking a slot adds the dish to the cart, pre-fills the checkout's scheduled time via URL and jumps straight there), and the **closure day on the merchant calendar** (`GET /api/tenants/:id/closure-calendar?month=YYYY-MM` — a Settings month grid with closure dates in red, recurring weekday closures tinted, and per-day override counts; plus a timezone picker in Settings) | **Timezone / calendar suites — 555 backend tests** (SQLite **and** PostgreSQL 16, coverage gate green) + **27 e2e** |
| **Phase 4 follow-ups (7)** — Schedule the whole cart, customer-timezone display & bulk closure import | **Schedule the whole cart from the calendar** (a new “Schedule my order” button in the storefront cart bar opens a cart-wide date + hour picker — a slot is enabled only when EVERY cart line is orderable that hour, then the chosen instant is server-verified line-by-line before jumping to checkout with the whole cart scheduled), **customer-side timezone display** (the availability endpoints now return the restaurant's IANA `timezone`; when it differs from the customer's browser zone the “Check times” + cart-schedule grids are re-labelled in the customer's own hours — same instants, orders still resolve in the restaurant's clock — with a “Times shown in your timezone · Restaurant runs on …” caption), and **bulk closure import** (closure dates now carry an optional holiday **label** — migration 024; the Settings closure card accepts pasted lists of `YYYY-MM-DD` or `YYYY-MM-DD Holiday name` lines, merges them into the pending list and reports invalid lines) | **Schedule-cart / tz-display / import suites — 557 backend tests** (SQLite **and** PostgreSQL 16, coverage gate green) + **27 e2e** |
| **Phase 5 follow-ups** — Ordering & fulfillment round 2 (migration 025) | **Order editing with an approval flow** (`order_edit_requests` — staff/customer request item changes on a still-live `placed`/`accepted`/`preparing` order; the live order stays immutable until a manager **approves**, which re-prices server-side and rewrites the lines + payment status, or **rejects**; one pending request at a time, public `order-no + phone-tail` request path), **delivery auto-assignment** (`delivery_zones` catalogue + `user_tenants.delivery_zones` rider coverage — a least-loaded **in-zone** rider is auto-assigned on `ready`, never overwriting a manual assignment, with a tenant sweep endpoint), **KDS bump bar + prep timer + overdue** (`orders.bumped_at` + `prep_started_at`; a preparing order is bumped into the pickup bar, the status cell live-ticks elapsed prep time and flags ⚠ **OVERDUE** past 10 minutes), and **cancellation reasons** (`orders.cancel_reason` + `canceled_by` — required on every cancel, surfaced in the Orders list + audit) | **Ordering-fulfillment suite + migrations/drift — 566 backend tests** (SQLite **and** PostgreSQL 16, coverage gate green) + **27 e2e** · frontend build green · `ordering-fulfillment` skill added |
| **Phase 7 round 2** — Analytics maturity (migration 027) | **Custom-range analytics API** (`/api/analytics/*` — `from`/`to`/`timezone`/`channel`/`order_type` filters, span-capped, backend-authoritative; the realtime `/api/dashboard` stays untouched), **conversion funnel** (Browse → Cart → Checkout → Paid over distinct anonymous sessions — localStorage ids + fire-and-forget `POST /public/restaurants/:slug/events`, checkout carries `analytics_session`, POS excluded so conversion can never exceed 100%), **rider performance vs SLA** (deliveries / avg minutes / on-time % / late per rider + totals, sortable), **revenue anomaly alerts** (yesterday vs trailing-14-day baseline per channel segment, configurable thresholds + cooldown dedupe, persisted to audit_logs, nightly + on-demand evaluate), **CSV export for every chart** (`GET /analytics/export.csv?type=` — 10 datasets, RFC-4180 escaping, `<type>-analytics-<from>-to-<to>.csv`), **dashboard filter bar + FunnelChart + rider table + anomaly banners + exports strip** (cashier-safe: sections hide on 403) — full details in [`docs/07-analytics.md`](docs/07-analytics.md) | **Analytics suite — 18 new tests · 621 backend tests green** (53 files) · frontend lint + build green · **27 e2e green** · live API QA 31/31 PASS incl. funnel E2E (menu_view → add_to_cart → checkout_start → paid order linked by session) |

---

## ✨ Features

### Currently working

**The Table Ticket — auth pages (frontend design pass)**
- Sign-in, register, forgot/reset password and email-verify all render as **one ticket**: a deep-green brand stub with a gold-foil ORDERLY wordmark and a ticket number (No. 0041), perforated off with the scalloped tear, and the form sitting on paper below
- Food orbs float behind the stub (the landing's playful motif), and the paper follows the **global paper theme** — warm rice paper in light, ink paper in dark — with a 🌙/☀️ toggle right on the stub; the submit button reads as a gold-foil counterfoil and form fields sit on the paper

**Foundation hardening (Phase 1 completion)**
- **Liveness / readiness probes** — `GET /api/health` answers without touching dependencies (uptime + request id) and `GET /api/health/ready` authenticates the database (200 ok / 503 error), so load balancers and Kubernetes probes have stable endpoints (`/health` stays as a legacy alias)
- **Request-ID + structured logging** — every request gets a UUID echoed in `X-Request-Id` and in every error response; a structured logger (JSON lines in production, readable in dev) writes one line per request (method, path, status, duration, ip) and all internal errors with the same `requestId`, so a failing request can be correlated from log to client in one hop
- **Hot-query indexes** — migration 015 adds `orders(tenant_id, created_at)` and `payments(tenant_id, created_at)` composite indexes covering the dashboard / closeout / reports day-range scans (which previously re-scanned each tenant's whole history)
- **Route-level code splitting** — every frontend page is its own lazy-loaded chunk (React.lazy + Suspense); the initial bundle dropped from >500 kB to ~310 kB (gzip ~101 kB) and the build's chunk-size warning is gone
- **CI hardening** — a **gitleaks secret-scan job** (scans the whole git history, not just the diff) and a **coverage gate** (`npm run test:coverage`, v8 provider) enforcing hard floors on lines / functions / branches / statements

**Multi-tenancy & SaaS operations (Phase 3)**
- Every product, promotion, order, and team membership is scoped to a `tenant_id`; workspace CRUD, team member invites (owner/manager/cashier/kitchen/delivery/staff), plans, subscriptions, feature flags, and usage counters
- `X-Tenant` header switching with fail-closed isolation — cross-tenant reads/writes return 403/404; platform admins see and can operate on every workspace

**SAML SLO, usage billing meter & SSO admin (Phase 3 follow-ups round 2 — migration 019)**
- **SAML single logout (SLO)** — `GET /api/auth/saml/metadata` serves the SP metadata XML (entity ID `orderly.app`, ACS + both SLO bindings, and the SP signing certificate) for IdP registration. The SP signing identity is generated once (node-forge, 2048-bit RSA, singleton `saml_sp_config` row) at first use — the private key never leaves the server. `GET /api/auth/saml/slo?tenant=<slug>&nameId=<email>` builds a **signed LogoutRequest** (redirect binding) against the tenant's `idp_slo_url`; `POST /api/auth/saml/slo` accepts the IdP's LogoutResponse (SP-initiated return) or LogoutRequest (IdP-initiated), verifies the signature **against the configured IdP certificate only** (key-confusion safe, same override as ACS), revokes the session behind the refresh cookie (audited `auth.slo_logout`), and redirects the browser back to `/login?logged_out=1` — or answers an IdP-initiated request with a signed LogoutResponse back to the IdP's SLO endpoint. `idp_slo_url` is a new optional field on the SAML config (`PUT /api/tenants/:id/saml`); SLO init without one returns a clear `SAML_SLO_NOT_CONFIGURED`
- **Usage-based billing meter** — `GET /api/tenants/:id/billing/meter` (owner/platform-admin) returns a metering snapshot: plan code/name/price, subscription state (status, period end, trial end), live usage (products / orders today / members / storage MB) vs plan limits, plus a monotonic UTC `period` key and `reportedAt`. A scheduled reporter (`startBillingReporter()`, default every 6h, `unref()`-ed) POSTs each active/trial tenant's snapshot to `BILLING_WEBHOOK_URL` as `event: billing.usage_snapshot`, signed with an HMAC-SHA256 `X-Billing-Signature` when `BILLING_WEBHOOK_SECRET` is set (5s timeout, fire-and-forget, no-op when the URL is unset); `POST /api/tenants/:id/billing/meter/report` triggers an immediate push for one tenant
- **Platform-admin SSO overview** — `GET /api/admin/sso` lists every workspace with its SAML config status (enabled / IdP entity + SSO/SLO URLs / default role / last updated; **no certificates ever serialized**), plus the most recent `auth.saml_login` events with actor email, workspace and timestamp. The frontend **Admin → SSO** page (`/admin/sso`) renders it as a workspace status table + recent sign-ins panel, gated server-side by `requireRole('platform_admin')`

**Per-day overrides, scarcity cues & menu bulk organize (Phase 4 follow-ups round 3 — migration 022)**
- **Per-day availability overrides** — a new `availability_overrides` table (migration 022) lets every item carry date-specific windows that replace its repeating schedule for a single calendar day: **both bounds empty = “closed all day”** (holiday closures hide the item instantly), while a windowed override opens/extends hours for event nights — same rules as the base window (one-sided + overnight supported). Enforced everywhere the base schedule is: **hidden from the storefront** outside the effective window and **rejected at checkout** with `AVAILABILITY_WINDOW` — and **scheduled orders are validated against the scheduled date**, so a “closed that day” override blocks a scheduled order even when placed during an open window. The API is `GET /api/products/:id/overrides` + a **replace-all** `PUT /api/products/:id/overrides` (validated, deduped, audited as `menu.availability_overrides`), and the Product form has a **date-override editor** (date picker + from/to times, empty window = closed, add/remove rows, saved with the product)
- **Storefront scarcity cues** — the public menu API now returns each item's **inventory stock + low-stock threshold** and each variant's `lowStockAt` (alongside the existing variant `stock`), and the storefront renders honest scarcity: dishes show an **“Only N left”** badge when at/below threshold (or ≤5 untracked), a **“Sold out”** badge with the add button disabled when a tracked dish hits zero, and sold-out variants are disabled in the size picker (checkout still enforces per-variant stock server-side) — EN/বাংলা, paper-theme aware
- **Menu bulk organize** — `POST /api/products/bulk` now also accepts **`category_id`** (tenant-validated; `null` = uncategorise) and **`available_from`/`available_to`** so one audited request can move up to 200 selected items into a category *and* stamp an availability window. The Products bulk panel grows a **“Move to category”** picker (populated from the workspace's categories) and a from/to **availability window** editor alongside the existing price/stock/status/tags controls

**Closure days, checkout scarcity & scheduled availability preview (Phase 4 follow-ups round 4 — migration 023)**
- **Restaurant-wide closure days** — a new `tenant_closure_dates` table (migration 023) closes the **whole storefront** for a date (holidays, private events): the public menu returns a `closedToday` flag and hides every item behind a **“We're closed today”** ticket banner, checkout is rejected with `AVAILABILITY_WINDOW`, and scheduled orders are blocked for the closure date (validated against the scheduled date, same as overrides). Managed from a **Closure days** card in Settings (`GET/PUT /api/tenants/:id/closures`, audited as `menu.tenant_closures`) — one-off date pickers + add/remove rows
- **Recurring weekday rules** — `availability_weekday_rules` (migration 023) covers repeating patterns two ways: **restaurant-wide weekday closures** (“closed every Saturday” toggles in the same Settings card, `GET/PUT /api/tenants/:id/weekday-closures`) and **per-item weekday rules** that replace the base window for a specific weekday (weekend hours, “closed Mondays”). Resolution order at any instant is **closure date → per-item weekday rule → per-day override → base window**, enforced everywhere (storefront hidden + checkout rejected + scheduled-order check). The Product form gains a **weekday-rules editor** (Sun–Sat rows with from/to times, 🚫 = closed that weekday, clear = fall back to base), `GET/PUT /api/products/:id/weekday-rules`, audited as `menu.weekday_rules`
- **Scarcity cues in checkout + cart** — the storefront cart and checkout now render the same honest stock story as the menu: sold-out lines are flagged (“Sold out — remove it to continue”), their quantity controls are disabled, and placement is blocked; low-stock lines show **“Only N left in stock”** chips — all EN/বাংলা and paper-theme aware
- **Scheduled-order availability preview** — a new public endpoint `GET /api/public/restaurants/:slug/availability?date=YYYY-MM-DD&time=HH:MM` answers whether the restaurant is closed at an instant and whether each item is orderable, with the *reason* (restaurant_closed / weekday_closed / closed_today / window / open). When a customer picks a scheduled pickup/delivery time, the checkout fetches it and shows a live per-line preview — “X won't be available then” — and blocks placement while any item is unavailable, so a “closed that day” or out-of-window surprise never happens after filling the whole form

**Closure-conflict warnings, next-open countdown & per-dish availability calendar (Phase 4 follow-ups round 5)**
- **Closure-conflict warnings** — `GET /api/tenants/:id/closure-conflicts` scans the workspace's closure dates and weekday closures against every item's windowed per-day overrides and weekday rules: anything that would open an item on a day the restaurant is closed is reported with its window (items closed by their own empty override/rule are consistent and never flagged). The **Closure days** card in Settings fetches it on load and renders the conflicts inline — “Opens on a closed day: Kacchi Biryani (10:00–18:00)” — so the contradiction is visible *before* saving, with a plain-language fix hint
- **Storefront next-open countdown** — while the restaurant is closed, the public menu computes `nextOpenAt`: a 14-day forward scan skipping closure dates and weekday closures, returning the earliest instant any enabled item opens (or now if already open). The **“We're closed today”** banner turns into a plan: **“Back open Mon at 11:00”** — customers see when to return instead of a dead end
- **Per-dish availability calendar** — the public availability API gains a **windows mode**: `?date=YYYY-MM-DD` (no `time`) returns each item's effective open segments for that day — overnight windows split into two segments, all-day items report `[{00:00,24:00}]`, closed days `[]`. Every dish row on the storefront gains a **“Check times”** button that opens a calendar modal: seven day chips + an hourly slot grid colored by the open windows, with a “Restaurant closed this day” / “Not orderable this day” / “All day” summary — so customers can plan a scheduled pickup or delivery before adding anything to the cart

**Timezone-safe scheduling, merchant closure calendar & schedule-from-calendar (Phase 4 follow-ups round 6)**
- **Timezone-safe scheduling** — a new dependency-free `timezone` util (Intl-based) resolves every availability rule against the tenant's configured IANA zone: availability windows, closure dates, the next-open scan and *scheduled orders* all read the restaurant's wall clock. `PATCH /api/tenants/:id` accepts a validated `timezone` (bogus zones → 400), the public menu and availability endpoints expose it, and checkout interprets the customer's chosen wall time in the restaurant's timezone — `11:30Z` is 17:30 Dhaka, and a 17:00–19:00 window accepts the former and rejects the latter. Until a timezone is set, everything behaves exactly as before (server-local), so the change is invisible to existing workspaces
- **Schedule straight from the calendar** — the per-dish “Check times” modal slots are now actionable: tapping an open slot adds the dish to the cart with the options chosen, pre-fills the checkout's scheduled pickup/delivery time, and navigates straight to the ticket — no more copying times by hand
- **Closure day on the merchant calendar** — Settings gains a month view (`GET /api/tenants/:id/closure-calendar?month=YYYY-MM`): closure dates in red ✕, recurring weekday closures tinted ⟳, per-day override counts badge — the whole month's availability posture at a glance, with prev/next month navigation and a timezone picker that saves through the same validated endpoint

**Schedule the whole cart, customer-timezone display & bulk closure import (Phase 4 follow-ups round 7 — migration 024)**
- **Schedule the whole cart from the calendar** — the storefront cart bar gains a **“📅 Schedule my order”** button that opens a cart-wide date + hour picker: a slot is green only when *every* item in the cart is orderable that hour (per-dish windows, weekday rules, overrides and restaurant closures all respected), tapping one server-verifies the instant line-by-line via the instant availability endpoint, shows a ✓/✗ per line, and only then jumps to checkout with the whole cart scheduled — one time for the entire order, not dish-by-dish
- **Customer-side timezone display** — the availability endpoints now return the restaurant's IANA `timezone` alongside the windows. When it differs from the customer's browser zone, the “Check times” and cart-schedule grids are re-labelled in the customer's own hours (neighbouring restaurant days are fetched so a customer day that straddles two restaurant days is fully covered). The instants are unchanged and orders still resolve in the restaurant's clock; a caption shows “⏰ Times shown in your timezone · Restaurant runs on …”. The new client-side `frontend/src/utils/timezone.js` mirrors the backend util (Intl-based, no dependency)
- **Bulk closure import** — closure dates can now carry an optional holiday **label** (`tenant_closure_dates.label`, migration 024 — presentational only, never read by availability resolution). The Settings closure card accepts a pasted list, one per line: `YYYY-MM-DD` or `YYYY-MM-DD Holiday name` (e.g. `2026-12-25 Christmas Day`). Valid dates merge into the pending list (deduped, first label wins), invalid lines are reported inline, and labels show next to each date row + in the month-calendar tooltips

**Storefront reorder, variant alerts & schedule preview (Phase 4 follow-ups round 2 — migration 021)**
- **Category drag-and-drop reorder** — `POST /api/menu/categories/sort` persists an ordered category-id list as sequential `sort_order` values (tenant-scoped, unknown ids ignored, audited as `menu.categories_sorted`). The Menu page's category rows are draggable (⠿ handle, dashed drop target) and the **storefront category order updates instantly** — verified live: reversing the KFC-Dhaka categories reordered the public menu
- **Variant-level low-stock alerts** — `item_variants.low_stock_at` (migration 021, NULL = no alert) mirrors the product-inventory semantics: when a tracked variant's `stock` drops to or below its threshold, the **dashboard pushes a `LOW_VARIANT_STOCK` warning alert** (“Zinger Burger — Regular · 2 left”) and the **nightly merchant digest** lists the variant with its parent product. The size editor in the item modal accepts Stock + Low-at inputs, shows a live “N left” danger badge for variants at/under their threshold, and the `PUT /api/menu/variants/:id` API accepts `lowStockAt`
- **Availability preview calendar** — the Product form now draws a **7-day strip** beneath the window inputs: each weekday renders the item's open window on a 24h rail (filled segment = orderable, overnight windows as two segments), with **today highlighted** and a “Same window every day · 09:00 → 22:00” caption. “Schedule…” opens a sensible 09:00–22:00 default (previously a no-op), “All-day” clears it back to a full rail

**Menu & media power tools (Phase 4 follow-ups — migration 020)**
- **Item-level availability schedule** — every item can carry a `HH:MM` orderable window (`available_from` / `available_to` on `menu_items`): outside the window an enabled item is **hidden from the storefront menu** and **rejected at checkout** with `AVAILABILITY_WINDOW` (staff orders included). Bounds are compared against the restaurant's local clock; `from > to` means an **overnight window** (22:00→04:00 stays orderable past midnight), and one-sided windows (only `from` or only `to`) are supported. `NULL` bounds = all-day. The Product form has a time-picker editor (All-day ⇄ Schedule)
- **Bulk edit + category duplication** — `POST /api/products/bulk` applies price / enabled / tags / inventory stock across **up to 200 items in one audited request** (optimistic-lock version bumps on price/VAT writes, quota-safe). `POST /api/products/categories/:id/duplicate` deep-copies a category with all its items, **variants and add-ons** (fresh ids, `(copy)` suffix). The Products page gains a **Bulk edit** toolbar: check rows → set price / stock / status / add tags → Apply
- **Dietary & merchandising tags** — `tags` (JSON) on each item: `veg · spicy · new · bestseller`, rendered as badges on the storefront menu and filterable through the normal product APIs; unknown values are dropped at write time (a single string is accepted as one tag)
- **Drag-and-drop menu sort** — `POST /api/products/sort` persists an ordered id list as sequential `sort_order` values (tenant-scoped, unknown ids ignored). The Products page rows are draggable (⠿ handle) and the public menu + admin list reorder instantly
- **Variant-level stock** — `item_variants.stock` (NULL = unlimited / inherits the product). Checkout rejects quantities beyond the variant's stock with `VARIANT_OUT_OF_STOCK` (“Only 2 × Large left”), and a successful order **decrements** the variant stock (best-effort, floored at zero, never fails an order). Stock is editable in the variant editor and surfaced on the storefront
- **Image optimization UI** — `POST /api/uploads/images/:key/optimize` re-processes an uploaded WebP **in place**: optional crop box (`x/y/width/height` px) + 10–95 quality re-encode (out-of-range clamped), re-uploaded to the same object key and followed by a best-effort **CDN cache invalidation** (`invalidateCdn` — no-op without a `CDN_BASE_URL`, logs the purge intent when one is set). The Product photo field has an **Optimize** panel (quality slider + crop inputs + “Re-process & purge CDN”) showing the resulting dimensions/bytes. The storage layer gained `getObject` for the read-modify-write path (local + S3 drivers)

**Enterprise SSO, quota alerts & trial expiry (Phase 3 follow-ups — migration 018)**
- **SAML 2.0 SSO (MVP)** — `GET /api/auth/saml/init?tenant=<slug>` builds an SP-initiated AuthnRequest (redirect binding — deflate + base64url) against the tenant's IdP; `POST /api/auth/saml/acs` accepts the SAMLResponse (HTTP-POST form binding, JSON accepted for programmatic clients), inflates + parses it, and **verifies the XML signature against the certificate configured on the tenant — never a certificate embedded in the assertion** (`getCertFromKeyInfo` is overridden so an attacker's self-signed cert can't pass — verified by tests for key confusion, tampered bodies and missing signatures). The assertion's validity window is checked, the email/name are pulled from the configured attributes (`attribute_email`/`attribute_name`, NameID fallback), a workspace member is provisioned find-or-create with the configured default role, `email_verified_at` is set (SSO is strong auth — no email gate), and a normal session is issued (refresh cookie + access token, audited as `auth.saml_login`). IdP-initiated responses resolve the tenant by matching the response Issuer to a config's `idp_entity_id`. Config lives at `GET/PUT /api/tenants/:id/saml` (owner view, platform-admin edit; the certificate is never serialized back — only `hasCertificate`), and the login page has an **SSO sign-in** box (workspace slug → init URL → IdP → back to `/sso/success`). Uses `xml-crypto` 6 + `xml2js`; test certificates are generated with `node-forge`
- **Quota-exceedance alerts** — after any quota-affected write, `notifyQuotaIfCrossed` recomputes live usage vs the plan limits and, when a metric crosses an un-stamped 80/90/100% threshold, fires a **WhatsApp webhook** (`event: quota.warning`, HMAC-SHA256 `X-Webhook-Signature` when a secret is configured, 5s timeout, fire-and-forget) **and** a **ticket-styled owner email** with a usage meter. Stamping is per-(metric, threshold) per calendar day — a jump from 70% to 100% fires one alert, not a 100→90→80 cascade — and the alert path never rejects the request that triggered it
- **Trial-expiry sweep** — `startTrialExpirySweeper()` runs every minute: subscriptions still `trialing` past `trial_ends_at` are moved to Free (tenant `plan_id` + subscription row), audited as `tenant.trial_expired`, and the owners get a **ticket-styled upgrade nudge email** (what the trial plan gave vs what Free keeps) + a WhatsApp push. Idempotent — a status flip guard means only one sweep can downgrade a given subscription, and the sweeper is `unref()`'d so it never holds the process open. Settings shows a **trial-ending banner** (⏳ days remaining / trial ended) on the Plan & usage card

**Multi-tenant hardening (Phase 3 completion — migration 017)**
- **Plan quota enforcement** — migration 017 adds quota columns to `plans` (`max_products`, `max_orders_per_day`, `max_members`, `storage_mb`) and seeds the catalogue (Free 20/50/2/100MB · Starter 100/300/5/500MB · Pro 500/1000/15/2GB · Growth 2000/5000/50/10GB); `planService` counts live usage (products/members via COUNT, orders-per-day + storage via atomic `usage_counters`) and every write is gated **before** it happens — a 21st product, the Nth+1 order of the day, a 3rd member or an over-quota upload returns `429 QUOTA_EXCEEDED` with `current/limit` numbers, and a failed request never consumes quota. Gates are wired into product create + CSV/XLSX import, staff + storefront order placement (idempotency-safe: retries never double-count), member invites/adds, and image uploads
- **Settings → Plan & usage** — live meters for menu items / orders today / team members / storage, plan + subscription status (trial/renews dates); platform admins get a plan picker (`PATCH /api/tenants/:id/plan`) that swaps the plan and subscription in one call, audited as `tenant.plan_changed`
- **Expiring team invites** — `POST /api/tenants/:id/invites` creates a **token invite** (raw token shown exactly once; only its SHA-256 hash is stored) with a 1–30 day expiry; `GET` lists them, `DELETE` revokes, and `GET /api/invites/:token` gives a public-safe preview. Accepting (`POST /api/invites/accept`) works **logged-out** (creates the account + membership in one call) or **logged-in** (email must match), enforces the password policy and the member quota at accept-time, and is single-use (expired/revoked/used → clear 410/409 errors). The `/accept-invite/:token` page renders in the same torn-off ticket identity as sign-in
- **Ownership transfer** — `POST /api/tenants/:id/transfer-ownership` hands the workspace to another member: the new owner gets the role, the old owner steps down to manager, and it's audited with both user ids; only the current owner (or a platform admin) can transfer
- **Tenant audit-log UI** — `GET /api/tenants/:id/audit` (paginated, filterable by action) exposes the tenant-scoped trail — member added/removed, invite created/revoked/accepted, ownership transferred, plan changed, status changed — with actor name + IP + timestamp, rendered in a **Workspace activity** card in Settings

**Authentication, RBAC & security (Phase 2)**
- Register / login / verify-email / password-reset flows · rotating refresh tokens (httpOnly, SameSite cookie) with **session revocation + reuse detection** · optional **TOTP 2FA**
- Role-based access control (platform_admin / owner / manager / cashier / kitchen / delivery) with permission-gated routes and fine-grained `req.userHas()` checks · auth audit logging · **registered customers honor granted workspace roles** — an owner can invite a customer-created account (cashier/kitchen/manager/…) and the tenant membership outranks the account-level `customer` role (verified by an end-to-end new-user order-flow test)
- CSRF protection (Origin / `Sec-Fetch-Site` verification) · Helmet headers · CORS allowlist · rate limiting · zod validation · centralized error envelope with request IDs

**Auth hardening (Phase 2 completion — migration 016)**
- **Failed-login lockout** — after **5 wrong passwords** an account locks for **15 minutes** (`423 ACCOUNT_LOCKED` with `details.retryAfterSeconds`; the correct password is refused too); the counter resets on a successful sign-in or an admin unlock; unknown emails never lock (nothing to brute-force), and login stays timing-safe (dummy-hash compare). Every failure/lock/unlock lands in the audit trail with the attempt count
- **Login audit trail + active sessions UI (Settings)** — **Login activity** renders the recent security events (sign-ins, failures, lockouts, refreshes, logouts, password changes, 2FA, forced resets) with IP + timestamp; **Active sessions** lists every device (friendly browser/OS label, IP, expiry, “This device” badge) with per-session **Sign out** and a one-tap **Sign out all other devices** (`POST /api/auth/sessions/revoke-others` revokes every family but the caller's)
- **Password policy + forced change** — the policy now requires **8–128 chars with uppercase + lowercase + a digit**; `POST /api/auth/change-password` verifies the current password, enforces the policy and signs out every other device; admins can **force a password reset** per member (`POST /api/auth/users/:id/force-password-reset`) — the member's sessions are killed and their next sign-in is **gated through `/change-password`** (`mustChangePassword` flag) before the app unlocks
- **Permission-level RBAC** — a granular **permission catalogue** (`refund:orders`, `manage:inventory`, `view:reports`, `manage:billing`, …) extends the role matrix, and each **user_tenants row can carry per-user flags** (`['refund:orders', '-view:reports']`) — a leading `-` **denies** what the role grants, a positive flag **grants** beyond the role; `hasPermission`/`requirePermission`/`req.userHas` all honor the overrides (flags are validated against the catalogue and never widen platform admins). The **Settings → Team & access** panel (manager+) edits roles, flags, unlock and force-reset per member
- **Refund gate** — refunds now require **`refund:orders` (manager/owner)**: a cashier can confirm/fail payments but a refund attempt returns `403 FORBIDDEN` — the exact “refund only manager” rule, applied server-side on `PATCH /api/payments/:id`

**Storefront checkout (Phase 5 completion)**
- **Customer journey** — the public storefront (`/m/:slug`) is now a real ordering surface: browse → item options modal (variants + add-ons, live price) → cart (quantities, remove) → **checkout** (`/checkout?r=<restaurant>`): order-type selector, customer info, delivery address (delivery only), schedule picker (scheduled only, past/invalid → error), payment method → place → **confirmation + tracking link** — all mobile-friendly and EN/বাংলা
- **Server-side pricing only** — `POST /api/public/restaurants/:slug/checkout` re-prices every line from the DB (never trusts client totals), validates availability/quantity/empty cart, computes delivery fee + discounts, and creates the order + payment + items in one transaction; a payment failure never leaves a half-created order
- **Idempotency-Key** — the `Idempotency-Key` header (guests + staff) makes double-clicks, network retries, and payment-callback retries safe: a DB-unique `idempotency_keys` row (tenant + user + key, request-hash verified) stores the response, so concurrent duplicate submissions resolve to the **same** order instead of creating two; expired keys are swept automatically
- **Order types** — `pickup` (default) / `delivery` (address required, per-tenant fee, enabled per workspace) / `scheduled_pickup` / `scheduled_delivery` (future window validation) — the same types flow into the merchant Orders list, filters, closeout and WhatsApp alerts
- **Delivery orders** — managers/owners assign any delivery order to a delivery-role member (`PATCH /api/orders/:id/assign`), reassign or unassign freely; the Orders page shows a Rider column + per-order assign dropdown (only delivery staff listed), and delivery-role users see their assigned orders; the lifecycle adds `out_for_delivery` between `ready` and `delivered` (delivery role only), while pickup orders keep working untouched
- **Kitchen accept / reject** — kitchen/manager can **accept** (`placed → accepted`) or **reject** with a required reason (`placed → rejected`); rejected orders never continue into preparation, the customer is notified, and manager cancel keeps working on `placed`/`preparing`
- **Real-time kitchen queue** — a JWT-authenticated WebSocket hub (`/ws`, `ws` package, zero extra infrastructure) broadcasts `order.created` / `status_changed` / `assigned` to the workspace room; connections authenticate with the access token and subscribe to the **active workspace** (`?tenant=` mirrors the REST `X-Tenant` priority — switching workspace in the UI switches the room), role-gated to viewers of orders, with heartbeat, exponential-backoff reconnect and a resync-on-connect refetch; the existing 30s polling stays on as fallback whenever the socket is down (e.g. Redis-less offline, proxy failure)
- **Orders UI** — Status column with color-coded badges + one-click advance/accept/reject/cancel actions, Rider column + assign dropdown, real-time queue indicator (● live / ○ reconnecting), tenant-scoped and **RBAC-aware buttons** (the action set mirrors the backend matrix exactly: cashier sees only payment confirmation, kitchen sees fulfill/accept/reject, delivery sees deliver, owner/manager see advance + cancel + assign — roles never see buttons that would 403)
- Server-side pricing with per-item discount, subtotal, discount, and grand total

**Order editing, delivery auto-assign, KDS & cancellation reasons (Phase 5 follow-ups — migration 025)**
- **Order editing with an approval flow** — `order_edit_requests` (migration 025): staff or a customer can request changes to a still-live order (`placed`/`accepted`/`preparing`) — add, remove or re-quantify lines with a reason. The live order stays **immutable** until a manager **approves** the request, which re-prices the whole cart server-side (`priceCart`), rewrites the `order_items`, recomputes `payment_status` (and variant stock), and publishes a realtime update — or **rejects** it, leaving the order byte-for-byte unchanged. One pending request per order (a second submit is `409 EDIT_REQUEST_PENDING`). Customers can request edits from the public track page using order-no + phone-tail auth (`POST /orders/:orderNo/edit-request`). The Orders list gets an **Edit** action opening a modal with line-item steppers, add-a-product, and — for managers — inline **Approve/Reject** on the pending banner
- **Delivery auto-assignment by zone + rider load** — a `delivery_zones` catalogue plus `user_tenants.delivery_zones` rider coverage (Settings → **Delivery zones & riders**): when a delivery order reaches `ready` it's auto-assigned to the **least-loaded in-zone** rider (a rider with no zones covers everything). Manual assignments are never overwritten; `POST /orders/auto-assign` sweeps the whole queue; every assignment is published as `order.assigned`
- **KDS bump bar + prep timer + overdue** — `orders.prep_started_at` is stamped when the kitchen moves an order to `preparing`; `POST /orders/:id/bump` pushes it into the pickup bar (`ready`, idempotent). The Orders status cell **live-ticks the elapsed prep time** and flags a danger **⚠ OVERDUE** badge past 10 minutes, so the kitchen sees at a glance what needs attention
- **Cancellation reasons** — `orders.cancel_reason` + `canceled_by` (migration 025): every cancel now requires a reason (the Orders page prompts first), which lands in the audit trail and is surfaced in the list
- **Offline submit queue** — the storefront checkout parks an order in `localStorage` (`oms.pending.<slug>`) with its own Idempotency-Key when the request can't reach the server, shows a **“Order saved offline”** ticket, and **auto-replays** it the moment the browser comes back online — the key guarantees the retry can never double-create or double-charge

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
- **"The Table Ticket" storefront design** — the QR-scanned menu renders like a hand-held ticket from this product's own world: a brand-themed **stub hero** carries the 🪑 table number as a real gold-foil stub (perforated edge, dashed border) above a **scalloped CSS tear** that separates "this table" from "the menu"; the menu itself sits on **paper** with quiet dish slips — **Bricolage Grotesque** display type, **chilli-red prices**, gold accents, dashed ticket-divider section heads (── BURGERS · 6 ──), a live OPEN dot, a staggered dish reveal + popping cart bar (reduced-motion aware), **animated food orbs floating behind the stub** (🍔🍟🍕🍗🥤, reduced-motion aware) — and **paper comes in two kinds**: warm **rice paper** (light) or deep **ink paper** (dark), chosen with a 🌓 paper toggle in the stub (auto-follows the device, light and dark pins; `oms.storefront.paper` in localStorage) so the ticket keeps one identity in both app themes while the tenant brand still themes the stub, chips, buttons and cart
- **Ticket checkout + confirmation** — the customer never leaves the ticket they tore off the menu: the checkout page (`/m/:slug/checkout`) opens with the same brand stub + food orbs + scalloped tear, and the order form renders as **ticket cards** with dashed ticket-divider section heads, ticket-toggle order types, paper payment rows, a **wallet "send money" panel** (copyable number + trxID), the ⇄ split-payment / per-diner editors restyled to the paper, a chilli-red total row, and a **confirmation stub** that lands with a little bounce and stamps the order number as a **gold-foil ticket stub** (`ticket-done__no`) with the total and each split part — all sharing the paper theme + EN/বাংলা
- **Track-order ticket** — the customer tracking page (`/track`) is the same hand-held ticket: an Orderly brand stub with floating food orbs, scalloped tear and the **order number stamped as a gold-foil stub pill** when the live status loads, then the lookup form and the 4-step progress / items / total as ticket cards on paper (the paper toggle rides along via `usePaperTheme`, so a customer's 🌓 choice follows menu → checkout → confirmation → tracking)
- **Ink-paper merchant invoice** — the order invoice (`/orders/:id/invoice`) renders as the **merchant's copy of the ticket** in its ink-paper form: a gold-foil brand stub torn off the top (scalloped tear), a deep ink-green sheet with sage ink, dashed ticket rows for items and payments, and a chilli-red grand-total tile — while `@media print` flips the sheet to a clean white ink-on-paper invoice for printing/PDF
- **QR table cards as tickets** — the merchant's table list (`/tables`) renders every QR card as a mini hand-held ticket: a brand stub band carries the table number as a **gold-foil stub**, scalloped with the same perforation tear, and the QR sits on clean white so scanners read it first; the printable A4 QR sheet keeps a light ticket-strip header
- **Ink-paper diner receipt + kitchen ticket** — the per-diner receipt (`/orders/:id/split/receipts/:paymentId`) and its kitchen order ticket are the same ink-paper sheet as the invoice: a gold-foil brand stub (with a gold **KITCHEN** badge on the KOT), dark ink-green paper with sage ink, dashed ticket rows and a chilli-red payable — on screen and in the backend's print-ready HTML (which flips to white for thermal/A4 printing)
- **Ticket-styled order confirmation email** — when a customer leaves an email at checkout (new optional field, stored on the order via migration 014), the platform emails them the same hand-held ticket: a gold-foil brand stub with the order number, the scalloped tear, dashed item rows, a chilli-red total and a **Track your order** button — fully inline-styled for every mail client, HTML-escaped, fire-and-forget (never blocks order creation), sent through the existing SMTP/stub mailer
- **Print CSS for the storefront ticket** — the menu, checkout and confirmation print as one clean light slip: the stub becomes a light gray band (still perforated), orbs/toggles/chips drop out, and the paper body keeps its dashed dividers + chilli totals — in both paper themes — with a **tear-off QR coupon** (public `GET /api/public/restaurants/:slug/qr?table=N` → scannable SVG) printed under the ticket so the customer can scan and order again next visit
- **Ink-paper split panel** — the cashier's dine-in split-parts panel (SplitBillModal) renders as the same ink-paper sheet: ticket-toggle mode tabs (item / equal / custom), diners as paper slips with dashed dividers, and chilli-red / gold alerts — form fields stay light so they read clearly on the dark sheet
- **Status-update ticket emails** — when an order reaches a customer-facing milestone (`preparing` / `ready` / `out_for_delivery` / `delivered`), the customer who left an email gets the same hand-held ticket with the new status **stamped on the stub** (🛍️ Ready — please collect / 🛵 Out for delivery / ✅ Delivered) plus the items, total and a Track button — fire-and-forget from the status route, items fetched internally
- **Paper toggle on the invoice** — the merchant invoice sheet defaults to ink-paper but now has a **🌙 Ink paper / ☀️ Rice paper** toggle in the header, so staff can preview the ticket on both papers before printing (the printed sheet stays clean white either way)
- **Ink-paper dashboard** — the merchant dashboard (`/dashboard`) is now the **merchant ledger**: on dark paper the whole page becomes a deep ink-green ledger with a **gold-foil “Daily ledger” stub** (workspace name + today’s date, scalloped tear), ink sheets for every card, sage ink, dashed ticket dividers and chilli-red money — every chart adapts automatically (all CSS-variable driven) and a **🌙 Ink paper / ☀️ Rice paper** toggle in the header flips the ledger exactly like the invoice
- **Ticket-styled closeout email** — the nightly **Daily closeout** email (and its browser→PDF view) is now the same hand-held ticket: a gold-foil brand stub with the date stamped on it, the scalloped tear, the day’s totals as dashed ticket stat tiles, revenue-by-method and the orders table as dashed ticket rows, plus the 🥇 top-sellers / ⚠️ low-stock digest — it still carries the CSV attachment and prints as clean white ink-on-paper
- **Global paper theme context** — the paper preference is now one app-wide `PaperThemeProvider` (auto → light → dark, persisted in localStorage): the storefront ticket, the merchant ledger and the invoice all read the same choice, so flipping the 🌓 toggle anywhere follows you everywhere (menu → checkout → confirmation → tracking → dashboard → invoice)
- **PDF the ticket email** — the order confirmation (and status-update) emails now carry the ticket as a **printable PDF attachment** (`order-<no>.pdf`), drawn with pdfkit: gold-foil stub, scalloped tear, dashed item rows and a chilli-red total — no browser needed server-side, text is Latin-sanitized for glyph safety, and a PDF hiccup never blocks the email (it falls back to HTML-only)

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

**WhatsApp order alerts + customer status notifications (Phase 5)**
- **Webhook** — with WhatsApp enabled + a `webhookUrl` (Twilio, WATI, Infobip or any gateway), every new order is POSTed as JSON (`event: order.created` with order no, table, customer, items, total) authenticated by an optional Bearer secret; **fire-and-forget** with a short timeout — a dead gateway never delays or breaks order creation
- **Customer status notifications** — with **Notify customers on status change** on, every status move POSTs an `order.status_changed` event carrying the customer's phone + a **bilingual (EN/BN) message** (`🛎️ Your order is being prepared #…` / `🛎️ আপনার অর্ডার তৈরি হচ্ছে #…`) — the gateway texts the customer; gated on the order having a customer phone
- **wa.me manual flow** — Settings → WhatsApp lets merchants set their number, toggle alerts, and hit **Send test alert** (posts a test payload or returns the manual `wa.me` link when no webhook is set); the Orders list shows a **💬 WhatsApp** action per order that opens a pre-filled message for that exact order
- Config lives in `tenant.settings.whatsapp`, validated (phone + URL), and only the public-safe `{ enabled, number }` whitelist leaves the API in the tenant list

**bKash/Nagad payment records (Phase 5)**
- **`payments` table** (migration 008) + `orders.payment_method` — every order auto-creates a payment record at placement: **cash → paid on the spot**, **bKash/Nagad/card → pending** until a cashier confirms it with the gateway **transaction ID** (`PATCH /api/payments/:id`, tenant-scoped, `place:orders` RBAC); refund/fail flips the order's `payment_status` back
- **Per-tenant payment methods** — Settings → Payment methods: enable **Cash / bKash / Nagad / Card** and set the receiving numbers (bKash/Nagad); order creation validates the method against the workspace's enabled set (fail-closed `INVALID_PAYMENT_METHOD`, cash is the default), and the **New Order page** shows only the enabled methods + an optional trxID field
- **Revenue by method** — the merchant dashboard now breaks down paid revenue by payment method (Cash / bKash / Nagad / Card) over the last 7 days; demo orders seed realistic payment records (trxIDs included)

**SSLCommerz / Stripe / bKash gateway integration (Phase 5/6)**
- **`paymentGateway` service** — env-configured (`PAYMENT_GATEWAY=sslcommerz|stripe|bkash` + provider credentials, no hardcoded secrets) behind a **provider registry** (one `createSession` per gateway); creates a **hosted checkout session** for `online` orders and verifies the **signed webhook callback** before marking a payment paid (SSLCommerz md5 signature / Stripe `Stripe-Signature` HMAC / bKash callback → **execute** round-trip) — `/api/webhooks/*` mounts before the JSON body parser
- **Graceful fallback** — if no gateway is configured, `online` orders fail with a clear `PAYMENT_GATEWAY_NOT_CONFIGURED` error (and `online` stays disabled per-tenant until enabled in Settings → Payment methods); the New Order page shows **Online (SSLCommerz)** only when the workspace enables it and returns `paymentUrl` on success for redirect

**Gateway sandbox harness + test-mode E2E (Phase 5/6)**
- **`npm run gateway:sandbox`** — a dev-only local mock of **all three** gateways on `http://localhost:4321` (SSLCommerz `POST /gwprocess/v4/api.php` + Stripe `POST /v1/checkout/sessions` + bKash `POST /tokenized/checkout/{token/grant,create,execute}`) that computes the **real signatures** (md5 / HMAC-SHA256) from your `.env` secrets and fires the signed webhook at the backend — so the full online-payment loop runs with zero external credentials; `--auto` confirms instantly, otherwise it serves a clickable **Pay now** page per session
- **`npm run gateway:e2e`** — boots the real backend on a scratch DB pointed at the sandbox and drives the complete loop for **all three gateways** (order → pending + `paymentUrl` → confirmation → **paid**), exiting 0 only when all pass; the CI suite mirrors it (`gateway.test.js` + `stripeFlow.test.js` + `bkashFlow.test.js`)
- To try it live: `PAYMENT_GATEWAY=stripe` (or `sslcommerz` / `bkash`) + `SSLCOMMERZ_API_URL`/`STRIPE_API_URL`/`BKASH_API_URL` pointing at the sandbox in `backend/.env`, then run the two commands above

**Daily closeout report (Phase 5)**
- **`GET /api/reports/closeout?date=YYYY-MM-DD`** — one day's reconciliation view (Dhaka UTC+6 day bounds): totals (orders, canceled, paid revenue, pending, refunded, avg order), **revenue by payment method**, and the full order list
- **`GET /api/reports/closeout.csv`** — the same day as a downloadable CSV (`closeout-YYYY-MM-DD.csv`) for matching against the physical register / bKash app statement; **Reports** page in the nav has a date picker, stat cards, per-method breakdown and CSV download button (EN/বাংলা)
- **`GET /api/reports/closeout.pdf`** — the same day as a **print-ready HTML** view (🖨️ Print / PDF button) — the browser's Save-as-PDF gives a real PDF with perfect Bangla rendering (no heavyweight PDF dependency)
- **`POST /api/reports/closeout/email`** — emails the day's closeout (HTML summary + **CSV attachment**) to the workspace's configured address (or your own); **nightly auto-send** via the scheduler — Settings → Daily closeout email: recipient + auto-send toggle + Dhaka hour; each active workspace gets **yesterday's** report once per day (idempotent via `lastCloseoutSentDate`)
- **Split-payment breakdown (Phase 6)** — the JSON now carries a `split` object (`orders` count, `revenue` from paid parts, and `parts` — every split part with method/label, amount, status, **diner note** + trx **reference**); the CSV appends a `SPLIT PARTS` section (only when the day had split orders — a normal day's CSV is byte-identical) with the exact rows the cashier matches against the wallet statement; the print/PDF view renders a **Split payments** table (order · diner · method · amount · status · ref); the nightly email inherits all of it

**Real mail provider (Phase 5)**
- **`MAIL_DRIVER=stub|smtp`** — `stub` (default) logs emails in dev/test with zero config; `smtp` sends **real mail through any SMTP server** (Gmail app password, Zoho, Mailgun/SES/Resend SMTP, self-hosted Postfix…) via **nodemailer** (lazy transport, reset after a failed send so one outage never poisons later sends, loud config errors when `SMTP_HOST` is missing)
- Covers the same interface as before — email verification, password reset, and the nightly closeout all go through it; the SMTP suite drives a real SMTP conversation (`smtp-server`, nodemailer's own test server) and asserts the delivered MIME including the base64 CSV attachment
- **`GET /api/dashboard?days=7|30`** now also returns a **closeout trend**: per-**Dhaka-day** revenue/orders with a per-day **payment-method mix** (cash/bKash/Nagad/card/online), plus **trend stats** — total revenue, average per day, best day, and the day-over-day delta/%; the dashboard has a 7/30-day toggle and a new stacked method-mix chart (dependency-free SVG, same chart kit)
- **Forecast (Phase 6)** — the same endpoint now returns a **`forecast`** object: a trailing **7-day moving average** per day (dotted baseline on the chart) and a **3-day linear-regression projection** (dashed extension past the last actual, blended 40/60 with the moving average to tame outliers), plus **`monthOverMonth`** — this Dhaka month's paid revenue vs the previous month with a % delta; the dashboard shows the projected next-3-days revenue and a “vs last month” stat row

**VAT compliance report (Phase 6)**
- **`GET /api/reports/vat?from=YYYY-MM-DD&to=YYYY-MM-DD`** (JSON) + **`/vat.csv`** — splits **VAT-inclusive** sales into **VAT + net per menu item** using each item's own `vat_rate` (migration 009, default 5%; some items at 15% — `menu_items.vat_rate`, overridable per workspace via `settings.vat.defaultRate`); VAT = gross × rate/(100+rate), the Bangladesh NBR convention; totals (gross/VAT/net), per-item rows, CSV with a TOTAL footer — Reports page has a range picker, summary cards and a VAT CSV button (EN/বাংলা); hardened edge cases: a **0% VAT-exempt** default is preserved (net = gross) and **inverted `from > to` ranges return 400** instead of a misleadingly empty report
- **Nightly merchant digest (Phase 6)** — the nightly closeout email now embeds **top sellers + low-stock inventory** sections, and the same digest is pushed to the WhatsApp webhook as a **`digest.daily` event signed with HMAC-SHA256** (`X-Webhook-Signature`) when a secret is configured — the owner sees the day's winners and what to reorder first thing in the morning

**Payments — Phase 6 completion (bKash adapter, split, refund, reconciliation, invoice)**
- **bKash Tokenized Checkout adapter** — the gateway registry (`paymentGateway.js`) now serves **SSLCommerz + Stripe + bKash** behind one `createSession` interface: `PAYMENT_GATEWAY=bkash` grants a cached id_token → creates a payment (`bkashURL`) → the customer's browser is redirected to `GET /api/webhooks/bkash/callback` → the backend **executes** the payment (the real verification — an unsigned callback is never trusted) and marks it paid with the returned trxID; env `BKASH_APP_KEY/APP_SECRET/USER_NAME/PASSWORD/SANDBOX/API_URL/CALLBACK_URL` (sandbox default, `BKASH_SANDBOX=0` for live); manual trxID counter-confirm stays available
- **Split payments** — `POST /api/orders` accepts an optional `payments` array (per-part method/amount/trxID); each part validated fail-closed against the workspace's enabled methods (online excluded), parts must sum to the grand total (`SPLIT_MISMATCH` otherwise); one payment row per part (cash paid on the spot, wallets pending); `payment_status` is **recomputed across all payments** (`paid / partial / pending / refunded`); New Order page has a **⇄ Split payment** editor with a live remaining readout; closeout + dashboard method-mix count each part in its bucket (migration 010)
- **Storefront split payments** — the public checkout (`POST /api/public/restaurants/:slug/checkout`) accepts the same `payments` array, so a **customer** can split an order (e.g. part bKash + part cash) at checkout: each part validated against the workspace's enabled methods + the exact server-computed total, one payment row per part, split orders settle as `paid / partial / pending`; the checkout page shows a **⇄ Split payment** toggle (only when ≥ 2 non-online methods are enabled) with per-method amount inputs + a live remaining readout; the customer tracking page now shows **Partially paid** (আংশিক পরিশোধিত) instead of a misleading Unpaid for split orders; covered by backend split tests + Playwright split e2e (API + full UI flow)
- **Wallet payment UX (Phase 6)** — the public menu now exposes the merchant's **wallet receiving numbers** (`checkout.walletNumbers`, public-safe — gateway credentials and internal settings never leave); the checkout shows **“Send money to 01711… (Copy)”** with a **trxID field** when a wallet method is selected — in single, split-amount AND per-diner modes every wallet part can carry its transaction ID, so the cashier confirms the exact trxID instantly (the merchant sees it on the payment row / closeout)
- **QR table bill-split by diner** — the split editor gains a **By diner** mode (⇄ Split payment → By diner): assign each cart item to a diner, give each diner a name + payment method, and their share (their items + an equal delivery-fee portion, rounding to the last diner) is computed automatically; every part is sent with its diner's name as the part `note` (stored on the payment row's `notes` — `payments[].note` accepted by both the public checkout and staff order validators), the confirmation card lists each part with its diner, and the cashier sees who paid which part; e2e drives a full QR-table (with `?table=`) two-diner bKash + cash split through the browser
- **Refunds (full/partial) with audit trail** — `PATCH /api/payments/:id` accepts `{ status: 'refunded', amount?, reason? }`; only collected payments refund (`REFUND_NOT_ALLOWED`); stamps `refunded_amount/at/reason/by` **and** an append-only `audit_logs` entry (`payment.refunded`); partial refunds keep their retained portion as collected (order settles at paid/partial/refunded); closeout revenue is payment-accurate; Orders list shows **↩ Refund** on paid rows
- **Payment reconciliation** — online gateway intents get an `expires_at` window at creation (default 30 min); the per-minute scheduler flips stale pending `online` payments to **expired** and re-syncs the order (→ unpaid) — manual wallet payments are deliberately untouched
- **VAT-aware order invoices** — `GET /api/orders/:id/invoice` returns a per-item VAT split (NBR convention), totals, and the **linked payment records** (method/amount/status/trxID/refund) — split orders show each part; `?print=1` renders the print-ready HTML (browser Save-as-PDF); Orders list → **🧾 Invoice** opens `/orders/:id/invoice` with a Print/PDF button
- **`npm run seed:payment-demo`** — idempotent seeder adding a **Split Demo** (bKash + cash), a **Split Bill Demo** (three diners split by item with per-diner parts + allocation rows — so the split panel, diner receipts and split-method analytics chart are live immediately) and a **Refunded Demo** order per workspace

**Payments — Phase 6 round 2: verification, delivery tips, settlements, NBR invoice, refund UI (migration 026)**
- **bKash callback-execute verification + idempotent auto-confirm** — an unsigned callback is **never trusted**: the backend performs a server-side `execute` round-trip and only marks the payment `paid` when `transactionStatus === 'Completed'` **and** the returned amount matches the payment exactly. The transition `pending → paid` is atomic and idempotent — an already-paid payment is never double-confirmed (a replay of the callback, webhook or verification is a no-op). The payment row stores `payment.gateway` plus a `verification_metadata` snapshot (verifying amount, method, verifiedAt) for the reconciliation trail. If the callback loop ever breaks, `POST /api/payments/:id/verify` (`place:orders`, bKash only) re-runs the same execute + amount check manually — so a stuck pending payment can always be reconciled at the counter
- **Delivery tips** — `orders.tip_amount` (migration 026): a tip is accepted for **delivery** order types only (pickup tips are rejected), clamped by `normalizeTip` to ৳100,000 / 2 decimal places, and **charged as part of the grand total** — so the gateway/wallet payment includes the tip (a ৳1,000 delivery order + ৳50 fee + ৳200 tip creates a ৳1,250 payment). Tips are **never VAT-able** and never count as food revenue; they appear as their own **Tip** line in the invoice totals and in the closeout. UI: the storefront checkout shows a tip field for delivery orders; the merchant **New Order** page has the same with an order-type selector
- **Settlements & wallet balance** — `GET /api/settlements/balance` derives the merchant wallet from the **ledger, not a table**: `Σ paid online payments − refunds − settled amounts`. A workspace can request a **settlement** (amount + method) and track its history with a `pending → processing → completed` advance; Settings gains a **Settlements** card with balance tiles, the request form and the history list (gated `manage:billing`)
- **NBR invoice supplier block + QR (Mushak-6.3-ready)** — the invoice now renders the **registered supplier identity**: `registeredName`, `address` and a validated **13-digit BIN** read from `tenant.settings.vat.*` (Settings → **Invoice / NBR** card edits them + the default VAT rate; the BIN input is digit-only with 13-digit validation). A **QR code** (data-URL generated backend-side — the frontend needs no QR library) sits on the sheet as an **identity-only** code (invoice no, order no, amount, date) — additive convenience, no national QR-compliance claim, never secrets or PII
- **Full/partial refund UI** — the Orders list's ↩ Refund now opens a real **`RefundModal`** (no more `window.prompt`): it loads the refund ledger via `GET /api/payments/:id/refunds`, offers full or partial amounts with a required reason, shows remaining-vs-already-refunded badges and the refund history — gated by the same `refund:orders` (manager+) permission the backend enforces

**Dine-in split billing — per-diner receipts + cashier split panel (migration 013)**
- **Cashier split-parts panel** — every dine-in order (physical table) gets a **⇄ Split bill** action (cashier/manager — the action mirrors the backend's `place:orders` gate, kitchen/delivery never see it). The panel (`SplitBillModal`) supports **three split modes**: **By item** (assign each order item's quantities to diners — a live matrix with `−/+` steppers, per-line remaining readouts and a full-allocation guard), **Equal** (payable divided evenly, rounding handled by the server) and **Custom** (per-diner amounts); every diner gets a label, payment method and (for wallets) a trxID field. A **TOTAL ORDER vs SUM OF SPLITS** reconcile bar must hit zero before the split can be applied; over/under-allocation, mismatched sums and disabled methods are rejected client-side and re-verified server-side
- **Server-authoritative money math** — `splitService.computeSplitParts` recomputes every amount in **integer paisa** (the app's precision strategy): item shares use each line's real `line_total`/discount proportionally, the delivery fee splits equally (last diner absorbs rounding), and **largest-remainder rounding** guarantees the parts sum to the order's grand total EXACTLY; custom splits must match to the paisa (`SPLIT_MISMATCH`); the frontend only ever shows a preview — the payload it sends is re-priced and re-validated
- **Payment integration** — a split replaces the order's payment rows with **one `payments` row per diner** (cash → paid on the spot, bKash/Nagad → pending with the trxID, confirmed via the existing `PATCH /api/payments/:id`); `payment_status` recomputes across all parts (`paid / partial / pending`); `order_split_items` records the per-diner item allocation (denormalised snapshot — survives product edits/soft-deletes). **Guards:** canceled/rejected orders, refunded payments, non-cash collected parts and gateway intents all block re-splitting (`409 SPLIT_LOCKED`) — a POS-level “start over” (`DELETE /api/orders/:id/split`) restores a single honest cash row; every split/clear writes an `audit_logs` entry with the before/after parts, inside the same transaction
- **Per-diner receipts** — `GET /api/orders/:id/split/receipts/:paymentId` (+ `?print=1` for the **print-ready HTML**) builds one diner's receipt from the STORED allocation: restaurant, table, order no, date/time (Dhaka), diner label, assigned items (qty × unit), discount, **per-item VAT** (NBR: line × rate/(100+rate)), net, payable and the payment method/status/trxID — with an explicit rounding-adjustment line when per-line rounding leaves a paisa residue. The Orders list shows each part as a chip (**Diner · amount · status**) with a **🧾 Receipt** link; `/orders/:id/split/receipts/:paymentId` renders the narrow thermal-friendly sheet (also A4/print-PDF, Bangla-safe)
- **Split-method analytics chart** — `GET /api/dashboard` now returns `splitAnalytics`: split **usage by method** (equal / item / custom / unsplit, counts + %), **revenue per method** (paid parts — a split order's revenue is counted ONCE across its parts, so closeout/VAT stay unduplicated), **avg diners per split order**, **avg per diner**, and the **payment-method mix within split orders** (e.g. Cash ৳400 + bKash ৳350 + Card ৳250 = ৳1,000, never ৳3,000). The dashboard renders it as a **Split-method donut** (reusing the dependency-free SVG chart kit) with per-method % and revenue in the legend
- **API** — `GET/POST/DELETE /api/orders/:id/split` (view:orders / place:orders, tenant-scoped, zod-validated, transactional) — the same conventions as the invoice/status routes; split parts remain **payment rows**, so the daily closeout, revenue-by-method, VAT report and dashboard method mix are automatically split-aware (each part lands in its own method bucket, one order = one revenue figure)
- **Re-split lock surfaced in the panel** — the split state (`GET /api/orders/:id/split`) now reports `locked` + `lockReason` using the same rule the write paths enforce (gateway intent / refunded row / collected wallet part). When real money has moved, the cashier panel shows a **🔒 guard banner** with the exact reason (“A collected bkash payment blocks re-splitting — refund it first”) and **disables Apply**, so the cashier never attempts a change that the backend would reject
- **Split parts in the cashier closeout** — the Reports page now renders the day's **split-payment parts table** (order · diner/part · method · amount · status · trxID reference) directly on screen (matching the JSON/CSV/PDF views) when the day had split orders, so the register reconciles against wallet statements without downloading anything
- **Per-diner kitchen ticket (KOT)** — `GET /api/orders/:id/split/receipts/:paymentId/kot` (+ `?print=1` for the nav-free sheet) serves each diner's **kitchen order ticket**: table, order, diner label and the assigned items with big quantities — **deliberately no prices/VAT/payment** (a KOT is not a bill), built from the stored allocation so it always matches the receipt. The diner receipt page gets a **🧾 Receipt / 🍳 Kitchen ticket** toggle with a print button for both sheets
- **One-tap diner preset** — the Orders list shows **👥 2 · 3 · 4 · 5** quick buttons next to ⇄ Split bill on dine-in orders; one tap opens the split panel already in **Equal mode with N diners** (cash, adjustable), reconcile bar live — the most common table split takes a single tap instead of four
- **Locked-split demo seed** — `npm run seed:payment-demo` also provisions a **Locked Split Demo** dine-in order per workspace (bKash-accepting only): an equal split whose bKash part is already **collected at the counter**, so the 🔒 re-split guard banner + disabled Apply are visible on a fresh install without any manual cashier flow
- **Tests** — `splits.test.js` (20 cases: equal/custom/item math, over/under-allocation, disabled methods, duplicate-submission replacement, wallet-collected lock **+ locked/lockReason state**, unlocked all-cash state, canceled-order lock, split clearing, discount + VAT allocation, receipt after product soft-delete, RBAC 403, cross-tenant 404, analytics aggregation) + three **Playwright specs** that log in as a real cashier — one splits a dine-in order across 3 diners in the browser (reconcile → apply → receipt **+ KOT** → dashboard donut), the second drives the panel against an order with a **collected bKash part** and asserts the lock banner + disabled Apply, and the third taps the **👥 3 quick preset** and checks the panel opens with 3 diners reconciled

**Customer order tracking (Phase 5)**
- **`GET /api/public/track?orderNo=&phone=`** — public, unauthenticated lookup that returns only a **privacy-safe whitelist** (status, table, payment status, total, restaurant name/slug, items) — never the customer phone, address, or internal fields; wrong order no / phone returns a uniform `404` (no enumeration)
- **Track Order page** (`/track`) — EN/বাংলা form + progress stepper (Placed → Preparing → Ready → Delivered) with live status; linked from the public storefront footer, and the merchant app keeps its own authenticated views

**Phase 7 — Analytics (completion)**
- **Peak-hours heatmap** — `GET /api/dashboard` now returns `peakHours`: a 7 (Sun-first) × 24 (Dhaka hour) grid of order volume + paid revenue, zero-filled, with `maxOrders`/`maxRevenue` for scaling and a **busiest-slot insight** (e.g. *“Sun 13:00 — ৳3,540”*); the dashboard renders it as an intensity heatmap with hover readouts and a slow→busy legend, plus a busiest-slot badge
- **Category mix** — paid line items grouped by the menu category (soft-delete-safe join, `Uncategorized` fallback) with revenue / quantity / share %; rendered as a palette donut + legend
- **Customer retention** — 30-day repeat-customer rate, avg order value, and top customers by revenue with **masked phone numbers** (privacy-safe even for the merchant's own view)
- **Fulfillment time** — average placed → delivered minutes per order type (pickup/delivery; `updatedAt` approximation documented until a status-history table lands)
- **Live order queue** — the dashboard's open orders (placed/preparing/ready) with order no, table, customer, total, **minutes open** and item totals — **auto-refreshes every 30s** (silent reload, mounted-ref safe)
- **Dashboard alerts** — structured, severity-tagged banners: **low stock** (items at/below their restock threshold with inline chips), **high cancellation rate** (7-day rate > 15%, volume-gated to avoid noise), and **idle hours** (no order for 2+ hours) — rendered localized (EN/বাংলা)
- **Platform-admin cross-tenant analytics** — `GET /api/admin/analytics` (`requireRole('platform_admin')`): workspace counts by status, 7/30-day SaaS revenue curve, top 10 restaurants by paid revenue, platform-wide method mix; the `/admin` page (nav link only for platform admins) renders stat cards, trend chart, top-restaurant bars, method-mix rows and status badges
- **Nightly rollup layer** — migration **011** adds `daily_stats` (one row per tenant + Dhaka day: revenue, orders, method mix, sparse peak-hours map); the boot scheduler upserts yesterday hourly, `npm run db:rollup` backfills any window, and `GET /api/dashboard?source=rollup` serves the trend + heatmap from the rollup (live fallback when rows are missing)
- **6-month performance acceptance** — `npm run perf:seed` builds a scratch 6-month dataset (3 tenants × 180 days × 10 orders + line items + payments, weighted Dhaka hours) and `npm run perf:test` benchmarks `GET /api/dashboard` (7/30-day live + rollup), exiting non-zero if any p95 ≥ 2000ms — **measured locally: worst p95 = 279ms** ✅
- **`npm run seed:analytics`** — idempotent demo data for the new sections: 14 days × 5 orders at realistic Dhaka hours, a repeat-customer phone pool, delivered orders with 18–45 min fulfillment gaps, payment-method mix, and low-stock inventory rows (so the heatmap, retention, fulfillment and alerts are all alive on a fresh install)

**Design system**
- Deliveroo-inspired UI: theme engine with light/dark mode + design tokens, shared UI kit (Button, Card, Input, Table, Modal, Toast, Skeleton, Badge, EmptyState…), workspace switcher, glassy navbar, playful motion (bounce, lift, shimmer). See [`docs/06-design-system.md`](docs/06-design-system.md)

**PostgreSQL foundation & data migration (Phase 1–4)**
- Versioned migration runner (`npm run db:migrate` / `db:migrate:down` / `db:migrate:status`) with migrations 001–013; dialect-selectable DB config (`DB_DIALECT` / `DATABASE_URL`, default SQLite); PostgreSQL 16 service in `docker-compose.yml`; migrations run at boot on both dialects
- Every Sequelize model maps to migration tables/columns (`tableName` + `field` mappings) — the app runs unchanged against a *migrations-only* database on SQLite **and** PostgreSQL (v1 `sync()` bridge removed), guarded by a drift test and a dedicated PG CI job
- **v1 → v2 data migration** — `npm run db:migrate:v1 -- --source data.sqlite` copies legacy data into the migrated schema (id maps, `password → password_hash`, DECIMAL conversion, order/status remapping) with blocking verification: row-count parity, money invariants, FK integrity
- **Production cutover runbook** — [`docs/04-pg-cutover-runbook.md`](docs/04-pg-cutover-runbook.md): backup → dry-run → migrate → copy → verify → flip → rollback

**Dhaka seed data (Phase 3)**
- `npm run seed:restaurants` provisions 20 data-driven restaurant workspaces (KFC, Pizza Hut, Domino's, Chillox, Sultan's Dine, Star Kabab, Madchef, Takeout, Handi, and more) with 89 realistic menu items **and 12 QR tables each** — idempotent, rerunnable

**End-to-end tests (Playwright)**
- `cd frontend && npx playwright test`: boots the real API on a scratch DB + the Vite app and drives login, product CRUD, order creation, storefront checkout + split payments, **the cashier dine-in split-billing journey** (split → reconcile → apply → diner receipt → dashboard), and the fulfillment UI through the actual browser · runs in CI (dedicated `e2e` job; the harness raises `RATE_LIMIT_MAX` so full browser suites never trip the API limiter)

### Roadmap (V2)
Deeper analytics (retention cohorts, funnel, delivery perf) · SaaS admin portal · hardening (performance, observability, load) · production release.

> Full audit and phased roadmap: [`docs/01-codebase-audit.md`](docs/01-codebase-audit.md) · [`docs/02-v2-roadmap.md`](docs/02-v2-roadmap.md) · [`docs/03-database-schema.md`](docs/03-database-schema.md)

---

## 📸 Screenshots

> Live captures from the running app (Deliveroo-inspired design system, light & dark). Re-capture anytime with `cd frontend && node scripts/screenshots.mjs` while the dev servers are up — the script logs in as the seeded admin and captures every page below, auto-selecting the workspace that has demo data so no shot is ever empty.

### Phase 3 — Multi-tenant SaaS platform

| | |
|---|---|
| **Register** — create an account | **Login — light mode** |
| ![Register](docs/screenshots/register-light.png) | ![Login light](docs/screenshots/login-light.png) |
| **Login — dark mode** | |
| ![Login dark](docs/screenshots/login-dark.png) | |

### Phase 4 — Menu, media & analytics

| | |
|---|---|
| **Landing page** — CRAV-style animated hero (light) | **Landing — dark mode** |
| ![Landing](docs/screenshots/landing-light.png) | ![Landing dark](docs/screenshots/landing-dark.png) |
| **Public storefront — "The Table Ticket"** (QR-scan first touch: stub hero, table stub, scalloped tear, rice-paper menu) | **Public storefront — rice paper (light)** |
| ![Public storefront ticket](docs/screenshots/public-menu-ticket-light.png) | ![Public storefront light](docs/screenshots/public-menu-light.png) |
| **Public storefront — ink paper (dark)** with the food-orb stub | |
| ![Public storefront ink paper](docs/screenshots/public-menu-ink-paper.png) | |
| **Merchant Menu** — Wolt/Deliveroo-style grouped categories | **Promotions** — offers manager |
| ![Menu](docs/screenshots/menu-merchant-light.png) | ![Promotions](docs/screenshots/promotions-light.png) |
| **Products — light mode** | **Products — dark mode** |
| ![Products light](docs/screenshots/products-light.png) | ![Products dark](docs/screenshots/products-dark.png) |
| **Dashboard** — closeout trend + 3-day forecast + month-over-month | |
| ![Dashboard](docs/screenshots/dashboard-light.png) | |

### Phase 5 — Ordering & fulfillment (checkout + delivery + realtime)

| | |
|---|---|
| **Storefront with cart** — add items, live totals, checkout bar | **Guest checkout — the order ticket** (stub hero, ticket cards, gold-foil order no) |
| ![Storefront cart](docs/screenshots/storefront-cart-light.png) | ![Checkout](docs/screenshots/checkout-light.png) |
| **Checkout — ink paper (dark ticket)** | |
| ![Checkout ink paper](docs/screenshots/checkout-ink-paper.png) | |
| **QR table menu** — each table a mini ticket (gold-foil stub + scalloped tear, QR on white) | **Customer tracking** — the lookup ticket |
| ![QR menu](docs/screenshots/qr-menu-light.png) | ![Tracking](docs/screenshots/track-light.png) |
| **Track a live order** — status ticket (light) | **Track a live order — ink paper (dark)** |
| ![Track ticket light](docs/screenshots/track-ticket-light.png) | ![Track ticket ink paper](docs/screenshots/track-ticket-ink-paper.png) |
| **Settings** — storefront branding editor, payment methods & WhatsApp | |
| ![Settings](docs/screenshots/settings-light.png) | |

### Phase 6 — Payments (live captures)

| | | |
|---|---|---|
| **Orders** — Split/Partial badges, ↩ Refund, 🧾 Invoice actions | **Reports** — daily closeout + VAT compliance (NBR-ready) | **Order invoice** — per-item VAT split + linked payments |
| ![Orders — Phase 6](docs/screenshots/orders-phase6-light.png) | ![Reports](docs/screenshots/reports-light.png) | ![Invoice — Phase 6](docs/screenshots/invoice-phase6-light.png) |
| **Invoice — ink-paper sheet** (merchant's copy of the ticket; prints as clean white ink-on-paper) | **New Order** — split-payment editor (bKash ৳ + Cash ৳ per part) | |
| ![Invoice ink paper](docs/screenshots/invoice-ink-paper.png) | ![Split editor — Phase 6](docs/screenshots/neworder-split-light.png) | |

### Dine-in split billing — cashier panel, per-diner receipts & analytics

| | | |
|---|---|---|
| **Split Bill panel — ink-paper** (ticket-toggles, paper slips, chilli alerts) | **Diner receipt — ink-paper** (gold stub, sage ink, chilli payable; prints white) | **Dashboard** — split-method analytics donut (equal / item / custom / unsplit) |
| ![Split panel](docs/screenshots/split-billing-panel-ink-paper.png) | ![Diner receipt](docs/screenshots/diner-receipt-ink-paper.png) | ![Dashboard split](docs/screenshots/dashboard-split-light.png) |
| **Closeout** — split-payment parts table (order · diner · method · amount · status · trxID) | **Orders** — one-tap 👥 diner presets next to ⇄ Split bill | **Kitchen ticket — ink-paper** (gold KITCHEN badge, items + quantities only) |
| ![Closeout split parts](docs/screenshots/reports-split-parts-light.png) | ![Quick diner preset](docs/screenshots/orders-quick-diner-preset-light.png) | ![Diner KOT](docs/screenshots/diner-kot-ink-paper.png) |

### Phase 7 — Analytics (live captures)

| | |
|---|---|
| **Dashboard** — live queue + alerts, peak-hours heatmap, category mix, retention & fulfillment | **Platform admin** — SaaS-wide view (revenue curve, top restaurants, method mix, tenant status) |
| ![Dashboard — Phase 7](docs/screenshots/dashboard-light.png) | ![Admin analytics — Phase 7](docs/screenshots/admin-analytics-light.png) |

### Phase 8 — The Table Ticket everywhere (live captures)

| | |
|---|---|
| **Dashboard — ink-paper ledger** (gold “Daily ledger” stub, ink sheets, sage ink, chilli money) | **Closeout email — ticket** (nightly digest: gold stub + date stamp + dashed ticket rows) |
| ![Dashboard ink paper](docs/screenshots/dashboard-ink-paper.png) | ![Closeout email ticket](docs/screenshots/closeout-email-ticket.png) |

### Phase 2 hardening — auth & RBAC (live captures)

| | |
|---|---|
| **Settings — Security, Active sessions, Login activity & Team & access** (lockout, per-device sign-out, audit trail, per-user permission flags) | **Change password** — self-service & admin-forced reset flow |
| ![Auth hardening — Settings](docs/screenshots/auth-hardening-settings.png) | ![Change password](docs/screenshots/auth-change-password.png) |

### The Table Ticket — auth pages (frontend design pass)

| | |
|---|---|
| **Sign-in ticket — rice paper** (gold-foil ORDERLY stub, ticket number, scalloped tear, food orbs, gold counterfoil button) | **Sign-in ticket — ink paper** (the same ticket in the global dark paper theme; 🌙 toggle on the stub) |
| ![Auth ticket — light](docs/screenshots/auth-ticket-light.png) | ![Auth ticket — ink](docs/screenshots/auth-ticket-ink.png) |

### Multi-tenant hardening — plans, invites & activity (live captures)

| | |
|---|---|
| **Settings → Plan & usage** (plan badge, trial/renews dates, live quota meters, platform-admin plan picker) | **Invite accept ticket** (workspace/role preview + account creation, in the same torn-off ticket identity) |
| ![Plan & usage](docs/screenshots/tenant-plan-usage.png) | ![Invite accept](docs/screenshots/tenant-invite-accept.png) |

### Enterprise SSO, quota alerts & trial expiry (live captures)

| | |
|---|---|
| **Sign-in ticket with SSO box** (workspace-slug SSO entry under the form — same torn-off ticket identity) | **Platform admin → SSO overview** (every workspace's SAML status + recent SSO sign-ins) |
| ![SSO login ticket](docs/screenshots/sso-login-ticket.png) | ![Admin SSO overview](docs/screenshots/admin-sso-overview.png) |

---

## 🧱 Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20 · Express · Sequelize · SQLite (dev, default) → PostgreSQL 16 (V2) · pg · versioned migrations · JWT · zod · sharp · @aws-sdk/client-s3 · multer · csv-parse · exceljs · qrcode |
| Frontend | React 18 · Vite 7 · Axios · React Router 7 · Playwright (e2e) |
| Security | Helmet · express-rate-limit · bcrypt · otplib (2FA) · strict CORS · CSRF origin checks |
| Quality | Vitest · Supertest · ESLint · GitHub Actions CI (6 jobs incl. MinIO + PG + gateway sandbox) |
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
│   │   ├── routes/           # auth, products, promotions, orders, menu, uploads, public, dashboard, tables, payments, webhooks, reports
│   │   ├── services/         # payments, gateway, whatsapp, tenant, storage
│   │   ├── utils/            # promotion engine, pagination
│   │   ├── test/             # Test environment setup
│   │   └── __tests__/        # 52 suites · 603 tests  │   ├── migrations/           # Versioned schema migrations (001–013)
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
├── .github/workflows/ci.yml  # CI pipeline (6 jobs)
└── docs/                     # Audit + roadmap + architecture docs
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js **20+** (see `.nvmrc`)
- npm 10+

### Fastest path (one command from the repo root)

```bash
npm install --prefix backend && npm install --prefix frontend   # first time only
npm run seed:demo    # optional: bootstrap the demo dataset (admin + 20 restaurants + order history)
npm run dev          # starts backend (:4000) + frontend (:5173) together
```

Open http://localhost:5173 and sign in with `admin@oms.dev` / `Str0ngPass!42` (overridable via `SEED_PASSWORD`). Ctrl+C in the terminal stops both servers.

> Repo-root scripts: `dev` / `dev:backend` / `dev:frontend` · `seed:demo` · `db:migrate` · `db:migrate:status` · `test:backend` · `test:e2e`. The full list lives in `package.json` at the root.

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

**Run the full backend suite against your local PostgreSQL** (the CI PG tier, without Docker) — catches PostgreSQL-only bugs the SQLite suite can't (e.g. migration 012's table-lock self-deadlock):

```bash
npm run db:pg:test              # scratch DB → migrations → full suite → cleanup
npm run db:pg:test -- --keep    # keep the scratch DB after a failure for debugging
# env overrides: PG_ADMIN_URL (default postgres://postgres:postgres@localhost:5432/postgres), PG_TEST_DB
```

The script creates a throwaway `oms_local_test` database (dropped afterwards unless `--keep`), runs the real migration runner, then the entire backend test suite against it — **603 tests on PostgreSQL** in CI-identical fashion.

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

Uses your installed Chrome locally (`channel: 'chrome'`) — CI installs its own Chromium. The suite covers login, product CRUD, order creation, the fulfillment UI, the public storefront menu, **and the full guest checkout journey** — browse menu → cart → pickup/delivery/scheduled checkout → order → tracking — plus negative cases: server-side pricing ignores client-submitted totals, the same `Idempotency-Key` never duplicates an order, unknown products / bad quantities are rejected, the public tracking API is phone-verified and privacy-safe, and the confirmation track link pre-fills the tracking form and auto-loads live status (regression-tested). All specs run against a real scratch backend + Vite app.

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
npm test                      # Vitest — 603 tests across 52 suites (2 skipped locally)
npm run test:coverage         # with coverage report
npm run lint                  # ESLint

cd frontend
npm run lint                  # ESLint
npm run build                 # production build
npx playwright test           # browser-level e2e suite
```

Coverage highlights: promotion engine (all discount types, date windows, best-discount selection), full auth lifecycle (register, verify, login, refresh rotation + reuse detection, logout, password reset), TOTP 2FA, RBAC + tenant isolation (cross-tenant 403/404, ID injection, suspended/archived workspaces, role switching, **registered-customer → granted cashier role**), CSRF rejection, order creation with promotions + **fulfillment workflow** (role denials, invalid skips, cancel rules, cross-tenant isolation), DELETE endpoints, public menu caching (ETag/304), image pipeline, bulk import (CSV + XLSX, mixed success, duplicate policies, **soft-delete resurrection**), **optimistic-lock version conflicts (409)**, inventory, dashboard aggregates, VAT report edge cases (**0% default preserved, inverted range → 400**), nightly digest (**webhook payload carries the workspace slug**), S3 storage round-trip, v1→v2 migration parity, and models↔migrations drift.

---

## 🔄 CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs on every push/PR to `master`, **every night** (03:00 UTC = 09:00 Dhaka, so the PostgreSQL tier re-validates master daily and drift never survives the week), and on demand — **6 parallel jobs**:

1. **Backend:** `npm ci` → lint → test → `npm audit --audit-level=high`
2. **Backend — PostgreSQL 16:** real `postgres:16` service → `db:migrate` → `db:migrate:status` → full suite with `DB_DIALECT=postgres` → seed + production-mode boot smoke
3. **Backend — S3 driver vs MinIO:** runs a MinIO server in-process → bucket setup → real S3 driver round-trip tests
4. **Backend — gateway sandbox E2E:** boots the real backend on a scratch DB pointed at the local sandbox and drives the full online-payment loop for **all three** gateways — SSLCommerz, Stripe and bKash (order → paymentUrl → signed webhook → paid)
5. **E2E — Playwright:** installs Chromium → boots scratch backend + Vite → browser suite (login, product CRUD, order creation, public storefront menu, guest checkout journey)
6. **Frontend:** `npm ci` → lint → build → `npm audit` (informational)

One live run is kept per branch/PR — a superseded run cancels the one before it (`concurrency` + `cancel-in-progress`), so a wedged stale run can never hold the PostgreSQL service containers and starve the fresh run's jobs. The workflow also exposes a `workflow_dispatch` trigger so CI can always be run manually (`gh workflow run ci.yml`) even when GitHub's webhook events are delayed.

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
| **5** | Ordering & fulfillment | **✅ Shipped:** **customer storefront checkout** (cart → checkout → confirmation + tracking), **order types** (pickup / delivery / scheduled pickup / scheduled delivery), **delivery assignment** (assign/reassign, delivery-filtered views, `out_for_delivery`), **kitchen accept/reject** (reason-required), **Idempotency-Key** retry safety, **real-time WebSocket kitchen queue** (auth + tenant-room isolation + reconnect resync, 30s polling fallback), order status workflow (role-gated transitions, cancel rules), EN/BN i18n, QR table menus, table-aware orders, order filters, WhatsApp alerts + customer status notifications, customer tracking, closeout trend dashboard | ✅ **Done** |
| **6** | Payments | **✅ Shipped:** bKash/Nagad/cash **payment records**, **SSLCommerz/Stripe/bKash gateway integration** (hosted checkout, signed webhooks + callback-execute, sandbox harness + 3-gateway E2E in CI), **daily closeout** (JSON + CSV + print/PDF + nightly email), **split payments** (multi-method per order, payment-status recompute, split editor), **full/partial refunds** (audit trail: amount/at/reason/by + audit_logs), **payment reconciliation** (stale online intents auto-expire), **VAT-aware order invoices** (per-item VAT split + linked payments + print/PDF), **`seed:payment-demo`** — **round 2 (migration 026):** **bKash callback-execute verification + idempotent auto-confirm**, **delivery tips**, **settlements + wallet balance**, **NBR invoice supplier block + QR**, **full/partial refund UI** | ✅ **Done** |
| **7** | Analytics | **✅ Shipped:** peak-hours heatmap (7×24 Dhaka grid + busiest slot), category-mix donut, customer retention (repeat rate + avg order value + masked top customers), fulfillment-time stats (placed → delivered per type), live order queue + dashboard alerts (low stock / cancellations / idle), platform-admin cross-tenant analytics, **nightly rollup layer** (`daily_stats` + `?source=rollup`) + **6-month perf test** (<2s p95 — measured 279ms), `seed:analytics` demo data · ⬜ Next: retention cohorts, funnel, delivery perf | ✅ **Done** |
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
- [`docs/07-analytics.md`](docs/07-analytics.md) — Phase 7 analytics maturity: date/channel/order-type filters, conversion funnel, rider SLA performance, revenue anomaly alerts, CSV export

---

## 🤝 Contributing

1. Fork the repo and create a feature branch from `master`
2. Run `npm run lint` and `npm test` (backend) before pushing
3. Open a pull request — CI (6 jobs) must pass

---

## 📄 License

Private / internal — all rights reserved.
