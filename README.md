# Order Management System

> A production-ready **Restaurant SaaS Platform** — multi-tenant ordering, menus, orders, fulfillment, and analytics for hundreds of restaurants across Bangladesh.

![CI](https://github.com/SadManFahIm/Order-management-system/actions/workflows/ci.yml/badge.svg)

The Order Management System is evolving from a single-tenant order CRUD app into a commercial, cloud-based **restaurant ordering SaaS** for the Dhaka market (KFC, Pizza Hut, Domino's, Chillox, Sultan's Dine, Star Kabab, Madchef, and hundreds more — all data-driven, never hard-coded). This repository is the **V2 platform**: security hardening, multi-tenancy, RBAC, engineering tooling, testing, CI/CD, and a growing customer-facing storefront — built incrementally on the existing, working v1 features.

**Current status:** Phases 1–5 **done** ✅ (Phase 5 = ordering & fulfillment: **customer storefront checkout** — browse → cart → checkout → order → tracking, **pickup / delivery / scheduled pickup / scheduled delivery** order types, **delivery assignment + out_for_delivery lifecycle**, **kitchen accept/reject** with reason, **database-backed Idempotency-Key** retry safety, and a **JWT-authenticated WebSocket real-time kitchen queue** with 30s polling fallback; plus the earlier Phase 4 rounds: XLSX import, soft delete + optimistic locking, public menu pagination, inventory, merchant dashboard with analytics charts, CRAV-style landing page, per-tenant storefront branding) · **Phase 6 (payments) done** ✅ — **bKash Tokenized Checkout gateway adapter** (SSLCommerz + Stripe + bKash behind one provider registry, sandbox + 3-gateway E2E in CI), **split payments** (one order, multiple methods — partial → paid recompute, New Order editor), **full/partial refunds** (audit trail + audit_logs entry), **payment reconciliation** (stale online intents auto-expire), **VAT-aware order invoices** (per-item NBR VAT split + linked payments + print/PDF), `seed:payment-demo` — order status workflow, **fully translated Bangla landing + storefront**, **QR table menus (printable + downloadable + table-aware orders)**, **kitchen/delivery order filters (status/table/open-first)**, **WhatsApp order alerts + customer status notifications (webhook + wa.me)**, **bKash/Nagad payment records + SSLCommerz/Stripe gateway integration** (payments table, per-tenant payment methods, hosted checkout sessions, signed webhooks, **local gateway sandbox harness + test-mode E2E in CI**), **daily closeout report** (JSON + CSV + **print/PDF + nightly email via real SMTP**, Dhaka-day), **closeout trend dashboard** (7/30-day revenue curve by payment method, best day, day-over-day, **3-day forecast + month-over-month**), **VAT compliance report** (per-item VAT split, NBR-ready, migration 009), **nightly merchant digest** (top sellers + low stock in the closeout email + signed WhatsApp push), **customer order tracking page** (order no + phone, public API), revenue-by-method analytics, the Deliveroo-style design system, and **Phase 7 analytics** — **peak-hours heatmap** (7×24 Dhaka-time grid + busiest-slot insight), **category-mix donut**, **customer retention** (repeat rate, avg order value, masked top customers), **fulfillment-time stats** (placed → delivered per order type), **live order queue** (auto-refreshing) + **dashboard alerts** (low stock / high cancellation / idle hours), **platform-admin cross-tenant analytics** (SaaS-wide revenue, top restaurants, method mix), and a **nightly rollup layer + 6-month performance test** (<2s p95, measured 279ms) — all live; the customer-facing checkout/cart flow is the next sprint.

---

## 📋 Scrum Master's Delivery Summary

| Sprint / Phase | Delivered | Verification |
|---|---|---|
| **Phase 1** — Foundation | Security hardening (Helmet, CORS, rate limiting, zod validation, central errors), hotfix wave, PostgreSQL stack (migration runner, migrations 001–005, PG dev service), CI/CD pipeline | Backend + PG CI jobs green |
| **Phase 2** — Auth & RBAC | Register/login/verify/reset flows, rotating refresh tokens with reuse detection, TOTP 2FA, role-based access control (admin/owner/manager/cashier/kitchen/delivery), session management | Full auth + RBAC test suites |
| **Phase 3** — Multi-tenant SaaS | Tenant workspaces, team members & roles, plans/subscriptions/feature flags, tenant-scoping middleware (fail-closed isolation), CSRF protection, Dhaka seed data (20 workspaces, 89 menu items) | Tenant isolation + CSRF suites |
| **Phase 4** — Menu & Media | Menu catalog (categories/variants/add-ons), image pipeline (sharp → WebP, S3-compatible storage, CDN-ready), bulk **CSV + XLSX** import, public menu API with HTTP caching + pagination, **DELETE endpoints**, **soft delete + optimistic locking**, **inventory**, **merchant dashboard with analytics charts**, **CRAV-style landing page**, **per-tenant storefront branding**, **MinIO S3 test tier in CI** | 21 suites · 204 tests passing |
| **Phase 5** — Ordering & fulfillment | **Customer storefront checkout** (`POST /api/public/restaurants/:slug/checkout` — guest order, server-side pricing, `Idempotency-Key` retry safety, empty-cart/price/availability protection, WhatsApp alert + realtime broadcast), **order types** (pickup / delivery / scheduled pickup / scheduled delivery — address + schedule validation, delivery fee), **delivery assignment** (manager assign/reassign to delivery members, delivery-only filtered views, `out_for_delivery` lifecycle), **kitchen accept/reject** (reason-required reject, invalid-transition 409), **real-time kitchen queue** (JWT-authenticated WebSocket `/ws`, tenant-room isolation that follows the active workspace, reconnect backoff + resync, 30s polling fallback), order status workflow, fully translated EN/BN i18n, QR table menus, table-aware orders, order filters, WhatsApp alerts, customer tracking, Deliveroo design system | Checkout, delivery, idempotency, realtime + fulfillment suites green — **385 tests passing** |
| **Phase 6** — Payments | **bKash/Nagad/cash payment records** (`payments` table + per-tenant methods + cashier confirm/refund with trxID), **SSLCommerz + Stripe + bKash gateway integration** (one provider registry, hosted checkout, signed webhooks + callback-execute, **local sandbox harness + 3-gateway E2E in CI**), **split payments** (multi-method per order, partial → paid recompute, New Order editor), **full/partial refunds** (audit trail: amount/at/reason/by + `audit_logs`), **payment reconciliation** (stale online intents auto-expire), **VAT-aware order invoices** (per-item NBR VAT split + linked payments + print/PDF), **daily closeout** (JSON + CSV + print/PDF + nightly email via real SMTP), **closeout trend dashboard** (7/30-day curve + method mix + day-over-day + 3-day forecast + month-over-month), **VAT compliance report** (migration 009), **nightly merchant digest** (email + signed WhatsApp push), `seed:payment-demo` | Gateway, split, refund, reconciliation, invoice & closeout suites green (3-gateway sandbox E2E in CI) |
| **Phase 7** — Analytics | **Peak-hours heatmap** (7×24 Dhaka grid + busiest-slot insight), **category-mix donut**, **customer retention** (repeat rate, avg order value, masked top customers), **fulfillment-time stats** (placed → delivered per type), **live order queue** (30s auto-refresh) + **dashboard alerts** (low stock / high cancellation / idle), **platform-admin cross-tenant analytics** (SaaS revenue, top restaurants, method mix), **nightly rollup layer** (migration 011 `daily_stats` + `?source=rollup`) + **6-month perf acceptance** (<2s p95 — measured 279ms), `seed:analytics` demo data | **334 tests** passing (SQLite) + PG · live UI verified · perf p95 279ms |

---

## ✨ Features

### Currently working

**Multi-tenancy & SaaS operations (Phase 3)**
- Every product, promotion, order, and team membership is scoped to a `tenant_id`; workspace CRUD, team member invites (owner/manager/cashier/kitchen/delivery/staff), plans, subscriptions, feature flags, and usage counters
- `X-Tenant` header switching with fail-closed isolation — cross-tenant reads/writes return 403/404; platform admins see and can operate on every workspace

**Authentication, RBAC & security (Phase 2)**
- Register / login / verify-email / password-reset flows · rotating refresh tokens (httpOnly, SameSite cookie) with **session revocation + reuse detection** · optional **TOTP 2FA**
- Role-based access control (platform_admin / owner / manager / cashier / kitchen / delivery) with permission-gated routes and fine-grained `req.userHas()` checks · auth audit logging · **registered customers honor granted workspace roles** — an owner can invite a customer-created account (cashier/kitchen/manager/…) and the tenant membership outranks the account-level `customer` role (verified by an end-to-end new-user order-flow test)
- CSRF protection (Origin / `Sec-Fetch-Site` verification) · Helmet headers · CORS allowlist · rate limiting · zod validation · centralized error envelope with request IDs

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
- **QR table bill-split by diner** — the split editor gains a **By diner** mode (⇄ Split payment → By diner): assign each cart item to a diner, give each diner a name + payment method, and their share (their items + an equal delivery-fee portion, rounding to the last diner) is computed automatically; every part is sent with its diner's name as the part `note` (stored on the payment row's `notes` — `payments[].note` accepted by both the public checkout and staff order validators), the confirmation card lists each part with its diner, and the cashier sees who paid which part; e2e drives a full QR-table (with `?table=`) two-diner bKash + cash split through the browser
- **Refunds (full/partial) with audit trail** — `PATCH /api/payments/:id` accepts `{ status: 'refunded', amount?, reason? }`; only collected payments refund (`REFUND_NOT_ALLOWED`); stamps `refunded_amount/at/reason/by` **and** an append-only `audit_logs` entry (`payment.refunded`); partial refunds keep their retained portion as collected (order settles at paid/partial/refunded); closeout revenue is payment-accurate; Orders list shows **↩ Refund** on paid rows
- **Payment reconciliation** — online gateway intents get an `expires_at` window at creation (default 30 min); the per-minute scheduler flips stale pending `online` payments to **expired** and re-syncs the order (→ unpaid) — manual wallet payments are deliberately untouched
- **VAT-aware order invoices** — `GET /api/orders/:id/invoice` returns a per-item VAT split (NBR convention), totals, and the **linked payment records** (method/amount/status/trxID/refund) — split orders show each part; `?print=1` renders the print-ready HTML (browser Save-as-PDF); Orders list → **🧾 Invoice** opens `/orders/:id/invoice` with a Print/PDF button
- **`npm run seed:payment-demo`** — idempotent seeder adding a **Split Demo** (bKash + cash) and a **Refunded Demo** order per workspace so a fresh install can see the lifecycle immediately

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
- Versioned migration runner (`npm run db:migrate` / `db:migrate:down` / `db:migrate:status`) with migrations 001–011; dialect-selectable DB config (`DB_DIALECT` / `DATABASE_URL`, default SQLite); PostgreSQL 16 service in `docker-compose.yml`; migrations run at boot on both dialects
- Every Sequelize model maps to migration tables/columns (`tableName` + `field` mappings) — the app runs unchanged against a *migrations-only* database on SQLite **and** PostgreSQL (v1 `sync()` bridge removed), guarded by a drift test and a dedicated PG CI job
- **v1 → v2 data migration** — `npm run db:migrate:v1 -- --source data.sqlite` copies legacy data into the migrated schema (id maps, `password → password_hash`, DECIMAL conversion, order/status remapping) with blocking verification: row-count parity, money invariants, FK integrity
- **Production cutover runbook** — [`docs/04-pg-cutover-runbook.md`](docs/04-pg-cutover-runbook.md): backup → dry-run → migrate → copy → verify → flip → rollback

