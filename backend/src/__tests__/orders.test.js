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

let token;

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

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'cashier@example.com', password: 'supersecret1' });
  token = login.body.accessToken;

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
