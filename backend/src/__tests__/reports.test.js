import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant, Product } from '../models/index.js';

/**
 * Daily closeout report (Phase 5) — JSON summary + CSV export, scoped to a
 * Dhaka local day (UTC+6).
 */

let token;
let tenant;
let product;

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
// Dhaka (UTC+6) is ahead of UTC — add the offset to get the local date.
const todayDhaka = () => new Date(Date.now() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);

beforeAll(async () => {
  await resetTestDb();
  tenant = await Tenant.create({ name: 'Report Diner', slug: 'report-diner' });
  const manager = await User.create({
    name: 'Report Manager',
    email: 'reportmanager@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: manager.id, tenant_id: tenant.id, role: 'manager' });
  token = (
    await request(app).post('/api/auth/login').send({ email: 'reportmanager@example.com', password: 'password123' })
  ).body.accessToken;

  product = await Product.create({
    tenant_id: tenant.id,
    name: 'Report Burger',
    price: 300,
    weight_gm: 300,
    enabled: true,
  });

  await request(app)
    .patch(`/api/tenants/${tenant.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ paymentMethods: { cash: { enabled: true }, bkash: { enabled: true } } });

  const place = (body) =>
    request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send(body);

  // 2 × cash (paid on the spot) + 1 × bKash (pending) = 3 orders today.
  await place({ customer_name: 'Cash One', items: [{ product_id: product.id, quantity: 1 }] });
  await place({ customer_name: 'Cash Two', items: [{ product_id: product.id, quantity: 1 }] });
  await place({
    customer_name: 'Bkash One',
    payment_method: 'bkash',
    items: [{ product_id: product.id, quantity: 1 }],
  });
});

afterAll(async () => {
  await sequelize.close();
});

describe('GET /api/reports/closeout', () => {
  it('summarises the day: totals, revenue by method, pending wallet amounts', async () => {
    const res = await request(app)
      .get(`/api/reports/closeout?date=${todayDhaka()}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    expect(res.body.totals.orders).toBe(3);
    expect(res.body.totals.revenue).toBe(600); // 2 cash orders paid
    expect(res.body.totals.pendingAmount).toBe(300); // bKash still pending
    expect(res.body.orders).toHaveLength(3);

    const cash = res.body.byMethod.find((m) => m.method === 'cash');
    const bkash = res.body.byMethod.find((m) => m.method === 'bkash');
    expect(cash).toMatchObject({ orders: 2, amount: 600 });
    expect(bkash).toMatchObject({ orders: 1, pendingAmount: 300, amount: 0 });
  });

  it('is tenant-scoped — another workspace sees an empty day', async () => {
    const other = await Tenant.create({ name: 'Other Diner', slug: 'other-report' });
    const otherUser = await User.create({
      name: 'Other Owner',
      email: 'reportother@example.com',
      password: await bcrypt.hash('password123', 10),
      platform_role: 'member',
    });
    await UserTenant.create({ user_id: otherUser.id, tenant_id: other.id, role: 'owner' });
    const otherToken = (
      await request(app).post('/api/auth/login').send({ email: 'reportother@example.com', password: 'password123' })
    ).body.accessToken;

    const res = await request(app)
      .get(`/api/reports/closeout?date=${todayDhaka()}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(200);
    expect(res.body.totals.orders).toBe(0);
    expect(res.body.byMethod).toHaveLength(0);
  });

  it('rejects a malformed date with 400', async () => {
    const res = await request(app)
      .get('/api/reports/closeout?date=10-08-2026')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/reports/closeout');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/reports/closeout.csv', () => {
  it('downloads a CSV with a header and every order row (comma-safe)', async () => {
    // A customer with a comma in the name — the CSV must quote the field.
    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ customer_name: 'Comma, Customer', items: [{ product_id: product.id, quantity: 1 }] });

    const res = await request(app)
      .get(`/api/reports/closeout.csv?date=${todayDhaka()}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');

    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toContain('order_no,time,customer_name');
    expect(lines).toHaveLength(5); // header + 4 orders (incl. the comma one)
    expect(res.text).toContain('Cash One');
    expect(res.text).toContain('300.00');
    // The comma field is quoted — still exactly one logical field.
    expect(res.text).toContain('"Comma, Customer"');
  });
});
