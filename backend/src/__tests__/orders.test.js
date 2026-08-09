import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Promotion from '../models/Promotion.js';
import Tenant from '../models/Tenant.js';
import UserTenant from '../models/UserTenant.js';
import Table from '../models/Table.js';

let token;
let kitchenToken;
let deliveryToken;
let managerToken;

beforeAll(async () => {
  await resetTestDb();

  // Phase 3: business data is tenant-scoped, so the cashier needs a workspace.
  const tenant = await Tenant.create({ name: 'Test Diner', slug: 'test-diner' });
  const cashier = await User.create({
    name: 'Cashier',
    email: 'cashier@example.com',
    password: await bcrypt.hash('supersecret1', 10),
  });
  await UserTenant.create({ user_id: cashier.id, tenant_id: tenant.id, role: 'cashier' });

  const kitchen = await User.create({
    name: 'Kitchen',
    email: 'kitchen@example.com',
    password: await bcrypt.hash('supersecret1', 10),
  });
  await UserTenant.create({ user_id: kitchen.id, tenant_id: tenant.id, role: 'kitchen' });

  const delivery = await User.create({
    name: 'Delivery',
    email: 'delivery@example.com',
    password: await bcrypt.hash('supersecret1', 10),
  });
  await UserTenant.create({ user_id: delivery.id, tenant_id: tenant.id, role: 'delivery' });

  const manager = await User.create({
    name: 'Manager',
    email: 'manager@example.com',
    password: await bcrypt.hash('supersecret1', 10),
  });
  await UserTenant.create({ user_id: manager.id, tenant_id: tenant.id, role: 'manager' });

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'cashier@example.com', password: 'supersecret1' });
  token = login.body.accessToken;
  kitchenToken = (
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'kitchen@example.com', password: 'supersecret1' })
  ).body.accessToken;
  deliveryToken = (
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'delivery@example.com', password: 'supersecret1' })
  ).body.accessToken;
  managerToken = (
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'manager@example.com', password: 'supersecret1' })
  ).body.accessToken;

  await Product.create({
    tenant_id: tenant.id,
    name: 'Burger',
    description: 'Beef burger',
    price: 200,
    weight_gm: 500,
    enabled: true,
  });
  await Product.create({
    tenant_id: tenant.id,
    name: 'Fries',
    description: 'Large fries',
    price: 100,
    weight_gm: 300,
    enabled: true,
  });
  await Promotion.create({
    tenant_id: tenant.id,
    title: '10% off',
    type: 'percentage',
    percentage_value: 10,
    start_date: '2020-01-01',
    end_date: '2099-12-31',
    enabled: true,
  });

  // Tables (QR table menu): 5 active, 9 hidden — for table-aware order tests.
  await Table.create({ tenant_id: tenant.id, table_no: 5, name: 'Window 5', capacity: 4 });
  await Table.create({ tenant_id: tenant.id, table_no: 9, name: 'Reserved', capacity: 6, is_active: false });
});

afterAll(async () => {
  await sequelize.close();
});