**Dhaka seed data (Phase 3)**
- `npm run seed:restaurants` provisions 20 data-driven restaurant workspaces (KFC, Pizza Hut, Domino's, Chillox, Sultan's Dine, Star Kabab, Madchef, Takeout, Handi, and more) with 89 realistic menu items **and 12 QR tables each** — idempotent, rerunnable

**End-to-end tests (Playwright)**
- `cd frontend && npx playwright test`: boots the real API on a scratch DB + the Vite app and drives login, product CRUD, order creation, and the fulfillment UI through the actual browser · runs in CI (dedicated `e2e` job)

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
| **Public storefront** — live menu at `/m/:slug` | **Public storefront — dark mode** |
| ![Public storefront](docs/screenshots/public-menu-light.png) | ![Public storefront dark](docs/screenshots/public-menu-dark.png) |
| **Merchant Menu** — Wolt/Deliveroo-style grouped categories | **Promotions** — offers manager |
| ![Menu](docs/screenshots/menu-merchant-light.png) | ![Promotions](docs/screenshots/promotions-light.png) |
| **Products — light mode** | **Products — dark mode** |
| ![Products light](docs/screenshots/products-light.png) | ![Products dark](docs/screenshots/products-dark.png) |
| **Dashboard** — closeout trend + 3-day forecast + month-over-month | |
| ![Dashboard](docs/screenshots/dashboard-light.png) | |

