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
  Outlet,
  OutletMembership,
  Order,
  OrderItem,
  Product,
  Payment,
} from '../models/index.js';

/**
 * Outlet-level analytics (Sector 3) - the `outlet_id` filter on the
 * /api/analytics/* order-based endpoints: tenant-scoped validation
 * (INVALID_OUTLET), membership-scoped RBAC for viewers without
 * `manage:outlets` (FORBIDDEN), per-branch math on every dataset, and the
 * documented rejections (funnel + anomaly alerts are not outlet-attributed).
 */

let tenantA;
let tenantB;
let a1;
let a2;
let b1;
let ownerToken;
let scopedToken;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKeyOf = (d) => new Date(d).toISOString().slice(0, 10);
const daysAgo = (n, hourUtc = 10) => {
  const d = new Date(Date.now() - n * DAY_MS);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d;
};

const login = async (email, password = 'password123') =>
  (await request(app).post('/api/auth/login').send({ email, password })).body.accessToken;

const get = (url, token = ownerToken) => {
  const sep = url.includes('?') ? '&' : '?';
  return request(app).get(`${url}${sep}timezone=Etc/UTC`).set('Authorization', `Bearer ${token}`);
};

let seedSeq = 0;
const seedOrder = async (overrides = {}) => {
  const defaults = {
    tenant_id: tenantA.id,
    order_no: `ORD-OT-${seedSeq++}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    customer_name: 'Outlet Cust',
    customer_phone: '01750000001',
    type: 'pickup',
    status: 'delivered',
    payment_method: 'cash',
    payment_status: 'paid',
    subtotal: 400,
    total_discount: 0,
    grand_total: 400,
    channel: 'pos',
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
  };
  return Order.create({ ...defaults, ...overrides }, { silent: true });
};

const seedProduct = async (name, price) =>
  Product.create({ tenant_id: tenantA.id, name, price, weight_gm: 100, enabled: true });

beforeAll(async () => {
  await resetTestDb();

  tenantA = await Tenant.create({ name: 'Outlet Analytics A', slug: 'outlet-analytics-a' });
  tenantB = await Tenant.create({ name: 'Outlet Analytics B', slug: 'outlet-analytics-b' });

  a1 = await Outlet.create({ tenant_id: tenantA.id, name: 'Branch A1', code: 'A1', slug: 'a1' });
  a2 = await Outlet.create({ tenant_id: tenantA.id, name: 'Branch A2', code: 'A2', slug: 'a2' });
  b1 = await Outlet.create({ tenant_id: tenantB.id, name: 'Branch B1', code: 'B1', slug: 'b1' });

  const owner = await User.create({
    name: 'Outlet Analytics Owner',
    email: 'outlet-owner@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenantA.id, role: 'owner' });
  ownerToken = await login('outlet-owner@example.com');

  // Scoped viewer (Sector 2 pattern): tenant role 'cashier' granted
  // view:analytics only via a per-user flag — so they may view analytics but
  // hold no manage:outlets. Their branch visibility comes from membership.
  const scoped = await User.create({
    name: 'Outlet Analytics Scoped',
    email: 'outlet-scoped@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({
    user_id: scoped.id,
    tenant_id: tenantA.id,
    role: 'cashier',
    permissions: ['view:analytics'],
  });
  await OutletMembership.create({
    user_id: scoped.id,
    outlet_id: a1.id,
    tenant_id: tenantA.id,
    role: 'outlet_manager',
  });
  scopedToken = await login('outlet-scoped@example.com');

  // ── Branch A1: one paid order (400, cash) with 2x Burger ────────────────
  const oA1 = await seedOrder({ outlet_id: a1.id, grand_total: 400, subtotal: 400 });
  await Payment.create({
    tenant_id: tenantA.id,
    order_id: oA1.id,
    method: 'cash',
    amount: 400,
    status: 'paid',
    createdAt: daysAgo(1),
  });
  const burger = await seedProduct('Burger A', 200);
  await OrderItem.create({
    tenant_id: tenantA.id,
    order_id: oA1.id,
    product_id: burger.id,
    item_name: 'Burger A',
    quantity: 2,
    unit_price: 200,
    weight_per_unit_gm: 0,
    total_weight_gm: 0,
    discount: 0,
    line_total: 400,
  });

  // ── Branch A2: two paid orders (600 bkash + 200 cash, same phone) ───────
  const oA2 = await seedOrder({ outlet_id: a2.id, grand_total: 600, subtotal: 600 });
  await Payment.create({
    tenant_id: tenantA.id,
    order_id: oA2.id,
    method: 'bkash',
    amount: 600,
    status: 'paid',
    createdAt: daysAgo(1),
  });
  const fries = await seedProduct('Fries A', 150);
  await OrderItem.create({
    tenant_id: tenantA.id,
    order_id: oA2.id,
    product_id: fries.id,
    item_name: 'Fries A',
    quantity: 2,
    unit_price: 300,
    weight_per_unit_gm: 0,
    total_weight_gm: 0,
    discount: 0,
    line_total: 600,
  });
  await seedOrder({ outlet_id: a2.id, grand_total: 200, subtotal: 200 });

  // ── Rider: one on-time delivery in A1, one late delivery in A2 ──────────
  const rider = await User.create({
    name: 'Branch Rider',
    email: 'branch-rider@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: rider.id, tenant_id: tenantA.id, role: 'delivery' });
  const placed = daysAgo(1, 4);
  await seedOrder({
    outlet_id: a1.id,
    type: 'delivery',
    payment_status: 'unpaid',
    assigned_to: rider.id,
    createdAt: placed,
    updatedAt: new Date(placed.getTime() + 30 * 60000),
  });
  await seedOrder({
    outlet_id: a2.id,
    type: 'delivery',
    payment_status: 'unpaid',
    assigned_to: rider.id,
    createdAt: placed,
    updatedAt: new Date(placed.getTime() + 90 * 60000),
  });
});

afterAll(async () => {
  await sequelize.close();
});

describe('Outlet filter validation', () => {
  it('rejects non-positive-integer outlet_id values', async () => {
    for (const bad of ['abc', '1.5', '0', '-1']) {
      const res = await get(`/api/analytics/summary?outlet_id=${bad}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects an outlet from another tenant (INVALID_OUTLET)', async () => {
    const res = await get(`/api/analytics/summary?outlet_id=${b1.id}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_OUTLET');
  });

  it('forbids a scoped viewer from a branch they have no membership in', async () => {
    const res = await get(`/api/analytics/summary?outlet_id=${a2.id}`, scopedToken);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('echoes outlet "all" by default', async () => {
    const res = await get('/api/analytics/summary');
    expect(res.status).toBe(200);
    expect(res.body.filters.outlet).toBe('all');
  });
});

describe('Per-branch summary math', () => {
  const from = dayKeyOf(daysAgo(1));
  const qs = `from=${from}&to=${from}`;

  it('scopes revenue, order counts and the payment-method mix to the outlet', async () => {
    const a1Res = await get(`/api/analytics/summary?${qs}&outlet_id=${a1.id}`);
    expect(a1Res.status).toBe(200);
    expect(String(a1Res.body.filters.outlet)).toBe(String(a1.id));
    expect(a1Res.body.summary.totalRevenue).toBe(400);
    expect(a1Res.body.summary.totalOrders).toBe(2);
    expect(a1Res.body.summary.paidOrders).toBe(1);
    const a1Cash = a1Res.body.methodMix.find((m) => m.method === 'cash');
    expect(a1Cash.amount).toBe(400);

    const a2Res = await get(`/api/analytics/summary?${qs}&outlet_id=${a2.id}`);
    expect(a2Res.body.summary.totalRevenue).toBe(800);
    expect(a2Res.body.summary.totalOrders).toBe(3);
    const a2Bkash = a2Res.body.methodMix.find((m) => m.method === 'bkash');
    expect(a2Bkash.amount).toBe(600);
    // The A1 cash payment must never leak into A2's mix.
    expect(a2Res.body.methodMix.find((m) => m.method === 'cash')).toBeUndefined();

    // Series only carries the branch's daily revenue.
    const a1Day = a1Res.body.series.find((s) => s.date === from);
    expect(a1Day.revenue).toBe(400);
    expect(a1Day.orders).toBe(2);
  });

  it('scopes categories, top-items, retention and riders', async () => {
    const cats = await get(`/api/analytics/categories?${qs}&outlet_id=${a1.id}`);
    expect(cats.status).toBe(200);
    expect(cats.body.categoryMix.find((c) => c.revenue === 400).quantity).toBe(2);

    const items = await get(`/api/analytics/top-items?${qs}&outlet_id=${a1.id}`);
    expect(items.body.topItems).toEqual([
      expect.objectContaining({ name: 'Burger A', quantity: 2, revenue: 400 }),
    ]);

    const ret = await get(`/api/analytics/retention?${qs}&outlet_id=${a2.id}`);
    expect(ret.body.retention.totalCustomers).toBe(1);
    expect(ret.body.retention.repeatCustomers).toBe(1);
    expect(ret.body.retention.repeatRate).toBe(100);
  });

  it('scopes rider delivery performance to the branch', async () => {
    const a1Riders = await get(`/api/analytics/riders?${qs}&outlet_id=${a1.id}`);
    expect(a1Riders.body.totals.deliveries).toBe(1);
    expect(a1Riders.body.totals.onTimeRate).toBe(100);

    const a2Riders = await get(`/api/analytics/riders?${qs}&outlet_id=${a2.id}`);
    expect(a2Riders.body.totals.deliveries).toBe(1);
    expect(a2Riders.body.totals.onTimeRate).toBe(0);
  });

  it('scopes CSV exports to the outlet', async () => {
    const rev = await get(`/api/analytics/export.csv?type=revenue&${qs}&outlet_id=${a1.id}`);
    expect(rev.status).toBe(200);
    expect(rev.text).toContain('400.00');
    expect(rev.text).not.toContain('600.00');

    const items = await get(`/api/analytics/export.csv?type=top-items&${qs}&outlet_id=${a2.id}`);
    expect(items.text).toContain('Fries A');
  });
});

describe('Unsupported outlet filtering (documented rejections)', () => {
  it('rejects outlet_id on the funnel (events are not outlet-attributed)', async () => {
    const res = await get(`/api/analytics/funnel?outlet_id=${a1.id}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('not outlet-attributed');

    const csv = await get(`/api/analytics/export.csv?type=funnel&outlet_id=${a1.id}`);
    expect(csv.status).toBe(400);
    expect(csv.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects outlet_id on anomaly alerts and evaluation', async () => {
    const list = await get(`/api/analytics/anomalies?outlet_id=${a1.id}`);
    expect(list.status).toBe(400);
    expect(list.body.error.code).toBe('VALIDATION_ERROR');

    const evaluate = await request(app)
      .post('/api/analytics/anomalies/evaluate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ outlet_id: a1.id });
    expect(evaluate.status).toBe(400);
    expect(evaluate.body.error.code).toBe('VALIDATION_ERROR');

    const csv = await get(`/api/analytics/export.csv?type=anomalies&outlet_id=${a1.id}`);
    expect(csv.status).toBe(400);
    expect(csv.body.error.code).toBe('VALIDATION_ERROR');
  });
});