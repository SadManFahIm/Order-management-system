import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant, Product } from '../models/index.js';

/**
 * Public order tracking (Phase 5) — GET /api/public/track.
 *
 * Privacy-safe: the customer proves ownership with the phone the order was
 * placed with; unknown orders and wrong phones both 404 identically.
 */

let token;
let tenant;
let product;
let orderNo;

beforeAll(async () => {
  await resetTestDb();
  tenant = await Tenant.create({ name: 'Track Diner', slug: 'track-diner' });
  const cashier = await User.create({
    name: 'Track Cashier',
    email: 'trackcashier@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: cashier.id, tenant_id: tenant.id, role: 'cashier' });
  token = (
    await request(app).post('/api/auth/login').send({ email: 'trackcashier@example.com', password: 'password123' })
  ).body.accessToken;

  product = await Product.create({
    tenant_id: tenant.id,
    name: 'Track Burger',
    price: 250,
    weight_gm: 300,
    enabled: true,
  });

  const placed = await request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      customer_name: 'Track Guest',
      customer_phone: '01712345678',
      items: [{ product_id: product.id, quantity: 2 }],
    });
  expect(placed.status).toBe(201);
  orderNo = placed.body.order_no;
});

afterAll(async () => {
  await sequelize.close();
});

describe('GET /api/public/track', () => {
  it('returns the order status and items for the matching phone', async () => {
    const res = await request(app)
      .get(`/api/public/track?orderNo=${orderNo}&phone=01712345678`)
      .set('X-Forwarded-For', '10.0.0.1');
    expect(res.status).toBe(200);
    expect(res.body.orderNo).toBe(orderNo);
    expect(res.body.status).toBe('placed');
    expect(res.body.total).toBe(500);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ name: 'Track Burger', quantity: 2 });
    expect(res.body.restaurant.name).toBe('Track Diner');
    // No internal/sensitive fields leak.
    expect(res.body).not.toHaveProperty('customerPhone');
    expect(res.body).not.toHaveProperty('customerName');
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('matches phone digits regardless of formatting (BD format tolerant)', async () => {
    const res = await request(app)
      .get(`/api/public/track?orderNo=${orderNo}&phone=%2B8801712345678`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('placed');
  });

  it('404s identically for a wrong phone', async () => {
    const res = await request(app).get(`/api/public/track?orderNo=${orderNo}&phone=01899999999`);
    expect(res.status).toBe(404);
  });

  it('404s identically for an unknown order number', async () => {
    const res = await request(app)
      .get('/api/public/track?orderNo=ORD-NOPE-1&phone=01712345678');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects missing params with 400', async () => {
    expect((await request(app).get('/api/public/track?orderNo=ORD-1')).status).toBe(400);
    expect((await request(app).get('/api/public/track?phone=01712345678')).status).toBe(400);
    expect((await request(app).get('/api/public/track?orderNo=X&phone=123')).status).toBe(400);
  });

  it('needs no authentication (public endpoint)', async () => {
    const res = await request(app)
      .get(`/api/public/track?orderNo=${orderNo}&phone=01712345678`);
    expect(res.status).toBe(200);
  });
});