### Phase 5 — Ordering & fulfillment (checkout + delivery + realtime)

| | |
|---|---|
| **Storefront with cart** — add items, live totals, checkout bar | **Guest checkout** — order type, customer info, payment method |
| ![Storefront cart](docs/screenshots/storefront-cart-light.png) | ![Checkout](docs/screenshots/checkout-light.png) |
| **QR table menu** — printable table codes + per-table PNG | **Customer tracking** — order no + phone |
| ![QR menu](docs/screenshots/qr-menu-light.png) | ![Tracking](docs/screenshots/track-light.png) |
| **Settings** — storefront branding editor, payment methods & WhatsApp | |
| ![Settings](docs/screenshots/settings-light.png) | |

### Phase 6 — Payments (live captures)

| | | |
|---|---|---|
| **Orders** — Split/Partial badges, ↩ Refund, 🧾 Invoice actions | **Reports** — daily closeout + VAT compliance (NBR-ready) | **Order invoice** — per-item VAT split + linked payments |
| ![Orders — Phase 6](docs/screenshots/orders-phase6-light.png) | ![Reports](docs/screenshots/reports-light.png) | ![Invoice — Phase 6](docs/screenshots/invoice-phase6-light.png) |
| **New Order** — split-payment editor (bKash ৳ + Cash ৳ per part) | | |
| ![Split editor — Phase 6](docs/screenshots/neworder-split-light.png) | | |

