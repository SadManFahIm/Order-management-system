import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import request from 'supertest';
import bcrypt from 'bcryptjs';

/**
 * Online payment gateway (Phase 5) — SSLCommerz + Stripe.
 *
 * A local mock server stands in for the SSLCommerz API (env override
 * SSLCOMMERZ_API_URL), and webhook authenticity is exercised with real
 * signature math: md5 for SSLCommerz, HMAC-SHA256 for Stripe.
 */

// ── Gateway env must be set before the env/config modules load ────────────
let receiver;
receiver = await new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      // The session-creation endpoint returns a fake hosted checkout URL.
      const body = new URLSearchParams(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'SUCCESS',
          GatewayPageURL: `https://pay.example.com/checkout/${body.get('tran_id') || 'x'}`,
        })
      );
    });
  });
  server.listen(0, '127.0.0.1', () =>
    resolve({ server, port: server.address().port })
  );
});

process.env.PAYMENT_GATEWAY = 'sslcommerz';
process.env.SSLCOMMERZ_STORE_ID = 'test-store';
process.env.SSLCOMMERZ_STORE_PASSWORD = 'test-store-pass';
process.env.SSLCOMMERZ_API_URL = `http://127.0.0.1:${receiver.port}/gwprocess/v4/api.php`;
process.env.SSLCOMMERZ_SUCCESS_URL = 'http://localhost:5173/orders';
process.env.SSLCOMMERZ_CANCEL_URL = 'http://localhost:5173/orders';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test-secret-123456';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';

const { default: app } = await import('../app.js');
const sequelize = (await import('../config/db.js')).default;
const { resetTestDb } = await import('../test/resetDb.js');
const {
  User,
  Tenant,
  UserTenant,
  Product,
  Order,
  Payment,
} = await import('../models/index.js');
const {
  verifyStripeSignature,
  applyGatewayConfirmation,
} = await import('../services/paymentGateway.js');

const md5 = (s) => createHash('md5').update(s).digest('hex');
const sslcommerzSign = (storePass, storeId, tranId, amount, currency, status) =>
  md5(`${storePass}${storeId}${tranId}${amount}${currency}${status}`);

let token;
let tenant;
let product;

beforeAll(async () => {
  await resetTestDb();
  tenant = await Tenant.create({ name: 'Gateway Diner', slug: 'gateway-diner' });
  const owner = await User.create({
    name: 'Gateway Owner',
    email: 'gatewayowner@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenant.id, role: 'owner' });
  token = (
    await request(app).post('/api/auth/login').send({ email: 'gatewayowner@example.com', password: 'password123' })
  ).body.accessToken;

  product = await Product.create({
    tenant_id: tenant.id,
    name: 'Gateway Burger',
    price: 300,
    weight_gm: 350,
    enabled: true,
  });

  // Accept online payments in this workspace.
  await request(app)
    .patch(`/api/tenants/${tenant.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ paymentMethods: { cash: { enabled: true }, online: { enabled: true } } });
});

afterAll(async () => {
  await sequelize.close();
  receiver.server.close();
});

describe('POST /api/orders — online payment flow', () => {
  it('creates the order, a pending payment, and a hosted checkout URL', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Online Guest',
        customer_phone: '01712345678',
        payment_method: 'online',
        items: [{ product_id: product.id, quantity: 1 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.payment_method).toBe('online');
    expect(res.body.payment_status).toBe('pending');
    expect(res.body.paymentUrl).toContain('https://pay.example.com/checkout/');
    expect(res.body.gateway).toBe('sslcommerz');
    // The gateway stamped its transaction id on the payment record.
    expect(res.body.payments[0].reference).toMatch(/^TXN-/);
  });

  it('rejects online when the workspace has not enabled it', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Nope Guest',
        payment_method: 'card',
        items: [{ product_id: product.id, quantity: 1 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PAYMENT_METHOD');
  });
});

describe('POST /api/webhooks/sslcommerz — confirmation', () => {
  it('marks the payment paid when the signature verifies', async () => {
    const placed = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Pay Guest',
        customer_phone: '01712345678',
        payment_method: 'online',
        items: [{ product_id: product.id, quantity: 1 }],
      });
    const paymentId = placed.body.payments[0].id;
    const tranId = placed.body.payments[0].reference;

    const res = await request(app)
      .post('/api/webhooks/sslcommerz')
      .type('form')
      .send({
        store_id: 'test-store',
        store_passwd: 'test-store-pass',
        tran_id: tranId,
        amount: '300.00',
        currency: 'BDT',
        status: 'VALID',
        val_id: 'VAL-98765',
        verify_sign: sslcommerzSign('test-store-pass', 'test-store', tranId, '300.00', 'BDT', 'VALID'),
      });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(true);

    // The webhook overwrites `reference` with the gateway's val_id — look up
    // by payment id, and confirm the gateway transaction id was recorded.
    const payment = await Payment.findByPk(paymentId);
    expect(payment.status).toBe('paid');
    expect(payment.reference).toBe('VAL-98765');
    const order = await Order.findByPk(payment.order_id);
    expect(order.payment_status).toBe('paid');
  });

  it('rejects a forged signature and leaves the payment pending', async () => {
    const placed = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Forged Guest',
        payment_method: 'online',
        items: [{ product_id: product.id, quantity: 1 }],
      });
    const tranId = placed.body.payments[0].reference;

    const res = await request(app)
      .post('/api/webhooks/sslcommerz')
      .type('form')
      .send({
        store_id: 'test-store',
        store_passwd: 'test-store-pass',
        tran_id: tranId,
        amount: '300.00',
        currency: 'BDT',
        status: 'VALID',
        verify_sign: 'deadbeef',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');

    const payment = await Payment.findOne({ where: { reference: tranId } });
    expect(payment.status).toBe('pending');
  });

  it('is idempotent — a replayed webhook no-ops', async () => {
    const placed = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Replay Guest',
        payment_method: 'online',
        items: [{ product_id: product.id, quantity: 1 }],
      });
    const tranId = placed.body.payments[0].reference;
    const webhook = () =>
      request(app)
        .post('/api/webhooks/sslcommerz')
        .type('form')
        .send({
          store_id: 'test-store',
          store_passwd: 'test-store-pass',
          tran_id: tranId,
          amount: '300.00',
          currency: 'BDT',
          status: 'VALID',
          verify_sign: sslcommerzSign('test-store-pass', 'test-store', tranId, '300.00', 'BDT', 'VALID'),
        });

    expect((await webhook()).body.applied).toBe(true);
    expect((await webhook()).body.applied).toBe(false); // already paid
  });
});

describe('Stripe signature verification (HMAC-SHA256)', () => {
  const rawBody = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  it('accepts a valid signature', () => {
    expect(verifyStripeSignature(rawBody, `t=${timestamp},v1=${signature}`)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const tampered = rawBody.replace('evt_1', 'evt_2');
    expect(verifyStripeSignature(tampered, `t=${timestamp},v1=${signature}`)).toBe(false);
  });

  it('rejects a wrong secret / garbage header', () => {
    expect(verifyStripeSignature(rawBody, 'garbage')).toBe(false);
  });
});

describe('applyGatewayConfirmation', () => {
  it('returns null for an unknown reference (no partial writes)', async () => {
    expect(await applyGatewayConfirmation({ gateway: 'stripe', reference: 'cs_does_not_exist' })).toBeNull();
  });
});
