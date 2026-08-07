import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant, Product, Order, OrderItem } from '../models/index.js';

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

  it('is available to cashiers (view:orders)', async () => {
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(res.status).toBe(200);
    expect(res.body.today.orders).toBe(2);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(401);
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
