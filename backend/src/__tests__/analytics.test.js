import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import {
  User,
  Tenant,
  UserTenant,
  Product,
  Order,
  Payment,
  AnalyticsEvent,
  AuditLog,
} from '../models/index.js';

/**
 * Analytics API (Phase 7) — custom-range summary/funnel/riders/anomalies +
 * CSV export. Filter validation, channel/order-type scoping, funnel session
 * semantics, rider on-time math, anomaly persistence/cooldown, CSV shape.
 */

let tenant;
let managerToken;
let cashierToken;
let burger;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKeyOf = (d) => new Date(d).toISOString().slice(0, 10);
const daysAgo = (n, hourUtc = 10) => {
  const d = new Date(Date.now() - n * DAY_MS);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d;
};

/** POS order via the staff API (cash → paid immediately). */
const placePosOrder = (token, items, name = 'Analytics Cust') =>
  request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ customer_name: name, items });

/** Direct order row with full control over channel/timestamps/session. */
const seedOrder = async (overrides = {}) => {
  const defaults = {
    tenant_id: tenant.id,
    order_no: `ORD-T-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    customer_name: 'Seeded',
    customer_phone: '01700000000',
    type: 'pickup',
    status: 'delivered',
    payment_method: 'cash',
    payment_status: 'paid',
    subtotal: 500,
    total_discount: 0,
    grand_total: 500,
    channel: 'pos',
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
  };
  const merged = { ...defaults, ...overrides };
  // silent: true — otherwise Sequelize stomps updatedAt to NOW on create,
  // which would break the rider/anomaly time-based fixtures.
  return Order.create(merged, { silent: true });
};

beforeAll(async () => {
  await resetTestDb();

  tenant = await Tenant.create({ name: 'Analytics Cafe', slug: 'analytics-a' });

  const manager = await User.create({
    name: 'Analytics Manager',
    email: 'anmanager@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  const cashier = await User.create({
    name: 'Analytics Cashier',
    email: 'ancashier@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: manager.id, tenant_id: tenant.id, role: 'manager' });
  await UserTenant.create({ user_id: cashier.id, tenant_id: tenant.id, role: 'cashier' });

  const login = async (email) =>
    (await request(app).post('/api/auth/login').send({ email, password: 'password123' })).body
      .accessToken;
  managerToken = await login('anmanager@example.com');
  cashierToken = await login('ancashier@example.com');

  burger = await Product.create({
    tenant_id: tenant.id,
    name: 'Analytics Burger',
    price: 500,
    weight_gm: 250,
    enabled: true,
  });

  // Two paid POS orders yesterday (revenue 1000).
  await placePosOrder(managerToken, [{ product_id: burger.id, quantity: 1 }]);
  await placePosOrder(managerToken, [{ product_id: burger.id, quantity: 1 }]);

  // One paid storefront order yesterday, tied to a funnel session.
  const sfOrder = await seedOrder({
    channel: 'storefront',
    analytics_session: 'sess-storefront1',
    payment_method: 'bkash',
    grand_total: 300,
    subtotal: 300,
  });
  await Payment.create({
    tenant_id: tenant.id,
    order_id: sfOrder.id,
    method: 'bkash',
    amount: 300,
    status: 'paid',
    createdAt: daysAgo(1),
  });

  // Funnel events: two sessions browsed, one added to cart, one checked out.
  await AnalyticsEvent.bulkCreate([
    { tenant_id: tenant.id, session_id: 'sess-storefront1', event_type: 'menu_view', created_at: daysAgo(1) },
    { tenant_id: tenant.id, session_id: 'sess-storefront1', event_type: 'add_to_cart', created_at: daysAgo(1) },
    { tenant_id: tenant.id, session_id: 'sess-storefront1', event_type: 'checkout_start', created_at: daysAgo(1) },
    { tenant_id: tenant.id, session_id: 'sess-browseronly', event_type: 'menu_view', created_at: daysAgo(1) },
  ]);

  // Rider performance fixtures: one on-time, one late, one canceled delivery.
  const rider = await User.create({
    name: 'Rider Rana',
    email: 'rana@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: rider.id, tenant_id: tenant.id, role: 'delivery' });
  const placed1 = daysAgo(1, 4);
  await seedOrder({
    type: 'delivery',
    status: 'delivered',
    payment_status: 'unpaid',
    assigned_to: rider.id,
    createdAt: placed1,
    updatedAt: new Date(placed1.getTime() + 30 * 60000), // 30 min → on time (SLA 60)
  });
  const placed2 = daysAgo(2, 4);
  await seedOrder({
    type: 'delivery',
    status: 'delivered',
    payment_status: 'unpaid',
    assigned_to: rider.id,
    createdAt: placed2,
    updatedAt: new Date(placed2.getTime() + 90 * 60000), // 90 min → late
  });
  await seedOrder({
    type: 'delivery',
    status: 'canceled',
    payment_status: 'unpaid',
    assigned_to: rider.id,
    createdAt: daysAgo(2, 5),
    updatedAt: daysAgo(2, 6),
  });
});

afterAll(async () => {
  await sequelize.close();
});

const get = (url, token = managerToken) => {
  const sep = url.includes('?') ? '&' : '?';
  return request(app).get(`${url}${sep}timezone=Etc/UTC`).set('Authorization', `Bearer ${token}`);
};

describe('Analytics RBAC', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/analytics/summary');
    expect(res.status).toBe(401);
  });

  it('forbids cashiers (view:analytics required)', async () => {
    const res = await get('/api/analytics/summary', cashierToken);
    expect(res.status).toBe(403);
  });

  it('allows managers', async () => {
    const res = await get('/api/analytics/summary');
    expect(res.status).toBe(200);
  });
});

describe('Filter validation', () => {
  it('rejects from without to', async () => {
    const res = await get('/api/analytics/summary?from=2026-01-01');
    expect(res.status).toBe(400);
  });

  it('rejects malformed dates', async () => {
    expect((await get('/api/analytics/summary?from=01-2026&to=2026-01-05')).status).toBe(400);
    expect((await get('/api/analytics/summary?from=2026-02-30&to=2026-03-05')).status).toBe(400);
  });

  it('rejects inverted ranges and oversized spans', async () => {
    expect((await get('/api/analytics/summary?from=2026-05-10&to=2026-05-01')).status).toBe(400);
    expect(
      (await get('/api/analytics/summary?from=2024-01-01&to=2026-08-01')).status
    ).toBe(400);
  });

  it('rejects unknown channel / order_type / timezone', async () => {
    expect((await get('/api/analytics/summary?channel=telegram')).status).toBe(400);
    expect((await get('/api/analytics/summary?order_type=dine_in')).status).toBe(400);
    expect((await get('/api/analytics/summary?timezone=Mars/Olympus')).status).toBe(400);
  });

  it('defaults to a 7-day window ending today', async () => {
    const res = await get('/api/analytics/summary');
    expect(res.body.filters.from).toBe(dayKeyOf(daysAgo(6)));
    expect(res.body.filters.to).toBe(dayKeyOf(new Date()));
    expect(res.body.series).toHaveLength(7);
  });
});

describe('GET /api/analytics/summary', () => {
  it('computes revenue from paid orders only, zero-filled across the range', async () => {
    const to = dayKeyOf(new Date());
    const from = dayKeyOf(daysAgo(6));
    const res = await get(`/api/analytics/summary?from=${from}&to=${to}`);
    expect(res.status).toBe(200);

    // 2×500 POS (today) + 1×300 storefront (yesterday) = 1300 paid revenue.
    expect(res.body.summary.totalRevenue).toBe(1300);
    expect(res.body.summary.paidOrders).toBe(3);
    expect(res.body.summary.avgOrderValue).toBeCloseTo(433.33, 1);
    expect(res.body.series).toHaveLength(7);
    const yesterday = res.body.series[5];
    expect(yesterday.revenue).toBe(300);
    expect(yesterday.orders).toBeGreaterThanOrEqual(1);
  });

  it('filters by channel', async () => {
    const to = dayKeyOf(new Date());
    const from = dayKeyOf(daysAgo(6));
    const pos = await get(`/api/analytics/summary?from=${from}&to=${to}&channel=pos`);
    const sf = await get(`/api/analytics/summary?from=${from}&to=${to}&channel=storefront`);
    expect(pos.body.summary.totalRevenue).toBe(1000);
    expect(sf.body.summary.totalRevenue).toBe(300);
  });

  it('breaks down method mix from paid payments', async () => {
    const to = dayKeyOf(new Date());
    const from = dayKeyOf(daysAgo(6));
    const res = await get(`/api/analytics/summary?from=${from}&to=${to}`);
    const cash = res.body.methodMix.find((m) => m.method === 'cash');
    const bkash = res.body.methodMix.find((m) => m.method === 'bkash');
    expect(cash.count).toBe(2);
    expect(bkash.amount).toBe(300);
  });
});

describe('GET /api/analytics/funnel', () => {
  it('counts distinct sessions per stage and ties paid orders back', async () => {
    const to = dayKeyOf(new Date());
    const from = dayKeyOf(daysAgo(6));
    const res = await get(`/api/analytics/funnel?from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    expect(res.body.entity).toBe('distinct sessions');

    const counts = Object.fromEntries(res.body.stages.map((s) => [s.key, s.count]));
    expect(counts.browse).toBe(2);
    expect(counts.cart).toBe(1);
    expect(counts.checkout).toBe(1);
    expect(counts.paid).toBe(1); // storefront order carries the session id

    expect(res.body.conversions.browseToCart).toBe(50);
    expect(res.body.conversions.checkoutToPaid).toBe(100);
    expect(res.body.conversions.browseToPaid).toBe(50);
  });

  it('yields an empty funnel for channel=pos (events are storefront-only)', async () => {
    const to = dayKeyOf(new Date());
    const from = dayKeyOf(daysAgo(6));
    const res = await get(`/api/analytics/funnel?from=${from}&to=${to}&channel=pos`);
    expect(res.body.stages.every((s) => s.count === 0)).toBe(true);
    expect(res.body.conversions.browseToPaid).toBeNull();
  });
});

