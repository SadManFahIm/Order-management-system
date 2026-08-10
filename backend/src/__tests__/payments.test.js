import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant, Product, Order } from '../models/index.js';

/**
 * Payment records (Phase 5) — bKash/Nagad/cash lifecycle.
 *
 * Orders auto-create a payment record at placement (cash → paid, wallets →
 * pending), a cashier confirms wallet payments with a trxID, and the whole
 * thing is tenant-scoped + RBAC-gated.
 */

let tenant;
let otherTenant;
let ownerToken;
let cashierToken;
let kitchenToken;
let product;

const login = async (email) =>
  (await request(app).post('/api/auth/login').send({ email, password: 'password123' })).body
    .accessToken;

beforeAll(async () => {
  await resetTestDb();

  tenant = await Tenant.create({ name: 'Pay Diner', slug: 'pay-diner' });
  otherTenant = await Tenant.create({ name: 'Other Diner', slug: 'other-diner' });

  const mkUser = async (name, email) => {
    const user = await User.create({
      name,
      email,
      password: await bcrypt.hash('password123', 10),
      platform_role: 'member',
    });
    await UserTenant.create({ user_id: user.id, tenant_id: tenant.id, role: name.toLowerCase().split(' ')[0] });
    return user;
  };
  await mkUser('Owner', 'payowner@example.com');
  await mkUser('Cashier', 'paycashier@example.com');
  await mkUser('Kitchen', 'paykitchen@example.com');

  ownerToken = await login('payowner@example.com');
  cashierToken = await login('paycashier@example.com');
  kitchenToken = await login('paykitchen@example.com');

  // The test workspace accepts every method (cash default + wallets).
  await request(app)
    .patch(`/api/tenants/${tenant.id}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      paymentMethods: {
        cash: { enabled: true },
        bkash: { enabled: true, number: '+8801711111111' },
        nagad: { enabled: true, number: '+8801622222222' },
        card: { enabled: true },
      },
    });

  product = await Product.create({
    tenant_id: tenant.id,
    name: 'Payment Burger',
    price: 250,
    weight_gm: 400,
    enabled: true,
  });
  await Product.create({ tenant_id: otherTenant.id, name: 'Other Item', price: 100, weight_gm: 100 });
});

afterAll(async () => {
  await sequelize.close();
});

const placeOrder = (token, body = {}) =>
  request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ customer_name: 'Pay Guest', items: [{ product_id: product.id, quantity: 1 }], ...body });

describe('POST /api/orders — payment method', () => {
  it('defaults to cash and marks the payment paid immediately', async () => {
    const res = await placeOrder(ownerToken);
    expect(res.status).toBe(201);
    expect(res.body.payment_status).toBe('paid');
    expect(res.body.payment_method).toBe('cash');
    expect(res.body.payments).toHaveLength(1);
    const payment = res.body.payments[0];
    expect(payment.method).toBe('cash');
    expect(payment.status).toBe('paid');
    expect(payment.amount).toBe(250);
    expect(payment.paid_at).toBeTruthy();
  });

  it('bKash orders start pending with no paid_at', async () => {
    const res = await placeOrder(ownerToken, { payment_method: 'bkash' });
    expect(res.status).toBe(201);
    expect(res.body.payment_status).toBe('pending');
    expect(res.body.payment_method).toBe('bkash');
    expect(res.body.payments[0]).toMatchObject({ method: 'bkash', status: 'pending' });
    expect(res.body.payments[0].paid_at).toBeNull();
  });

  it('captures a Nagad transaction reference at the counter', async () => {
    const res = await placeOrder(ownerToken, {
      payment_method: 'nagad',
      payment_reference: '8A7B6C5D4E',
    });
    expect(res.status).toBe(201);
    expect(res.body.payments[0].reference).toBe('8A7B6C5D4E');
  });

  it('rejects an unknown payment method with 400', async () => {
    const res = await placeOrder(ownerToken, { payment_method: 'paypal' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PAYMENT_METHOD');
  });

  it('rejects a method the workspace has disabled', async () => {
    // Workspace accepts only bKash + Nagad now.
    await request(app)
      .patch(`/api/tenants/${tenant.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        paymentMethods: {
          cash: { enabled: false },
          bkash: { enabled: true },
          nagad: { enabled: true },
        },
      });

    const cash = await placeOrder(ownerToken, { payment_method: 'cash' });
    expect(cash.status).toBe(400);
    expect(cash.body.error.code).toBe('INVALID_PAYMENT_METHOD');

    const bkash = await placeOrder(ownerToken, { payment_method: 'bkash' });
    expect(bkash.status).toBe(201);

    // Restore the full config for the remaining tests in this file.
    await request(app)
      .patch(`/api/tenants/${tenant.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        paymentMethods: {
          cash: { enabled: true },
          bkash: { enabled: true, number: '+8801711111111' },
          nagad: { enabled: true, number: '+8801622222222' },
          card: { enabled: true },
        },
      });
  });
});

describe('POST /api/orders — split payments (Phase 6)', () => {
  it('creates one payment row per part (bkash + cash) with split status', async () => {
    const res = await placeOrder(ownerToken, {
      payments: [
        { method: 'bkash', amount: 150, reference: 'SPLIT-BKASH-1' },
        { method: 'cash', amount: 100 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.payment_method).toBe('split');
    expect(res.body.payment_status).toBe('partial');
    expect(res.body.payments).toHaveLength(2);

    const bkash = res.body.payments.find((p) => p.method === 'bkash');
    const cash = res.body.payments.find((p) => p.method === 'cash');
    expect(bkash).toMatchObject({ status: 'pending', amount: 150, reference: 'SPLIT-BKASH-1' });
    expect(cash).toMatchObject({ status: 'paid', amount: 100 });
    expect(cash.paid_at).toBeTruthy();
  });

  it('marks the order paid only when every part is confirmed', async () => {
    const placed = await placeOrder(ownerToken, {
      payments: [
        { method: 'bkash', amount: 150 },
        { method: 'cash', amount: 100 },
      ],
    });
    expect(placed.body.payment_status).toBe('partial');

    const bkashPart = placed.body.payments.find((p) => p.method === 'bkash');
    await request(app)
      .patch(`/api/payments/${bkashPart.id}`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ status: 'paid', reference: 'TRX-SPLIT-1' });

    const order = await Order.findByPk(placed.body.id);
    expect(order.payment_status).toBe('paid');
  });

  it('rejects parts that do not sum to the grand total', async () => {
    const res = await placeOrder(ownerToken, {
      payments: [
        { method: 'bkash', amount: 100 },
        { method: 'cash', amount: 100 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SPLIT_MISMATCH');
  });

  it('rejects online inside a split (gateway is single-session)', async () => {
    const res = await placeOrder(ownerToken, {
      payments: [
        { method: 'bkash', amount: 125 },
        { method: 'online', amount: 125 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SPLIT_NOT_SUPPORTED');
  });

  it('rejects a single-part split', async () => {
    const res = await placeOrder(ownerToken, {
      payments: [{ method: 'cash', amount: 250 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a disabled method inside a split', async () => {
    await request(app)
      .patch(`/api/tenants/${tenant.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ paymentMethods: { cash: { enabled: true }, bkash: { enabled: true }, card: { enabled: false } } });
    const res = await placeOrder(ownerToken, {
      payments: [
        { method: 'card', amount: 100 },
        { method: 'cash', amount: 150 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PAYMENT_METHOD');
    await request(app)
      .patch(`/api/tenants/${tenant.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        paymentMethods: {
          cash: { enabled: true },
          bkash: { enabled: true, number: '+8801711111111' },
          nagad: { enabled: true, number: '+8801622222222' },
          card: { enabled: true },
        },
      });
  });

  it('all-cash split is paid immediately', async () => {
    const res = await placeOrder(ownerToken, {
      payments: [
        { method: 'cash', amount: 100 },
        { method: 'cash', amount: 150 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.payment_status).toBe('paid');
    expect(res.body.payments.every((p) => p.status === 'paid')).toBe(true);
  });
});

describe('PATCH /api/payments/:id — confirm / refund', () => {
  it('confirms a bKash payment with a trxID and marks the order paid', async () => {
    const placed = await placeOrder(ownerToken, { payment_method: 'bkash' });
    const payment = placed.body.payments[0];

    const res = await request(app)
      .patch(`/api/payments/${payment.id}`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ status: 'paid', reference: 'TRX-12345' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'paid', reference: 'TRX-12345' });
    expect(res.body.paid_at).toBeTruthy();

    const order = await Order.findByPk(placed.body.id);
    expect(order.payment_status).toBe('paid');
  });

  it('refunds a payment and flips the order back to unpaid', async () => {
    const placed = await placeOrder(ownerToken, { payment_method: 'nagad' });
    const payment = placed.body.payments[0];

    const res = await request(app)
      .patch(`/api/payments/${payment.id}`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ status: 'refunded' });
    expect(res.status).toBe(200);

    const order = await Order.findByPk(placed.body.id);
    expect(order.payment_status).toBe('refunded');
  });

  it('rejects an invalid status with 400', async () => {
    const placed = await placeOrder(ownerToken, { payment_method: 'bkash' });
    const res = await request(app)
      .patch(`/api/payments/${placed.body.payments[0].id}`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ status: 'hacked' });
    expect(res.status).toBe(400);
  });

  it('is tenant-scoped — other workspaces cannot touch this payment', async () => {
    const otherOwner = await User.create({
      name: 'Other Owner',
      email: 'payotherowner@example.com',
      password: await bcrypt.hash('password123', 10),
      platform_role: 'member',
    });
    await UserTenant.create({ user_id: otherOwner.id, tenant_id: otherTenant.id, role: 'owner' });
    const otherToken = await login('payotherowner@example.com');

    const placed = await placeOrder(ownerToken, { payment_method: 'bkash' });
    const res = await request(app)
      .patch(`/api/payments/${placed.body.payments[0].id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ status: 'paid' });
    expect(res.status).toBe(404);
  });

  it('requires place:orders — a kitchen member is rejected', async () => {
    const placed = await placeOrder(ownerToken, { payment_method: 'bkash' });
    const res = await request(app)
      .patch(`/api/payments/${placed.body.payments[0].id}`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'paid' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/payments', () => {
  it('lists payments for an order (tenant-scoped)', async () => {
    const placed = await placeOrder(ownerToken, { payment_method: 'nagad' });
    const res = await request(app)
      .get(`/api/payments?orderId=${placed.body.id}`)
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].method).toBe('nagad');
  });

  it('returns an empty list for another workspace', async () => {
    const placed = await placeOrder(ownerToken, { payment_method: 'bkash' });
    const otherOwner = await User.create({
      name: 'Other Owner 2',
      email: 'payotherowner2@example.com',
      password: await bcrypt.hash('password123', 10),
      platform_role: 'member',
    });
    await UserTenant.create({ user_id: otherOwner.id, tenant_id: otherTenant.id, role: 'owner' });
    const otherToken = await login('payotherowner2@example.com');

    const res = await request(app)
      .get(`/api/payments?orderId=${placed.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/payments');
    expect(res.status).toBe(401);
  });
});
