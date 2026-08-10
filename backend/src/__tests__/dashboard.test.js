import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant, Product, MenuCategory } from '../models/index.js';

/**
 * Merchant dashboard (Phase 4 completion) — today's revenue/orders, open
 * fulfillment load, menu size and top items. Tenant-scoped + RBAC.
 */

let tenantA;
let tenantB;
let managerToken;
let cashierToken;

const placeOrder = (token, items, name = 'Dash Customer') =>
  request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ customer_name: name, items });

beforeAll(async () => {
  await resetTestDb();

  tenantA = await Tenant.create({ name: 'Dash Cafe A', slug: 'dash-a' });
  tenantB = await Tenant.create({ name: 'Dash Cafe B', slug: 'dash-b' });

  const manager = await User.create({
    name: 'Dash Manager',
    email: 'dashmanager@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  const cashier = await User.create({
    name: 'Dash Cashier',
    email: 'dashcashier@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: manager.id, tenant_id: tenantA.id, role: 'manager' });
  await UserTenant.create({ user_id: cashier.id, tenant_id: tenantA.id, role: 'cashier' });

  const login = async (email) =>
    (await request(app).post('/api/auth/login').send({ email, password: 'password123' })).body
      .accessToken;
  managerToken = await login('dashmanager@example.com');
  cashierToken = await login('dashcashier@example.com');

  // Menu: Burger 200, Fries 100.
  const burger = await Product.create({ tenant_id: tenantA.id, name: 'Dash Burger', price: 200, weight_gm: 250, enabled: true });
  await Product.create({ tenant_id: tenantA.id, name: 'Dash Fries', price: 100, weight_gm: 150, enabled: true });
  await Product.create({ tenant_id: tenantB.id, name: 'Beta Item', price: 50, weight_gm: 50 });

  // Two orders today: 2× Burger + 1× Fries (subtotal 500), then 1× Burger.
  await placeOrder(managerToken, [{ product_id: burger.id, quantity: 2 }]);
  await placeOrder(managerToken, [{ product_id: burger.id, quantity: 1 }]);
});

afterAll(async () => {
  await sequelize.close();
});

describe('GET /api/dashboard', () => {
  it('returns today stats, open orders, menu size and top items', async () => {
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);

    expect(res.body.today.orders).toBe(2);
    // 2 orders × 2 burgers? No — 2+1 = 3 burgers × 200 = 600.
    expect(res.body.today.revenue).toBe(600);
    expect(res.body.openOrders).toBe(2); // both placed, not canceled
    expect(res.body.totalProducts).toBe(2); // tenant A only

    const top = res.body.topItems[0];
    expect(top.name).toBe('Dash Burger');
    expect(top.quantity).toBe(3);
    expect(top.revenue).toBe(600);
  });

  it('breaks down revenue by payment method (cash default)', async () => {
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);

    // Both seeded orders were cash → paid on the spot.
    expect(res.body.paymentBreakdown).toEqual([
      { method: 'cash', amount: 600, count: 2 },
    ]);
  });

  it('is available to cashiers (view:orders)', async () => {
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(res.status).toBe(200);
    expect(res.body.today.orders).toBe(2);
  });

  it('returns a zero-filled 7-day trend and full status breakdown', async () => {
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);

    // Always 7 buckets (today + 6 back), even when there is no history yet.
    expect(res.body.trend).toHaveLength(7);
    const last = res.body.trend[6];
    expect(last.orders).toBe(2);
    expect(last.revenue).toBe(600);
    // Zero-filled leading days — charts render a complete axis.
    expect(res.body.trend.slice(0, 6).every((d) => d.orders === 0 && d.revenue === 0)).toBe(true);

    // Every lifecycle status is present with a count.
    expect(res.body.statusBreakdown).toEqual([
      { status: 'placed', count: 2 },
      { status: 'preparing', count: 0 },
      { status: 'ready', count: 0 },
      { status: 'delivered', count: 0 },
      { status: 'canceled', count: 0 },
    ]);
  });

  it('trend and status breakdown track the fulfillment lifecycle', async () => {
    // Place a third order and drive it through to delivered via the API.
    const placed = await placeOrder(managerToken, [
      {
        product_id: (await Product.findOne({ where: { tenant_id: tenantA.id, name: 'Dash Fries' } })).id,
        quantity: 1,
      },
    ]);
    const orderId = placed.body.id;

    const step = (status) =>
      request(app)
        .patch(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ status });

    expect((await step('preparing')).status).toBe(200);
    expect((await step('ready')).status).toBe(200);
    expect((await step('delivered')).status).toBe(200);

    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.body.today.orders).toBe(3);
    expect(res.body.today.revenue).toBe(700); // +1 Fries (100)
    expect(res.body.statusBreakdown.find((s) => s.status === 'placed').count).toBe(2);
    expect(res.body.statusBreakdown.find((s) => s.status === 'delivered').count).toBe(1);
    expect(res.body.trend[6].orders).toBe(3);
    // The extra (cash) order lands in the payment breakdown too.
    expect(res.body.paymentBreakdown).toEqual([
      { method: 'cash', amount: 700, count: 3 },
    ]);
  });

  it('exposes a Dhaka-day closeout trend with per-day method mix + stats', async () => {
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);

    // 7 buckets by default, zero-filled; today holds the seeded orders
    // (2 burgers + the fries order from the lifecycle test = 3 / 700).
    expect(res.body.closeoutTrend).toHaveLength(7);
    const today = res.body.closeoutTrend[6];
    expect(today.orders).toBe(3);
    expect(today.revenue).toBe(700);
    // All three orders were cash → paid on the spot.
    expect(today.methodMix).toMatchObject({ cash: 700, bkash: 0, nagad: 0 });
    // Leading days are zero-filled with a complete method map.
    expect(res.body.closeoutTrend[0]).toEqual({
      date: res.body.closeoutTrend[0].date,
      revenue: 0,
      orders: 0,
      methodMix: { cash: 0, bkash: 0, nagad: 0, card: 0, online: 0, other: 0 },
    });

    expect(res.body.trendStats).toMatchObject({
      days: 7,
      totalRevenue: 700,
      totalOrders: 3,
      avgPerDay: 100, // 700 / 7
    });
    expect(res.body.trendStats.bestDay.revenue).toBe(700);
    expect(res.body.trendStats.dayOverDay.current).toBe(700);
    expect(res.body.trendStats.dayOverDay.previous).toBe(0);
    expect(res.body.trendStats.dayOverDay.delta).toBe(700);
    expect(res.body.trendStats.dayOverDay.pct).toBeNull(); // previous day empty
  });

  it('projects a 3-day forecast and a month-over-month delta (Phase 6)', async () => {
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);

    // Forecast: one trailing 7-day moving-average point per window day + a
    // 3-day linear projection past the last actual.
    expect(res.body.forecast.movingAverage).toHaveLength(7);
    expect(res.body.forecast.movingAverage[6].value).toBe(100); // (6×0 + 700)/7
    expect(res.body.forecast.projection).toHaveLength(3);
    for (const p of res.body.forecast.projection) {
      expect(p.forecast).toBe(true);
      expect(p.revenue).toBeGreaterThanOrEqual(0);
      expect(typeof p.date).toBe('string');
    }
    // Forecast days are strictly AFTER the last actual day (UTC date math).
    const lastActual = res.body.closeoutTrend[6].date;
    const [fy, fm, fd] = res.body.forecast.projection[0].date.split('-').map(Number);
    const [ly, lm, ld] = lastActual.split('-').map(Number);
    expect(Date.UTC(fy, fm - 1, fd)).toBeGreaterThan(Date.UTC(ly, lm - 1, ld));

    // Month-over-month: all 3 orders are this Dhaka month → 700 vs 0.
    expect(res.body.monthOverMonth.currentRevenue).toBe(700);
    expect(res.body.monthOverMonth.previousRevenue).toBe(0);
    expect(res.body.monthOverMonth.pct).toBeNull();
  });

  it('supports ?days=30 and clamps out-of-range values', async () => {
    const thirty = await request(app)
      .get('/api/dashboard?days=30')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(thirty.status).toBe(200);
    expect(thirty.body.closeoutTrend).toHaveLength(30);
    expect(thirty.body.trendStats.days).toBe(30);
    // Today's revenue still lands on the LAST bucket (Dhaka day).
    expect(thirty.body.closeoutTrend[29].revenue).toBe(700);

    const clamped = await request(app)
      .get('/api/dashboard?days=999')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(clamped.body.trendStats.days).toBe(30);

    const min = await request(app)
      .get('/api/dashboard?days=1')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(min.body.trendStats.days).toBe(7);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(401);
  });

  it('exposes a peak-hours heatmap grid (Phase 7)', async () => {
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);

    const { peakHours } = res.body;
    // 7 (Sun-first) × 24 grid, always complete.
    expect(peakHours.days).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(peakHours.grid).toHaveLength(7);
    for (const row of peakHours.grid) expect(row).toHaveLength(24);
    // Every cell carries day/hour/orders/revenue.
    expect(peakHours.grid[0][0]).toMatchObject({ day: 0, hour: 0, orders: 0, revenue: 0 });

    // Grid totals must reconcile with the closeout trend (3 orders / 700).
    const gridOrders = peakHours.grid.flat().reduce((s, c) => s + c.orders, 0);
    const gridRevenue = peakHours.grid.flat().reduce((s, c) => s + c.revenue, 0);
    const trendOrders = res.body.closeoutTrend.reduce((s, d) => s + d.orders, 0);
    const trendRevenue = res.body.closeoutTrend.reduce((s, d) => s + d.revenue, 0);
    expect(gridOrders).toBe(trendOrders);
    expect(gridOrders).toBe(3);
    expect(gridRevenue).toBe(trendRevenue);
    expect(gridRevenue).toBe(700);

    // The busiest slot holds all three orders (placed seconds apart → same
    // Dhaka hour), with revenue 700.
    expect(peakHours.busiest.orders).toBe(3);
    expect(peakHours.busiest.revenue).toBe(700);
    expect(peakHours.maxRevenue).toBe(700);
    expect(peakHours.maxOrders).toBe(3);
  });

  it('breaks down revenue by menu category (Phase 7)', async () => {
    // Give tenant A a real category and attach a product to it.
    const cat = await MenuCategory.create({ tenant_id: tenantA.id, name: 'Burgers' });
    const p = await Product.create({
      tenant_id: tenantA.id,
      name: 'Categorized Burger',
      price: 150,
      weight_gm: 200,
      enabled: true,
      category_id: cat.id,
    });
    await placeOrder(managerToken, [{ product_id: p.id, quantity: 1 }]);

    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);

    // Uncategorized lines (Burger/Fries from before) + the new category.
    const mix = res.body.categoryMix;
    const uncat = mix.find((c) => c.name === 'Uncategorized');
    const burgers = mix.find((c) => c.name === 'Burgers');
    expect(uncat).toBeDefined();
    expect(uncat.revenue).toBe(700);
    expect(uncat.quantity).toBe(4); // 2×Burger + 1×Burger + 1×Fries
    expect(burgers).toBeDefined();
    expect(burgers.revenue).toBe(150);
    expect(burgers.quantity).toBe(1);
    expect(burgers.pct).toBeCloseTo((150 / 850) * 100, 1); // 17.6%
    // Percentages sum to ~100 and rows are sorted by revenue desc.
    const pctSum = mix.reduce((s, c) => s + c.pct, 0);
    expect(pctSum).toBeGreaterThan(99);
    expect(pctSum).toBeLessThanOrEqual(100.1);
    expect(mix[0].name).toBe('Uncategorized');
  });

  it('is tenant-scoped — tenant B sees none of tenant A', async () => {
    const other = await Tenant.create({ name: 'Dash Cafe C', slug: 'dash-c' });
    const otherUser = await User.create({
      name: 'Dash C Owner',
      email: 'dashc@example.com',
      password: await bcrypt.hash('password123', 10),
      platform_role: 'member',
    });
    await UserTenant.create({ user_id: otherUser.id, tenant_id: other.id, role: 'owner' });
    const token = (
      await request(app).post('/api/auth/login').send({ email: 'dashc@example.com', password: 'password123' })
    ).body.accessToken;

    const res = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.today.orders).toBe(0);
    expect(res.body.today.revenue).toBe(0);
    expect(res.body.totalProducts).toBe(0);
  });
});