describe('GET /api/analytics/riders', () => {
  it('computes deliveries, average minutes and on-time rate per rider', async () => {
    const to = dayKeyOf(new Date());
    const from = dayKeyOf(daysAgo(6));
    const res = await get(`/api/analytics/riders?from=${from}&to=${to}`);
    expect(res.status).toBe(200);

    expect(res.body.totals.deliveries).toBe(2);
    const rana = res.body.riders.find((r) => r.rider === 'Rider Rana');
    expect(rana.deliveries).toBe(2);
    expect(rana.onTimeDeliveries).toBe(1);
    expect(rana.lateDeliveries).toBe(1);
    expect(rana.onTimeRate).toBe(50);
    expect(rana.avgDeliveryMinutes).toBe(60);
    expect(rana.canceledDeliveries).toBe(1);
  });
});

describe('Revenue anomalies', () => {
  it('persists a drop alert, respects cooldown, guards tiny baselines', async () => {
    // Baseline window (T-13..T-7): 12 paid orders × 500 = 6000.
    for (let i = 0; i < 12; i += 1) {
      await seedOrder({ createdAt: daysAgo(10), updatedAt: daysAgo(10) });
    }
    // Current window (T-6..T): one extra small order → massive drop vs 6000.
    await seedOrder({ grand_total: 100, subtotal: 100, createdAt: daysAgo(2), updatedAt: daysAgo(2) });

    const from = dayKeyOf(daysAgo(6));
    const to = dayKeyOf(new Date());
    const res = await request(app)
      .post('/api/analytics/anomalies/evaluate')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ from, to, timezone: 'Etc/UTC' });
    expect(res.status).toBe(200);

    const all = res.body.segments.find((s) => s.segment === 'all');
    expect(all.alertType).toBe('revenue_drop');
    expect(all.percentageDeviation).toBeLessThanOrEqual(-20);
    expect(all.suppressed).toBe(false);

    // Persisted once per matching segment ('all' + 'pos' both dropped) — a
    // second evaluation inside the cooldown suppresses every duplicate.
    const again = await request(app)
      .post('/api/analytics/anomalies/evaluate')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ from, to, timezone: 'Etc/UTC' });
    const allAgain = again.body.segments.find((s) => s.segment === 'all');
    expect(allAgain.alertType).toBe('revenue_drop');
    expect(allAgain.suppressed).toBe(true);

    const feed = await get('/api/analytics/anomalies');
    expect(feed.body.alerts).toHaveLength(2);
    expect(feed.body.alerts.every((a) => a.alertType === 'revenue_drop')).toBe(true);
    expect(feed.body.alerts.map((a) => a.segment).sort()).toEqual(['all', 'pos']);

    const stored = await AuditLog.findAll({ where: { action: 'analytics.revenue_anomaly' } });
    expect(stored).toHaveLength(2);
  });
});

