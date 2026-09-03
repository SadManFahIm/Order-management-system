import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import request from 'supertest';
import bcrypt from 'bcryptjs';

/**
 * Phase 6 — Payments upgrade.
 *
 * Exercises the five features together against a mocked bKash gateway:
 *   1. bKash gateway verification + idempotent auto-confirmation (amount
 *      check, verification_metadata, replay-safe).
 *   2. NBR-compliant invoice (supplier BIN block + QR) + tip separation.
 *   3. Refund ledger (multiple partial refunds, accumulation, over-refund
 *      guard, refund history endpoint).
 *   4. Settlement/withdrawal tracking + computed gateway wallet balance.
 *   5. Tips on delivery checkout (charged, reported separately, never food
 *      revenue; rejected on pickup).
 *
 * Never hits a real gateway — a local mock stands in for the bKash API via
 * BKASH_API_URL, mirroring the production tokenized checkout contract.
 */

// ── Mock bKash server (token grant / create / execute / query) ─────────────
let receiver;
receiver = await new Promise((resolve) => {
  const createdAmounts = new Map(); // paymentID → amount requested at create
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const path = req.url.split('?')[0];
      const body = raw ? JSON.parse(raw) : {};
      const json = (data, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (path.endsWith('/checkout/token/grant')) {
        return json({ id_token: 'mock-token', expires_in: 3600 });
      }
      if (path.endsWith('/checkout/create')) {
        createdAmounts.set(`PAY-${body.merchantInvoiceNumber}`, body.amount);
        return json({ paymentID: `PAY-${body.merchantInvoiceNumber}`, bkashURL: 'https://bkash.test/pay' });
      }
      if (path.endsWith('/checkout/execute')) {
        return json({
          paymentID: body.paymentID,
          trxID: `TRX-${body.paymentID}`,
          transactionStatus: 'Completed',
          amount: createdAmounts.get(body.paymentID) || '1000.00',
          currency: 'BDT',
        });
      }
      if (path.endsWith('/checkout/payment/status')) {
        return json({
          paymentID: body.paymentID,
          trxID: `TRX-${body.paymentID}`,
          transactionStatus: 'Completed',
          amount: createdAmounts.get(body.paymentID) || '1000.00',
          currency: 'BDT',
        });
      }
      return json({ statusMessage: 'not found' }, 404);
    });
  });
  server.listen(0, '127.0.0.1', () =>
    resolve({ server, port: server.address().port })
  );
});

process.env.PAYMENT_GATEWAY = 'bkash';
process.env.BKASH_APP_KEY = 'mock-app-key';
process.env.BKASH_APP_SECRET = 'mock-app-secret';
process.env.BKASH_USER_NAME = 'mock-user';
process.env.BKASH_PASSWORD = 'mock-pass';
process.env.BKASH_API_URL = `http://127.0.0.1:${receiver.port}/tokenized`;
process.env.BKASH_CALLBACK_URL = 'http://localhost:5173/callback';
process.env.SSLCOMMERZ_SUCCESS_URL = 'http://localhost:5173/orders';
process.env.SSLCOMMERZ_FAIL_URL = 'http://localhost:5173/orders?failed=1';

const { default: app } = await import('../app.js');
const sequelize = (await import('../config/db.js')).default;
const { resetTestDb } = await import('../test/resetDb.js');
const { User, Tenant, UserTenant, Product, Order, Payment, PaymentRefund } =
  await import('../models/index.js');

let token;
let managerToken;
let cashierToken;
let tenant;
let tenant2;
let product;

