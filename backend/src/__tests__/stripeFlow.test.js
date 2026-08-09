import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import bcrypt from 'bcryptjs';

/**
 * Stripe test-mode end-to-end (Phase 5) — the full checkout flow against a
 * mock Stripe API (env override STRIPE_API_URL), including the HMAC-SHA256
 * webhook signature the real gateway sends. Complements the sandbox harness
 * (scripts/gateway-sandbox.mjs + gateway-e2e.mjs) in the CI suite.
 */

// ── Stripe env must be set before the env/config modules load ─────────────
const mockStripe = await new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const params = new URLSearchParams(raw);
      const id = `cs_test_${Math.random().toString(36).slice(2, 10)}`;
      const amount = Number(params.get('line_items[0][price_data][unit_amount]') || 0);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id,
          object: 'checkout.session',
          url: `https://checkout.stripe.com/test/${id}`,
          amount_total: amount,
          payment_status: 'unpaid',
        })
      );
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
});

process.env.PAYMENT_GATEWAY = 'stripe';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test-e2e-abcdef';
process.env.STRIPE_API_URL = `http://127.0.0.1:${mockStripe.port}`;
process.env.SSLCOMMERZ_SUCCESS_URL = 'http://localhost:5173/orders';
process.env.SSLCOMMERZ_CANCEL_URL = 'http://localhost:5173/orders';

const { default: app } = await import('../app.js');
const sequelize = (await import('../config/db.js')).default;
const { resetTestDb } = await import('../test/resetDb.js');
const { User, Tenant, UserTenant, Product, Order, Payment } = await import('../models/index.js');

const sign = (rawBody) => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
};

let token;
let tenant;
let product;

beforeAll(async () => {
  await resetTestDb();
  tenant = await Tenant.create({ name: 'Stripe Diner', slug: 'stripe-diner' });
  const owner = await User.create({
    name: 'Stripe Owner',
    email: 'stripeowner@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenant.id, role: 'owner' });
  token = (await request(app).post('/api/auth/login').send({ email: 'stripeowner@example.com', password: 'password123' })).body.accessToken;

  product = await Product.create({
    tenant_id: tenant.id,
    name: 'Stripe Combo',
    price: 520,
    weight_gm: 400,
    enabled: true,
  });
  await request(app)
    .patch(`/api/tenants/${tenant.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ paymentMethods: { cash: { enabled: true }, online: { enabled: true } } });
});

afterAll(async () => {
  await sequelize.close();
  mockStripe.server.close();
});

describe('Stripe checkout flow — full loop', () => {
  it('creates an order with a Stripe Checkout URL and a pending payment', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Stripe Guest',
        customer_phone: '01712345678',
        payment_method: 'online',
        items: [{ product_id: product.id, quantity: 2 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.gateway).toBe('stripe');
    expect(res.body.payment_status).toBe('pending');
    expect(res.body.paymentUrl).toMatch(/^https:\/\/checkout\.stripe\.com\/test\/cs_test_/);
    expect(res.body.payments[0].reference).toMatch(/^cs_test_/);
  });

  it('confirms the payment via a signed checkout.session.completed webhook', async () => {
    const placed = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Stripe Pay Guest',
        customer_phone: '01712345678',
        payment_method: 'online',
        items: [{ product_id: product.id, quantity: 1 }],
      });
    const paymentId = placed.body.payments[0].id;
    const sessionId = placed.body.payments[0].reference;

    const event = JSON.stringify({
      id: 'evt_test_1',
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: { id: sessionId, payment_intent: 'pi_test_987654' } },
    });

    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', sign(event))
      .send(event);
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const payment = await Payment.findByPk(paymentId);
    expect(payment.status).toBe('paid');
    expect(payment.reference).toBe('pi_test_987654'); // gateway intent recorded
    const order = await Order.findByPk(payment.order_id);
    expect(order.payment_status).toBe('paid');
  });

  it('rejects a webhook with a tampered body (signature mismatch)', async () => {
    const placed = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Stripe Forge Guest',
        payment_method: 'online',
        items: [{ product_id: product.id, quantity: 1 }],
      });
    const sessionId = placed.body.payments[0].reference;

    const legit = JSON.stringify({
      id: 'evt_test_2',
      type: 'checkout.session.completed',
      data: { object: { id: sessionId } },
    });
    const tampered = legit.replace('evt_test_2', 'evt_test_3');

    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', sign(legit))
      .send(tampered);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');

    const payment = await Payment.findOne({ where: { reference: sessionId } });
    expect(payment.status).toBe('pending');
  });
});
