import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant, Product } from '../models/index.js';

/**
 * Order invoices (Phase 6) — VAT-aware, payment-linked invoices.
 *
 * Menu pricing is VAT-inclusive (BD norm), so each line is split into
 * VAT + net using the item's own vat_rate: VAT = line × rate/(100+rate).
 * The invoice JSON carries the per-item split, totals, and the order's
 * payment records; `?print=1` renders the print-ready HTML.
 */

let tenant;
let ownerToken;
let product5;
let product15;
let product0;

beforeAll(async () => {
  await resetTestDb();
  tenant = await Tenant.create({ name: 'Invoice Diner', slug: 'invoice-diner' });
  const owner = await User.create({
    name: 'Invoice Owner',
    email: 'invoiceowner@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenant.id, role: 'owner' });
  ownerToken = (
    await request(app).post('/api/auth/login').send({ email: 'invoiceowner@example.com', password: 'password123' })
  ).body.accessToken;

  // 5% reduced rate (most food), 15% standard, 0% exempt.
  product5 = await Product.create({
    tenant_id: tenant.id, name: 'Standard Burger', price: 300, weight_gm: 300, enabled: true, vat_rate: 5,
  });
  product15 = await Product.create({
    tenant_id: tenant.id, name: 'Premium Tehari', price: 1000, weight_gm: 500, enabled: true, vat_rate: 15,
  });
  product0 = await Product.create({
    tenant_id: tenant.id, name: 'Exempt Water', price: 50, weight_gm: 500, enabled: true, vat_rate: 0,
  });

  await request(app)
    .patch(`/api/tenants/${tenant.id}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ paymentMethods: { cash: { enabled: true }, bkash: { enabled: true } } });
});

afterAll(async () => {
  await sequelize.close();
});

const place = (body) =>
  request(app).post('/api/orders').set('Authorization', `Bearer ${ownerToken}`).send(body);

describe('GET /api/orders/:id/invoice', () => {
  it('splits each line into VAT + net using the item rate (NBR convention)', async () => {
    const created = await place({
      customer_name: 'Invoice Guest',
      payment_method: 'cash',
      items: [
        { product_id: product5.id, quantity: 1 },  // 300 @ 5% → VAT 14.29
        { product_id: product15.id, quantity: 1 }, // 1000 @ 15% → VAT 130.43
        { product_id: product0.id, quantity: 1 },  // 50 @ 0% → VAT 0
      ],
    });
    expect(created.status).toBe(201);

    const res = await request(app)
      .get(`/api/orders/${created.body.id}/invoice`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);

    const byName = Object.fromEntries(res.body.items.map((i) => [i.itemName, i]));
    expect(byName['Standard Burger']).toMatchObject({ vatRate: 5, vat: 14.29, net: 285.71, lineTotal: 300 });
    expect(byName['Premium Tehari']).toMatchObject({ vatRate: 15, vat: 130.43, net: 869.57, lineTotal: 1000 });
    expect(byName['Exempt Water']).toMatchObject({ vatRate: 0, vat: 0, net: 50, lineTotal: 50 });

    // 300×5/105 = 14.2857, 1000×15/115 = 130.4348 — rounded to paise.
    expect(res.body.totals.vat).toBe(144.72); // 14.29 + 130.43
    expect(res.body.totals.grandTotal).toBe(1350);
    expect(res.body.invoiceNo).toContain(created.body.order_no);
    expect(res.body.restaurantName).toBe('Invoice Diner');
  });

  it('includes the linked payment records', async () => {
    const created = await place({
      customer_name: 'Paid Guest',
      payment_method: 'bkash',
      payment_reference: 'INV-TRX-1',
      items: [{ product_id: product5.id, quantity: 1 }],
    });
    const res = await request(app)
      .get(`/api/orders/${created.body.id}/invoice`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.payments).toHaveLength(1);
    expect(res.body.payments[0]).toMatchObject({
      method: 'bkash',
      amount: 300,
      status: 'pending',
      reference: 'INV-TRX-1',
    });
  });

  it('renders the print-ready HTML with ?print=1', async () => {
    const created = await place({
      customer_name: 'Print Guest',
      items: [{ product_id: product5.id, quantity: 2 }],
    });
    const res = await request(app)
      .get(`/api/orders/${created.body.id}/invoice?print=1`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('INV-');
    expect(res.text).toContain('VAT');
    expect(res.text).toContain('Standard Burger');
  });

  it('is tenant-scoped — other workspaces get 404', async () => {
    const created = await place({ customer_name: 'Scoped Guest', items: [{ product_id: product5.id, quantity: 1 }] });
    const other = await Tenant.create({ name: 'Other Diner', slug: 'other-invoice' });
    const otherOwner = await User.create({
      name: 'Other Owner',
      email: 'invoiceother@example.com',
      password: await bcrypt.hash('password123', 10),
      platform_role: 'member',
    });
    await UserTenant.create({ user_id: otherOwner.id, tenant_id: other.id, role: 'owner' });
    const otherToken = (
      await request(app).post('/api/auth/login').send({ email: 'invoiceother@example.com', password: 'password123' })
    ).body.accessToken;

    const res = await request(app)
      .get(`/api/orders/${created.body.id}/invoice`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/orders/1/invoice');
    expect(res.status).toBe(401);
  });
});