describe('GET /api/analytics/export.csv', () => {
  const from = dayKeyOf(daysAgo(6));
  const qs = `from=${from}&to=${dayKeyOf(new Date())}`;

  it('exports the revenue chart with proper headers + filename', async () => {
    const res = await get(`/api/analytics/export.csv?type=revenue&${qs}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(
      `revenue-analytics-${from}-to-${dayKeyOf(new Date())}.csv`
    );
    expect(res.text.startsWith('Date,Revenue,Orders')).toBe(true);
    expect(res.text).toMatch(/\d+\.\d{2}/);
  });

  it('escapes commas/quotes via the shared csvCell util', async () => {
    const combo = await Product.create({
      tenant_id: tenant.id,
      name: 'Combo, "Special"',
      price: 100,
      weight_gm: 100,
      enabled: true,
    });
    await placePosOrder(managerToken, [{ product_id: combo.id, quantity: 1 }]);
    const res = await get(`/api/analytics/export.csv?type=top-items&${qs}`);
    expect(res.text).toContain('"Combo, ""Special"""');
  });

  it('supports every chart dataset and rejects unknown types', async () => {
    for (const type of [
      'methods',
      'categories',
      'status',
      'top-items',
      'peak-hours',
      'retention',
      'funnel',
      'riders',
      'anomalies',
    ]) {
      expect((await get(`/api/analytics/export.csv?type=${type}&${qs}`)).status).toBe(200);
    }
    expect((await get(`/api/analytics/export.csv?type=nope&${qs}`)).status).toBe(400);
  });
});
