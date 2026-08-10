import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import request from 'supertest';
import bcrypt from 'bcryptjs';

/**
 * bKash Tokenized Checkout test-mode end-to-end (Phase 6) — the full flow
 * against a mock bKash API (env override BKASH_API_URL):
 *
 *   grant token → create payment (bkashURL) → callback → execute → paid.
 *
 * The callback is UNSIGNED (the customer's browser redirect), so the real
 * verification is the execute round-trip against the gateway — a bogus or
 * canceled callback must never mark a payment paid. Mirrors the sandbox
 * harness (scripts/gateway-sandbox.mjs + gateway-e2e.mjs) in the CI suite.
 */

// ── bKash env must be set before the env/config modules load ──────────────
let grantCount = 0;
const mockBkash = await new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      const send = (code, data) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (req.url.endsWith('/checkout/token/grant') && req.method === 'POST') {
        grantCount += 1;
        return send(200, {
          id_token: `id_token_test_${grantCount}`,
          refresh_token: 'refresh_test',
          expires_in: 3600,
        });
      }
      if (req.url.endsWith('/checkout/create') && req.method === 'POST') {
        const paymentID = `TR00TEST${String(Date.now()).slice(-10)}`;
        return send(200, {
          paymentID,
          bkashURL: `https://pay.bkash.com/payment/${paymentID}`,
          status: 'Initiated',
        });
      }
      if (req.url.endsWith('/checkout/execute') && req.method === 'POST') {
        const paymentID = body.paymentID;
        if (!paymentID || !paymentID.startsWith('TR00TEST')) {
          return send(400, { statusMessage: 'Payment not found' });
        }
        return send(200, {
          paymentID,
          trxID: `TRX-${paymentID}`,
          transactionStatus: 'Completed',
          amount: '300.00',
          currency: 'BDT',
        });
      }
      send(404, { statusMessage: 'Unknown endpoint' });
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
});

process.env.PAYMENT_GATEWAY = 'bkash';
process.env.BKASH_APP_KEY = 'test-app-key';
process.env.BKASH_APP_SECRET = 'test-app-secret';
process.env.BKASH_USER_NAME = '01700000000';
process.env.BKASH_PASSWORD = 'test-password';
process.env.BKASH_API_URL = `http://127.0.0.1:${mockBkash.port}/tokenized`;
process.env.BKASH_CALLBACK_URL = 'http://localhost:4000/api/webhooks/bkash/callback';
process.env.SSLCOMMERZ_SUCCESS_URL = 'http://localhost:5173/orders?paid=1';
process.env.SSLCOMMERZ_FAIL_URL = 'http://localhost:5173/orders?failed=1';

const { default: app } = await import('../app.js');
const sequelize = (await import('../config/db.js')).default;
const { resetTestDb } = await import('../test/resetDb.js');
const { User, Tenant, UserTenant, Product, Order, Payment } = await import('../models/index.js');

let token;
let tenant;
let product;

beforeAll(async () => {
  await resetTestDb();
  tenant = await Tenant.create({ name: 'bKash Diner', slug: 'bkash-diner' });
  const owner = await User.create({
    name: 'bKash Owner',
    email: 'bkashowner@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenant.id, role: 'owner' });
  token = (
    await request(app).post('/api/auth/login').send({ email: 'bkashowner@example.com', password: 'password123' })
  ).body.accessToken;

  product = await Product.create({
    tenant_id: tenant.id,
    name: 'bKash Combo',
    price: 300,
    weight_gm: 350,
    enabled: true,
  });
  await request(app)
    .patch(`/api/tenants/${tenant.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ paymentMethods: { cash: { enabled: true }, online: { enabled: true } } });
});

afterAll(async () => {
  await sequelize.close();
  mockBkash.server.close();
});

/** Places an online order and returns { order, paymentId, paymentID }. */
async function placeOnlineOrder(name = 'bKash Guest') {
  const res = await request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      customer_name: name,
      customer_phone: '01712345678',
      payment_method: 'online',
      items: [{ product_id: product.id, quantity: 1 }],
    });
  expect(res.status).toBe(201);
  return {
    order: res.body,
    paymentId: res.body.payments[0].id,
    paymentID: res.body.payments[0].reference,
  };
}

describe('bKash checkout flow — full loop', () => {
  it('creates an order with a bKash URL and a pending payment', async () => {
    const { order } = await placeOnlineOrder();
    expect(order.gateway).toBe('bkash');
    expect(order.payment_status).toBe('pending');
    expect(order.paymentUrl).toMatch(/^https:\/\/pay\.bkash\.com\/payment\/TR00TEST/);
    expect(order.payments[0].reference).toMatch(/^TR00TEST/);
  });

  it('confirms the payment via the callback → execute round-trip', async () => {
    const { paymentId, paymentID } = await placeOnlineOrder('bKash Pay Guest');

    // The customer's browser is redirected to the callback after paying.
    const res = await request(app)
      .get('/api/webhooks/bkash/callback')
      .query({ paymentID, status: 'success' })
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(process.env.SSLCOMMERZ_SUCCESS_URL);

    const payment = await Payment.findByPk(paymentId);
    expect(payment.status).toBe('paid');
    expect(payment.reference).toBe(`TRX-${paymentID}`); // gateway trxID recorded
    const order = await Order.findByPk(payment.order_id);
    expect(order.payment_status).toBe('paid');
  });

  it('is idempotent — a replayed callback no-ops', async () => {
    const { paymentId, paymentID } = await placeOnlineOrder('bKash Replay Guest');

    await request(app).get('/api/webhooks/bkash/callback').query({ paymentID, status: 'success' });
    const afterFirst = await Payment.findByPk(paymentId);
    expect(afterFirst.status).toBe('paid');

    // Replaying the callback must not change anything (still the trxID).
    await request(app).get('/api/webhooks/bkash/callback').query({ paymentID, status: 'success' });
    const afterReplay = await Payment.findByPk(paymentId);
    expect(afterReplay.status).toBe('paid');
    expect(afterReplay.reference).toBe(afterFirst.reference);
  });

  it('rejects a bogus paymentID — execute fails, nothing is marked paid', async () => {
    const res = await request(app)
      .get('/api/webhooks/bkash/callback')
      .query({ paymentID: 'TR00FORGED1234567890', status: 'success' });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('GATEWAY_ERROR');
    // No payment was created or mutated by the forged callback.
    expect(await Payment.findOne({ where: { reference: 'TRX-TR00FORGED1234567890' } })).toBeNull();
  });

  it('leaves payments pending when the callback reports a cancel/failure', async () => {
    const { paymentId, paymentID } = await placeOnlineOrder('bKash Cancel Guest');

    const res = await request(app)
      .get('/api/webhooks/bkash/callback')
      .query({ paymentID, status: 'cancel' })
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(process.env.SSLCOMMERZ_FAIL_URL);

    const payment = await Payment.findByPk(paymentId);
    expect(payment.status).toBe('pending');
  });

  it('rejects a callback without a paymentID', async () => {
    const res = await request(app).get('/api/webhooks/bkash/callback').query({ status: 'success' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('caches the grant token — create + execute share one grant', async () => {
    const before = grantCount;
    await placeOnlineOrder('bKash Cache Guest');
    // A second order reuses the cached token for both create and execute.
    await placeOnlineOrder('bKash Cache Guest 2');
    expect(grantCount - before).toBeLessThanOrEqual(1);
  });
});