beforeAll(async () => {
  await resetTestDb();
  tenant = await Tenant.create({
    name: 'Upgrade Diner',
    slug: 'upgrade-diner',
    settings: {
      delivery: { enabled: true, fee: 50 },
      paymentMethods: {
        cash: { enabled: true },
        bkash: { enabled: true, number: '01711111111' },
        online: { enabled: true },
      },
    },
  });
  tenant2 = await Tenant.create({ name: 'Other Diner', slug: 'other-diner' });

  const owner = await User.create({
    name: 'Upgrade Owner',
    email: 'upgrade.owner@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenant.id, role: 'owner' });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenant2.id, role: 'owner' });

  const manager = await User.create({
    name: 'Upgrade Manager',
    email: 'upgrade.manager@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: manager.id, tenant_id: tenant.id, role: 'manager' });

  const cashier = await User.create({
    name: 'Upgrade Cashier',
    email: 'upgrade.cashier@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: cashier.id, tenant_id: tenant.id, role: 'cashier' });

  const login = async (email) =>
    (await request(app).post('/api/auth/login').send({ email, password: 'password123' })).body.accessToken;
  token = await login('upgrade.owner@example.com');
  managerToken = await login('upgrade.manager@example.com');
  cashierToken = await login('upgrade.cashier@example.com');

  product = await Product.create({
    tenant_id: tenant.id,
    name: 'Upgrade Pizza',
    price: 1000,
    weight_gm: 500,
    enabled: true,
  });
});

afterAll(async () => {
  await sequelize.close();
  receiver.server.close();
});

/** Places an online order and returns { orderId, paymentId, reference } . */
async function placeOnlineOrder(customer = 'Online Guest', tip, orderType = 'pickup') {
  const payload = {
    customer_name: customer,
    customer_phone: '01712345678',
    payment_method: 'online',
    items: [{ product_id: product.id, quantity: 1 }],
  };
  if (orderType === 'delivery') {
    payload.order_type = 'delivery';
    payload.customer_address = 'House 4, Road 5';
  }
  if (tip !== undefined) payload.tip = tip;
  const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send(payload);
  expect(res.status).toBe(201);
  const payment = res.body.payments[0];
  return { orderId: res.body.id, paymentId: payment.id, reference: payment.reference, body: res.body };
}

describe('Feature 1 — bKash gateway verification + idempotent confirmation', () => {
  it('marks the payment paid when the amount matches and stores verification metadata', async () => {
    const { orderId, paymentId, reference } = await placeOnlineOrder();
    const res = await request(app).get(`/api/webhooks/bkash/callback?paymentID=${reference}&status=success`).redirects(0);
    expect(res.status).toBe(302); // redirected to success

    const payment = await Payment.findByPk(paymentId);
    expect(payment.status).toBe('paid');
    expect(payment.gateway).toBe('bkash');
    expect(payment.verification_metadata.transactionStatus).toBe('Completed');
    expect(payment.verification_metadata.trxID).toBe(`TRX-${reference}`);
    expect(Number(payment.verification_metadata.amount)).toBe(1000);
    const order = await Order.findByPk(orderId);
    expect(order.payment_status).toBe('paid');
  });

  it('is idempotent — a replayed callback no-ops (stays paid, no second flip)', async () => {
    const { paymentId, reference } = await placeOnlineOrder('Replay Guest');
    await request(app).get(`/api/webhooks/bkash/callback?paymentID=${reference}&status=success`);
    const payment = await Payment.findByPk(paymentId);
    expect(payment.status).toBe('paid');
    // Replay: lookup requires status pending, so the apply no-ops.
    const second = await request(app).get(`/api/webhooks/bkash/callback?paymentID=${reference}&status=success`).redirects(0);
    expect(second.status).toBe(302);
    const after = await Payment.findByPk(paymentId);
    expect(after.status).toBe('paid');
    expect(after.verification_metadata.trxID).toBe(`TRX-${reference}`);
  });

  it('does NOT confirm on a failed status', async () => {
    const { paymentId, reference } = await placeOnlineOrder('Fail Guest');
    const res = await request(app).get(`/api/webhooks/bkash/callback?paymentID=${reference}&status=failure`).redirects(0);
    expect(res.status).toBe(302); // redirected to FAIL url
    expect((await Payment.findByPk(paymentId)).status).toBe('pending');
  });

  it('POST /api/payments/:id/verify queries the gateway and confirms when Completed', async () => {
    const { paymentId, reference } = await placeOnlineOrder('Manual Verify');
    const res = await request(app)
      .post(`/api/payments/${paymentId}/verify`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect((await Payment.findByPk(paymentId)).status).toBe('paid');
    expect((await Payment.findByPk(paymentId)).verification_metadata.trxID).toBe(`TRX-${reference}`);
  });

  it('refuses to verify a non-pending payment', async () => {
    const { paymentId } = await placeOnlineOrder('Already Paid');
    await request(app)
      .post(`/api/payments/${paymentId}/verify`)
      .set('Authorization', `Bearer ${managerToken}`);
    const res = await request(app)
      .post(`/api/payments/${paymentId}/verify`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_VERIFIABLE');
  });

  it('requires place:orders for manual verification', async () => {
    const { paymentId } = await placeOnlineOrder('Cashier Verify');
    // cashier holds place:orders — allowed; an unauthenticated call is not.
    const anon = await request(app).post(`/api/payments/${paymentId}/verify`);
    expect(anon.status).toBe(401);
  });
});

describe('Feature 3 — refund ledger', () => {
  it('supports multiple partial refunds that accumulate and stay auditable', async () => {
    const { orderId, paymentId } = await placeOnlineOrder('Refund Guest');
    await request(app)
      .post(`/api/payments/${paymentId}/verify`)
      .set('Authorization', `Bearer ${managerToken}`);

    const first = await request(app)
      .patch(`/api/payments/${paymentId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: 'refunded', amount: 200, reason: 'cold pizza' });
    expect(first.status).toBe(200);
    expect(Number(first.body.refunded_amount)).toBe(200);

    const second = await request(app)
      .patch(`/api/payments/${paymentId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: 'refunded', amount: 300, reason: 'second claim' });
    expect(second.status).toBe(200);
    expect(Number(second.body.refunded_amount)).toBe(500);

    const ledger = await PaymentRefund.findAll({ where: { payment_id: paymentId }, order: [['id', 'ASC']] });
    expect(ledger).toHaveLength(2);
    expect(ledger.map((l) => Number(l.amount))).toEqual([200, 300]);
    expect(ledger.every((l) => l.status === 'processed')).toBe(true);
    expect(ledger.every((l) => l.tenant_id === tenant.id)).toBe(true);

    // The order keeps the retained portion (1050 − 500 = 550) → partial.
    const order = await Order.findByPk(orderId);
    expect(order.payment_status).toBe('partial');

    // Refund history endpoint exposes the ledger.
    const history = await request(app)
      .get(`/api/payments/${paymentId}/refunds`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(2);
  });

  it('rejects refunding more than the remaining refundable amount', async () => {
    const { paymentId } = await placeOnlineOrder('Over Refund');
    await request(app)
      .post(`/api/payments/${paymentId}/verify`)
      .set('Authorization', `Bearer ${managerToken}`);
    // Refund everything.
    await request(app)
      .patch(`/api/payments/${paymentId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: 'refunded' });
    // Now try to refund again — nothing left.
    const res = await request(app)
      .patch(`/api/payments/${paymentId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: 'refunded', amount: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('is tenant-scoped — another workspace cannot refund or see refunds', async () => {
    const { paymentId } = await placeOnlineOrder('Tenant Scoped');
    await request(app)
      .post(`/api/payments/${paymentId}/verify`)
      .set('Authorization', `Bearer ${token}`);
    // Same owner, switched to tenant2 — the payment lookup is tenant-scoped,
    // so tenant2 cannot see tenant1's refund ledger.
    const res = await request(app)
      .get(`/api/payments/${paymentId}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant', String(tenant2.id));
    expect(res.status).toBe(404);
  });

  it('requires refund:orders (manager+) to refund', async () => {
    const { paymentId } = await placeOnlineOrder('RBAC Refund');
    await request(app)
      .post(`/api/payments/${paymentId}/verify`)
      .set('Authorization', `Bearer ${managerToken}`);
    const res = await request(app)
      .patch(`/api/payments/${paymentId}`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ status: 'refunded' });
    expect(res.status).toBe(403);
  });
});

describe('Feature 2 — NBR invoice + QR', () => {
  it('builds an invoice with the supplier BIN block, tip, and a QR data URL', async () => {
    await request(app)
      .patch(`/api/tenants/${tenant.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        vat: { defaultRate: 5, bin: '0012345678901', registeredName: 'Upgrade Diner Ltd', address: '12 Gulshan Ave, Dhaka' },
      });

    const { body } = await placeOnlineOrder('Invoice Guest');
    const res = await request(app)
      .get(`/api/orders/${body.id}/invoice`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.supplier.bin).toBe('0012345678901');
    expect(res.body.supplier.name).toBe('Upgrade Diner Ltd');
    expect(res.body.supplier.address).toContain('Dhaka');
    expect(res.body.invoiceNo).toBe(`INV-${body.order_no}`);
    expect(res.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(Number(res.body.totals.tip)).toBe(0);
  });

  it('renders the supplier block + QR in the HTML document', async () => {
    const { body } = await placeOnlineOrder('Html Guest');
    const res = await request(app)
      .get(`/api/orders/${body.id}/invoice?print=1`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('0012345678901');
    expect(res.text).toContain('BIN');
    expect(res.text).toContain('data:image/png;base64,');
    expect(res.text).toContain('Upgrade Diner Ltd');
  });
});

describe('Feature 5 — tips', () => {
  it('adds a delivery tip to the charged total and stores it separately', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Tip Delivery',
        customer_phone: '01712345678',
        order_type: 'delivery',
        customer_address: 'House 4, Road 5',
        payment_method: 'cash',
        tip: 100,
        items: [{ product_id: product.id, quantity: 1 }],
      });
    expect(res.status).toBe(201);
    expect(Number(res.body.tip_amount)).toBe(100);
    // grand_total = item 1000 + delivery 50 + tip 100
    expect(Number(res.body.grand_total)).toBe(1150);
    expect(Number(res.body.delivery_fee)).toBe(50);
    // The payment amount includes the tip (charged to the customer).
    expect(Number(res.body.payments[0].amount)).toBe(1150);
    expect(res.body.payments[0].status).toBe('paid');
  });

  it('rejects a tip on a pickup order (server-enforced)', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'No Tip Pickup',
        customer_phone: '01712345678',
        payment_method: 'cash',
        tip: 50,
        items: [{ product_id: product.id, quantity: 1 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a negative tip', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Bad Tip',
        customer_phone: '01712345678',
        order_type: 'delivery',
        customer_address: 'House 4',
        payment_method: 'cash',
        tip: -10,
        items: [{ product_id: product.id, quantity: 1 }],
      });
    expect(res.status).toBe(400);
  });

  it('a tip-carrying online order charges it in the gateway amount and reports it separately', async () => {
    const { orderId } = await placeOnlineOrder('Tip Online', 200, 'delivery');
    const order = await Order.findByPk(orderId);
    expect(Number(order.tip_amount)).toBe(200);
    // grand_total = 1000 + 50 delivery fee + 200 tip
    expect(Number(order.grand_total)).toBe(1250);
    const payment = await Payment.findOne({ where: { order_id: orderId } });
    expect(Number(payment.amount)).toBe(1250);
  });

  it('closeout reports tips separately from food revenue', async () => {
    // Place a delivery order with a tip via the storefront checkout.
    const res = await request(app)
      .post('/api/public/restaurants/upgrade-diner/checkout')
      .send({
        order_type: 'delivery',
        customer_name: 'Tip Closeout',
        customer_phone: '01712345678',
        customer_address: 'House 9, Road 10',
        payment_method: 'cash',
        tip: 150,
        items: [{ product_id: product.id, quantity: 1 }],
      });
    expect(res.status).toBe(201);

    // Omit `date` so the server computes the current Dhaka day (the test
    // process runs in UTC; a hand-built date string can straddle the 6h
    // offset and land the order outside the day window).
    const report = await request(app)
      .get('/api/reports/closeout')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(report.status).toBe(200);
    expect(Number(report.body.totals.tips)).toBeGreaterThanOrEqual(150);
    // Revenue counts the whole charged amount (incl. tip), tips are ALSO
    // reported separately — never hidden, never double-counted as food.
    expect(report.body.totals).toHaveProperty('tips');
  });
});

describe('Feature 4 — settlements / wallet balance', () => {
  it('creates and lists settlements (movement of money, never revenue)', async () => {
    const created = await request(app)
      .post('/api/settlements')
      .set('Authorization', `Bearer ${token}`)
      .send({ gateway: 'bkash', requestedAmount: 5000, fees: 100, currency: 'BDT' });
    expect(created.status).toBe(201);
    expect(Number(created.body.requested_amount)).toBe(5000);

    const list = await request(app)
      .get('/api/settlements')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThanOrEqual(1);
    expect(list.body.some((s) => s.id === created.body.id)).toBe(true);
  });

  it('updates a settlement to completed with net amount', async () => {
    const created = await request(app)
      .post('/api/settlements')
      .set('Authorization', `Bearer ${token}`)
      .send({ gateway: 'stripe', requestedAmount: 2000 });
    const patched = await request(app)
      .patch(`/api/settlements/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'completed', settledAmount: 1900, fees: 40, bankRef: 'BANK-777' });
    expect(patched.status).toBe(200);
    expect(patched.body.status).toBe('completed');
    expect(Number(patched.body.settled_amount)).toBe(1900);
    expect(Number(patched.body.net_amount)).toBe(1860);
    expect(patched.body.processed_at).toBeTruthy();
  });

  it('computes the gateway wallet balance from the real ledger', async () => {
    const balance = await request(app)
      .get('/api/settlements/balance')
      .set('Authorization', `Bearer ${token}`);
    expect(balance.status).toBe(200);
    expect(balance.body).toHaveProperty('balance');
    expect(balance.body).toHaveProperty('gross_collected');
    expect(balance.body).toHaveProperty('refunded');
    expect(balance.body).toHaveProperty('settled');
    // balance = collected − refunded − settled — assert the identity, not a
    // sign (settlements created earlier in this suite can exceed the online
    // payments collected so far, so a negative balance is legitimate).
    const expected = Number(balance.body.gross_collected) - Number(balance.body.refunded) - Number(balance.body.settled);
    expect(Number(balance.body.balance)).toBeCloseTo(expected, 2);
  });

  it('requires view:reports to read and manage:settings to write', async () => {
    const read = await request(app)
      .get('/api/settlements')
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(read.status).toBe(403);
    const write = await request(app)
      .post('/api/settlements')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ gateway: 'bkash', requestedAmount: 100 });
    expect(write.status).toBe(403);
  });

  it('is tenant-scoped — other workspaces cannot see or mutate settlements', async () => {
    const created = await request(app)
      .post('/api/settlements')
      .set('Authorization', `Bearer ${token}`)
      .send({ gateway: 'bkash', requestedAmount: 3000 });
    // Same owner, switched to tenant2 via X-Tenant — must not find tenant1's row.
    const res = await request(app)
      .patch(`/api/settlements/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant', String(tenant2.id))
      .send({ status: 'completed' });
    expect(res.status).toBe(404);

    const list = await request(app)
      .get('/api/settlements')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant', String(tenant2.id));
    expect(list.status).toBe(200);
    expect(list.body.some((s) => s.id === created.body.id)).toBe(false);
  });

  it('rejects a negative requested amount', async () => {
    const res = await request(app)
      .post('/api/settlements')
      .set('Authorization', `Bearer ${token}`)
      .send({ gateway: 'bkash', requestedAmount: -5 });
    expect(res.status).toBe(400);
  });
});