import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant, Product, Order, Payment } from '../models/index.js';

/**
 * Platform admin analytics (Phase 7) — the cross-tenant SaaS view. Only
 * account-level platform admins may read it; tenant members get 403 even
 * though they can see their own dashboard.
 */

let adminToken;
let managerToken;

const login = async (email) =>
  (
    await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'password123' })
  ).body.accessToken;

beforeAll(async () => {
  await resetTestDb();

  await User.create({
    name: 'Platform Admin',
    email: 'platform@oms.dev',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'platform_admin',
  });
  const manager = await User.create({
    name: 'Tenant Manager',
    email: 'tm@oms.dev',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });

  const tenantA = await Tenant.create({ name: 'Admin Cafe A', slug: 'admin-a' });
  const tenantB = await Tenant.create({ name: 'Admin Cafe B', slug: 'admin-b', status: 'trial' });
  await UserTenant.create({ user_id: manager.id, tenant_id: tenantA.id, role: 'manager' });

  adminToken = await login('platform@oms.dev');
  managerToken = await login('tm@oms.dev');

  // One paid order per tenant (direct model writes — the aggregate math is
  // what we're testing, not order placement).
  const burgerA = await Product.create({
    tenant_id: tenantA.id,
    name: 'A Burger',
    price: 200,
    weight_gm: 250,
    enabled: true,
  });
  const burgerB = await Product.create({
    tenant_id: tenantB.id,
    name: 'B Burger',
    price: 100,
    weight_gm: 200,
    enabled: true,
  });
  void burgerA;
  void burgerB;

  const orderA = await Order.create({
    tenant_id: tenantA.id,
    order_no: 'ADM-1',
    customer_name: 'Cust',
    subtotal: 400,
    total_discount: 0,
    grand_total: 400,
    status: 'delivered',
    type: 'pickup',
    payment_status: 'paid',
    payment_method: 'cash',
  });
  await Payment.create({
    tenant_id: tenantA.id,
    order_id: orderA.id,
    method: 'cash',
    amount: 400,
    status: 'paid',
  });

  const orderB = await Order.create({
    tenant_id: tenantB.id,
    order_no: 'ADM-2',
    customer_name: 'Cust',
    subtotal: 100,
    total_discount: 0,
    grand_total: 100,
    status: 'delivered',
    type: 'pickup',
    payment_status: 'paid',
    payment_method: 'bkash',
  });
  await Payment.create({
    tenant_id: tenantB.id,
    order_id: orderB.id,
    method: 'bkash',
    amount: 100,
    status: 'paid',
  });
});

afterAll(async () => {
  await sequelize.close();
});

describe('GET /api/admin/analytics', () => {
  it('is restricted to platform admins (tenant members get 403)', async () => {
    const denied = await request(app)
      .get('/api/admin/analytics')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(denied.status).toBe(403);

    const anon = await request(app).get('/api/admin/analytics');
    expect(anon.status).toBe(401);
  });

  it('aggregates revenue, orders and tenant counts across all workspaces', async () => {
    const res = await request(app)
      .get('/api/admin/analytics')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const { overview } = res.body;
    expect(overview.tenants).toBe(2);
    expect(overview.activeTenants).toBe(1);
    expect(overview.trialTenants).toBe(1);
    expect(overview.ordersWindow).toBe(2);
    expect(overview.revenueWindow).toBe(500);
    expect(overview.avgOrderValue).toBe(250);
    expect(overview.allTimeOrders).toBe(2);
  });

  it('ranks top restaurants by paid revenue and breaks down method mix', async () => {
    const res = await request(app)
      .get('/api/admin/analytics')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    expect(res.body.topRestaurants).toEqual([
      { id: expect.any(Number), name: 'Admin Cafe A', slug: 'admin-a', revenue: 400, orders: 1 },
      { id: expect.any(Number), name: 'Admin Cafe B', slug: 'admin-b', revenue: 100, orders: 1 },
    ]);

    expect(res.body.methodMix).toEqual([
      { method: 'cash', amount: 400, count: 1 },
      { method: 'bkash', amount: 100, count: 1 },
    ]);
  });

  it('returns a Dhaka-day trend and tenant status breakdown that reconcile', async () => {
    const res = await request(app)
      .get('/api/admin/analytics')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    expect(res.body.trend).toHaveLength(30);
    const today = res.body.trend[29];
    expect(today.orders).toBe(2);
    expect(today.revenue).toBe(500);

    const statuses = Object.fromEntries(
      res.body.tenantStatusBreakdown.map((s) => [s.status, s.count])
    );
    expect(statuses).toMatchObject({ active: 1, trial: 1 });
  });
});
