# 07 — Analytics Maturity (Phase 7)

Custom-range analytics for merchants: **date range + channel + order-type filters**, a
storefront **conversion funnel**, **rider performance vs SLA**, **revenue anomaly
alerts**, and **one-click CSV export for every chart**.

Design principles:

- **Backend-authoritative** — the API validates and computes everything; the UI only
  collects filters and renders payloads. A merchant can never query outside their
  tenant, and every number is reproducible from the same endpoint.
- **Extends, never duplicates** — the realtime dashboard widgets (`/api/dashboard`)
  stay untouched; filtered history is served by `/api/analytics/*`. The dashboard page
  composes both.
- **Privacy-first funnel** — sessions are anonymous localStorage ids minted per
  restaurant slug; no cookies, no personal data, no third-party scripts.

---

## Endpoints (`/api/analytics`, permission `view:analytics`)

All endpoints accept the shared filter params:

| Param        | Values                                        | Default                          |
| ------------ | --------------------------------------------- | -------------------------------- |
| `from`,`to`  | `YYYY-MM-DD` (both or neither)                | last 7 days ending today         |
| `timezone`   | valid IANA zone                               | tenant `settings.timezone` → `Asia/Dhaka` |
| `channel`    | `pos` \| `storefront`                         | both                             |
| `order_type` | `pickup` \| `delivery` \| `scheduled_pickup` \| `scheduled_delivery` | all |

Range spans are capped at `ANALYTICS_MAX_RANGE_DAYS` (env, default **366**); invalid
input returns `400 VALIDATION_ERROR`.

| Method | Path                  | Returns                                                                 |
| ------ | --------------------- | ----------------------------------------------------------------------- |
| GET    | `/summary`            | KPIs (revenue/orders/AOV/avg items/order), zero-filled daily series, status breakdown, payment-method mix |
| GET    | `/funnel`             | Browse → Cart → Checkout → Paid stage counts + step conversions (null when denominator is 0) |
| GET    | `/riders?sort=`       | Per-rider deliveries / avg minutes / on-time % / late count (+ totals row); sort = `deliveries\|avg\|onTimeRate\|late`; SLA default 60 min |
| GET    | `/categories`         | Revenue share by menu category                                          |
| GET    | `/top-items`          | Top sellers by quantity                                                 |
| GET    | `/peak-hours`         | Weekday × hour order grid (tenant timezone)                             |
| GET    | `/retention`          | Repeat rate, AOV, masked top customers                                  |
| GET    | `/anomalies?limit=`   | Persisted revenue-anomaly alerts (newest first)                         |
| POST   | `/anomalies/evaluate` | Run the anomaly detector now (audited)                                  |
| GET    | `/export.csv?type=`   | CSV of any dataset — see [CSV export](#csv-export)                      |

### Funnel semantics

- Stages are counted over **distinct analytics sessions** (`analytics_events.session_id`,
  deduped), so one guest adding five dishes still counts once per stage.
- `menu_view` → Browse, `add_to_cart` → Cart, `checkout_start` → Checkout,
  paid orders with an `analytics_session` → Paid.
- When `channel=pos` is requested the event stages are empty and conversions render
  as `null` (POS has no browsing journey). The Paid stage counts **only orders that
  carry an `analytics_session`**, so storefront conversion can never exceed 100% by
  mixing in POS orders.

### Rider performance

- Population: orders with `delivery_member_id`, delivered within the filtered range
  (`updated_at ≈ delivery instant`; scheduled orders use `scheduled_at` as the promise).
- `avgDeliveryMinutes` = avg(delivered − placed); negative durations (clock skew /
  backdated imports) are skipped.
- `onTimeRate` = share of deliveries completed within `settings.analytics.slaMinutes`
  (default 60).

### Revenue anomalies

- Detector: yesterday's revenue (per channel segment: `all` + each active channel)
  vs the trailing 14-day baseline excluding yesterday. Deviation beyond
  ±thresholds fires an alert.
- Config under tenant `settings.analytics.anomalies`: `{ dropPct: 20, spikePct: 30,
  minBaselineOrders: 10, cooldownHours: 24 }` — quiet days (baseline below
  `minBaselineOrders`) never fire.
- Alerts persist to `audit_logs` (action `analytics.revenue_anomaly`, metadata carries
  type/segment/current/baseline/deviation/range) and are **deduped by cooldown**: the
  same type+segment won't re-fire within `cooldownHours`. The nightly closeout email
  scheduler evaluates automatically; merchants can also run it on demand via
  `POST /anomalies/evaluate`.

---

## CSV export

`GET /api/analytics/export.csv?type=<dataset>&<filters>` streams a CSV named
`<type>-analytics-<from>-to-<to>.csv`. Types: `revenue`, `methods`, `categories`,
`status`, `top-items`, `peak-hours`, `retention`, `funnel`, `riders`, `anomalies`.
Unknown types → `400 UNKNOWN_CSV_TYPE`. Cells containing commas/quotes/newlines are
RFC-4180 escaped; the same filter validation applies.

The dashboard renders a per-card export button plus an exports strip honoring the
active filters — what you see is what you download.

---

## Storefront tracking

Anonymous session ids live in `localStorage` under `analytics_session:<slug>`
(`frontend/src/utils/funnelTrack.js`). Events are sent fire-and-forget — analytics can
never break or slow shopping:

| Event            | Fired at                                   | Extra fields  |
| ---------------- | ------------------------------------------ | ------------- |
| `menu_view`      | Public menu mount                          | –             |
| `add_to_cart`    | Every add-to-cart (quick add / options modal / schedule-from-calendar) | `product_id` |
| `checkout_start` | Checkout page mount                        | –             |

`POST /api/public/restaurants/:slug/events` accepts them unauthenticated (zod-validated:
type enum, session id 8–64 chars, product must belong to the tenant); checkout sends
`analytics_session` with the order body (optional, 8–64 chars) which links the paid
order into the funnel. POS orders simply have no session — they're excluded from
funnel math rather than polluting it.

---

## Schema (migration `027_analytics_phase7`)

```sql
ALTER TABLE orders ADD COLUMN channel TEXT NOT NULL DEFAULT 'pos';
ALTER TABLE orders ADD COLUMN analytics_session TEXT NULL;
CREATE INDEX ix_orders_tenant_channel ON orders (tenant_id, channel);

CREATE TABLE analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,           -- SERIAL in PG
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                             -- menu_view | add_to_cart | checkout_start
  session_id TEXT NOT NULL,
  product_id INTEGER NULL REFERENCES products(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_analytics_events_tenant_type_time ON analytics_events (tenant_id, type, created_at);
CREATE INDEX ix_analytics_events_tenant_session   ON analytics_events (tenant_id, session_id);
```

Legacy rows keep `channel='pos'`; the storefront sets `channel='storefront'`.

## RBAC

Everything under `/api/analytics` requires the `view:analytics` permission
(owner/admin/manager by default). Cashiers still see the realtime dashboard — the
filtered sections hide themselves when the API answers 403.

## Tests

`backend/src/__tests__/analytics.test.js` — 18 tests covering RBAC, filter validation,
summary/channel/method mix, distinct-session funnel math (incl. POS-empty semantics),
on-time rider math, anomaly persistence/cooldown/segments, CSV headers/filename/
escaping/all-types, plus migration rollback/re-apply coverage in
`migrations.test.js`.