### Phase 7 — Analytics (live captures)

| | |
|---|---|
| **Dashboard** — live queue + alerts, peak-hours heatmap, category mix, retention & fulfillment | **Platform admin** — SaaS-wide view (revenue curve, top restaurants, method mix, tenant status) |
| ![Dashboard — Phase 7](docs/screenshots/dashboard-light.png) | ![Admin analytics — Phase 7](docs/screenshots/admin-analytics-light.png) |

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
│   │   └── __tests__/        # 35 suites · 334 tests
│   ├── migrations/           # Versioned schema migrations (001–011)
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

The script creates a throwaway `oms_local_test` database (dropped afterwards unless `--keep`), runs the real migration runner, then the entire backend test suite against it — **385 tests on PostgreSQL** in CI-identical fashion.

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
npm test                      # Vitest — 334 tests across 35 suites (2 skipped locally)
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
| **6** | Payments | **✅ Shipped:** bKash/Nagad/cash **payment records**, **SSLCommerz/Stripe/bKash gateway integration** (hosted checkout, signed webhooks + callback-execute, sandbox harness + 3-gateway E2E in CI), **daily closeout** (JSON + CSV + print/PDF + nightly email), **split payments** (multi-method per order, payment-status recompute, split editor), **full/partial refunds** (audit trail: amount/at/reason/by + audit_logs), **payment reconciliation** (stale online intents auto-expire), **VAT-aware order invoices** (per-item VAT split + linked payments + print/PDF), **`seed:payment-demo`** | ✅ **Done** |
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

---

## 🤝 Contributing

1. Fork the repo and create a feature branch from `master`
2. Run `npm run lint` and `npm test` (backend) before pushing
3. Open a pull request — CI (6 jobs) must pass

---

## 📄 License

Private / internal — all rights reserved.