describe('POST /api/orders', () => {
  it('creates an order with correct totals and applied promotions', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Rahim',
        customer_phone: '01700000000',
        customer_address: 'Dhanmondi, Dhaka',
        items: [
          { product_id: 1, quantity: 2 },
          { product_id: 2, quantity: 1 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.subtotal).toBe(500); // 2×200 + 1×100
    expect(res.body.total_discount).toBe(50); // 10% of 500
    expect(res.body.grand_total).toBe(450);
    expect(res.body.items).toHaveLength(2);
  });

  it('rejects orders with unavailable products', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Rahim',
        items: [{ product_id: 9999, quantity: 1 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PRODUCT_UNAVAILABLE');
  });

  it('rejects invalid payloads with 400', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ customer_name: '', items: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/orders').send({
      customer_name: 'Rahim',
      items: [{ product_id: 1, quantity: 1 }],
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/orders', () => {
  it('lists orders with pagination headers', async () => {
    const res = await request(app)
      .get('/api/orders?limit=10')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(Number(res.headers['x-total-count'])).toBeGreaterThan(0);
  });
});

describe('PATCH /api/orders/:id/status (fulfillment lifecycle)', () => {
  const placeOrder = (authToken) =>
    request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customer_name: 'Karim',
        items: [{ product_id: 1, quantity: 1 }],
      });

  it('starts at placed and kitchen advances to preparing/ready', async () => {
    const placed = await placeOrder(token);
    expect(placed.status).toBe(201);
    const id = placed.body.id;

    const prep = await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'preparing' });
    expect(prep.status).toBe(200);
    expect(prep.body.status).toBe('preparing');

    const ready = await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'ready' });
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe('ready');
  });

  it('delivery role can only move an order to delivered', async () => {
    const placed = await placeOrder(token);
    const id = placed.body.id;

    // Delivery cannot fulfill (placed → preparing is valid but not theirs).
    const forbidden = await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${deliveryToken}`)
      .send({ status: 'preparing' });
    expect(forbidden.status).toBe(403);

    // Kitchen advances to ready.
    await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'preparing' });
    await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'ready' });

    const delivered = await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${deliveryToken}`)
      .send({ status: 'delivered' });
    expect(delivered.status).toBe(200);
    expect(delivered.body.status).toBe('delivered');
  });

  it('rejects invalid transitions and non-sequential jumps', async () => {
    const placed = await placeOrder(token);
    const id = placed.body.id;

    // placed → delivered is a skip.
    const skip = await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: 'delivered' });
    expect(skip.status).toBe(400);
    expect(skip.body.error.code).toBe('INVALID_STATUS_TRANSITION');

    const bogus = await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: 'launched' });
    expect(bogus.status).toBe(400);

    const missing = await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({});
    expect(missing.status).toBe(400);
  });

  it('cashier cannot advance orders (no fulfill permission)', async () => {
    const placed = await placeOrder(token);
    const res = await request(app)
      .patch(`/api/orders/${placed.body.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'preparing' });
    expect(res.status).toBe(403);
  });

  it('manager can cancel a placed/preparing order but not a ready one', async () => {
    const placed = await placeOrder(token);

    const canceled = await request(app)
      .patch(`/api/orders/${placed.body.id}/status`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: 'canceled' });
    expect(canceled.status).toBe(200);
    expect(canceled.body.status).toBe('canceled');

    // Re-cancel / transition from canceled is rejected.
    const again = await request(app)
      .patch(`/api/orders/${placed.body.id}/status`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: 'canceled' });
    expect(again.status).toBe(409);

    // A ready order cannot be canceled.
    const ready = await placeOrder(token);
    await request(app)
      .patch(`/api/orders/${ready.body.id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'preparing' });
    await request(app)
      .patch(`/api/orders/${ready.body.id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'ready' });
    const lateCancel = await request(app)
      .patch(`/api/orders/${ready.body.id}/status`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: 'canceled' });
    expect(lateCancel.status).toBe(409);
  });

  it('cannot place an order with another tenant table (isolation)', async () => {
    const other = await Tenant.create({ name: 'Table Cafe', slug: 'table-cafe' });
    await Table.create({ tenant_id: other.id, table_no: 7, name: 'Beta Table', capacity: 4 });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Rahim',
        table_no: 7,
        items: [{ product_id: 1, quantity: 1 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TABLE');
  });

  it('cannot update an order in another tenant (isolation)', async () => {
    const other = await Tenant.create({ name: 'Other Diner', slug: 'other-diner' });
    const otherManager = await User.create({
      name: 'Other Manager',
      email: 'other.manager@example.com',
      password: await bcrypt.hash('supersecret1', 10),
    });
    await UserTenant.create({
      user_id: otherManager.id,
      tenant_id: other.id,
      role: 'manager',
    });
    const otherToken = (
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'other.manager@example.com', password: 'supersecret1' })
    ).body.accessToken;

    const placed = await placeOrder(token);
    const res = await request(app)
      .patch(`/api/orders/${placed.body.id}/status`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ status: 'canceled' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/orders — table-aware (QR table menu)', () => {
  const base = { customer_name: 'Dine-in Guest', items: [{ product_id: 1, quantity: 1 }] };

  it('stores a valid table number on the order and lists it', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...base, table_no: 5 });
    expect(res.status).toBe(201);
    expect(res.body.table_no).toBe(5);

    const list = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${token}`);
    const order = list.body.find((o) => o.id === res.body.id);
    expect(order.table_no).toBe(5);
  });

  it('allows orders without a table (delivery/pickup)', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send(base);
    expect(res.status).toBe(201);
    expect(res.body.table_no).toBeNull();
  });

  it('rejects an unknown table with 400 INVALID_TABLE', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...base, table_no: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TABLE');
  });

  it('rejects a hidden (inactive) table', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...base, table_no: 9 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TABLE');
  });

  it('rejects a non-integer table number via schema validation', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...base, table_no: 'five' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
