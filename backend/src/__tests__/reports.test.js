import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

// Capture emails instead of sending — the adapter is a stub anyway, but a
// spy lets us assert recipient / subject / attachment content.
const emailSpy = vi.fn().mockResolvedValue({ messageId: 'stub-test-1' });
vi.mock('../services/notifications/email.js', () => ({
  sendEmail: (...args) => emailSpy(...args),
}));

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

describe('GET /api/reports/closeout.pdf', () => {
  it('serves the print-ready report as HTML with totals and orders', async () => {
    const res = await request(app)
      .get(`/api/reports/closeout.pdf?date=${todayDhaka()}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Report Diner — Daily Closeout');
    expect(res.text).toContain('Cash One');
    expect(res.text).toContain('৳');
    expect(res.text).toContain('@media print'); // print-optimized
    expect(res.text).toContain('Revenue by payment method');
    // Escapes customer names that contain CSV-special characters.
    expect(res.text).toContain('Comma, Customer');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/reports/closeout.pdf');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/reports/vat (Phase 6)', () => {
  it('splits VAT-inclusive revenue into VAT + net, per-item rate', async () => {
    const pizza = await Product.create({
      tenant_id: tenant.id,
      name: 'Report Pizza',
      price: 400,
      weight_gm: 400,
      enabled: true,
      vat_rate: 15,
    });
    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ customer_name: 'Vat Pizza', items: [{ product_id: pizza.id, quantity: 1 }] });

    const res = await request(app)
      .get(`/api/reports/vat?from=${todayDhaka()}&to=${todayDhaka()}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const burger = res.body.items.find((i) => i.itemName === 'Report Burger');
    const pizzaItem = res.body.items.find((i) => i.itemName === 'Report Pizza');

    // Burger at 5% (migration default): 4 × 300 = 1200 gross →
    // vat = 1200 × 5/105 ≈ 57.14, net ≈ 1142.86.
    expect(burger).toMatchObject({ vatRate: 5, quantity: 4, gross: 1200 });
    expect(burger.vat).toBeCloseTo(57.14, 1);
    expect(burger.net).toBeCloseTo(1142.86, 1);

    // Pizza at 15%: 400 gross → vat = 400 × 15/115 ≈ 52.17.
    expect(pizzaItem).toMatchObject({ vatRate: 15, quantity: 1, gross: 400 });
    expect(pizzaItem.vat).toBeCloseTo(52.17, 1);
    expect(res.body.totals.gross).toBe(1600);
    expect(res.body.totals.vat).toBeCloseTo(109.31, 1);
    expect(res.body.totals.net).toBeCloseTo(1490.69, 1);
  });

  it('rejects an inverted range (from after to) with 400', async () => {
    const res = await request(app)
      .get('/api/reports/vat?from=2026-08-11&to=2026-08-09')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('falls back to the workspace default rate for items without a rate (0% preserved)', async () => {
    // A real order for a product that is then hard-deleted — the line has no
    // product to look up a vat_rate from, so the tenant default applies.
    const ghost = await Product.create({
      tenant_id: tenant.id,
      name: 'Ghost Item',
      price: 100,
      weight_gm: 100,
      enabled: true,
      vat_rate: 5,
    });
    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ customer_name: 'Ghost Buy', items: [{ product_id: ghost.id, quantity: 1 }] });
    await Product.destroy({ where: { id: ghost.id }, force: true });

    await tenant.update({ settings: { vat: { defaultRate: 0 } } });
    try {
      const res = await request(app)
        .get(`/api/reports/vat?from=${todayDhaka()}&to=${todayDhaka()}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      const item = res.body.items.find((i) => i.itemName === 'Ghost Item');
      // 0% is a legitimate (VAT-exempt) default — it must not become 5.
      expect(item.vatRate).toBe(0);
      expect(item.vat).toBe(0);
      expect(item.net).toBe(100);
    } finally {
      await tenant.update({ settings: {} });
    }
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/reports/vat');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/reports/vat.csv', () => {
  it('downloads per-item VAT rows with a TOTAL footer', async () => {
    const res = await request(app)
      .get(`/api/reports/vat.csv?from=${todayDhaka()}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('item_name,vat_rate_pct,quantity,gross_bdt,vat_bdt,net_bdt');
    expect(res.text).toContain('Report Burger');
    expect(res.text).toContain('Report Pizza');
    expect(res.text).toContain('TOTAL');
    expect(res.text).toContain('57.14');
  });

  it('rejects an inverted range on the CSV export too', async () => {
    const res = await request(app)
      .get('/api/reports/vat.csv?from=2026-08-11&to=2026-08-09')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/reports/closeout/email', () => {
  it('emails the closeout to the workspace-configured address with a CSV attachment', async () => {
    emailSpy.mockClear();
    await request(app)
      .patch(`/api/tenants/${tenant.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reports: { closeoutEmail: 'owner@report.test', autoSendCloseout: { enabled: true, hour: 23 } } });

    const res = await request(app)
      .post('/api/reports/closeout/email')
      .set('Authorization', `Bearer ${token}`)
      .send({ date: todayDhaka() });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(res.body.to).toBe('owner@report.test');

    expect(emailSpy).toHaveBeenCalledTimes(1);
    const call = emailSpy.mock.calls[0][0];
    expect(call.to).toBe('owner@report.test');
    expect(call.subject).toContain(todayDhaka());
    expect(call.attachments).toHaveLength(1);
    expect(call.attachments[0].filename).toBe(`closeout-${todayDhaka()}.csv`);
    expect(call.attachments[0].content).toContain('order_no,time');
  });

  it('lets an explicit `to` override the workspace setting', async () => {
    emailSpy.mockClear();
    const res = await request(app)
      .post('/api/reports/closeout/email')
      .set('Authorization', `Bearer ${token}`)
      .send({ date: todayDhaka(), to: 'boss@report.test' });
    expect(res.status).toBe(200);
    expect(emailSpy.mock.calls[0][0].to).toBe('boss@report.test');
  });
});
