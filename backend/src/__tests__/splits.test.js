import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { Tenant, User, UserTenant, Product, Promotion, Order, Payment, OrderSplitItem, Table } from '../models/index.js';
import { computeEqualParts } from '../services/splitService.js';

/**
 * Dine-in split billing — cashier split panel + per-diner receipts +
 * split-method analytics (migration 013).
 *
 * A split replaces the order's payment rows with one row per diner
 * (cash → paid on the spot, wallets → pending) and records the item
 * allocation. All money math is server-side (integer paisa, exact-sum
 * invariant); these tests prove the client cannot over/under-allocate,
 * double-collect, cross tenants, or leave a half-written split behind.
 */

let tenantA;
let tenantB;
let managerToken;
let cashierToken;
let kitchenToken;
let managerBToken;
let burger;
let fries;
let pizza;
let orderId; // dine-in order: 2×Burger + 1×Fries (৳500), table 3
let orderItemIds = [];
let promoOrderId; // order placed under a 10% promotion (discount allocation)

const login = async (email) =>
  (await request(app).post('/api/auth/login').send({ email, password: 'password123' })).body
    .accessToken;

const placeDineIn = (token, items, over = {}) =>
  request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ customer_name: 'Dine In', table_no: 3, items, ...over });

const splitOrder = (token, id, body) =>
  request(app).post(`/api/orders/${id}/split`).set('Authorization', `Bearer ${token}`).send(body);

const getSplit = (token, id) =>
  request(app).get(`/api/orders/${id}/split`).set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  await resetTestDb();

  tenantA = await Tenant.create({
    name: 'Split Diner',
    slug: 'split-diner',
    settings: {
      paymentMethods: {
        cash: { enabled: true },
        bkash: { enabled: true, number: '01711111111' },
        nagad: { enabled: true, number: '01722222222' },
        // card intentionally NOT enabled — fail-closed method tests.
      },
    },
  });
  tenantB = await Tenant.create({ name: 'Split Beta', slug: 'split-beta' });

  // Physical table 3 for dine-in orders (validated at order creation).
  await Table.create({ tenant_id: tenantA.id, table_no: 3, name: 'Window', capacity: 4, is_active: true });

  const mk = async (name, email, role, tenant) => {
    const u = await User.create({
      name,
      email,
      password: await bcrypt.hash('password123', 10),
      platform_role: 'member',
    });
    await UserTenant.create({ user_id: u.id, tenant_id: tenant.id, role });
    return login(email);
  };
  managerToken = await mk('Split Mgr', 'splitmgr@example.com', 'manager', tenantA);
  cashierToken = await mk('Split Cash', 'splitcash@example.com', 'cashier', tenantA);
  kitchenToken = await mk('Split Kit', 'splitkit@example.com', 'kitchen', tenantA);
  managerBToken = await mk('Split Mgr B', 'splitmgrb@example.com', 'manager', tenantB);

  burger = await Product.create({ tenant_id: tenantA.id, name: 'Burger', price: 200, weight_gm: 250, enabled: true });
  fries = await Product.create({ tenant_id: tenantA.id, name: 'Fries', price: 100, weight_gm: 150, enabled: true });
  pizza = await Product.create({ tenant_id: tenantA.id, name: 'Pizza', price: 300, weight_gm: 400, enabled: true, vat_rate: 15 });
  await Product.create({ tenant_id: tenantB.id, name: 'Beta Item', price: 50, weight_gm: 50 });

  const res = await placeDineIn(managerToken, [
    { product_id: burger.id, quantity: 2 },
    { product_id: fries.id, quantity: 1 },
  ]);
  expect(res.status).toBe(201);
  orderId = res.body.id;
  expect(res.body.grand_total).toBe(500);
  // PG returns included rows in arbitrary order — resolve line ids by product
  // so orderItemIds[0] is always the Burger line (deterministic fixtures).
  const burgerLine = res.body.items.find((i) => i.product_id === burger.id);
  const friesLine = res.body.items.find((i) => i.product_id === fries.id);
  orderItemIds = [burgerLine.id, friesLine.id];

  // Promotion order — 10% off everything (line discounts to allocate).
  await Promotion.create({
    tenant_id: tenantA.id,
    title: 'Dash 10%',
    type: 'percentage',
    percentage_value: 10,
    enabled: true,
    start_date: new Date(Date.now() - 86400000),
    end_date: new Date(Date.now() + 86400000),
  });
  const promoRes = await placeDineIn(managerToken, [{ product_id: burger.id, quantity: 2 }]);
  expect(promoRes.status).toBe(201);
  expect(promoRes.body.grand_total).toBe(360); // 400 − 10%
  promoOrderId = promoRes.body.id;

  // Remove the promo so later orders in this suite price without discounts.
  await Promotion.destroy({ where: { tenant_id: tenantA.id } });
});

afterAll(async () => {
  await sequelize.close();
});

describe('split math (unit)', () => {
  it('equal split rounds ৳100 across 3 diners exactly (largest remainder)', () => {
    const parts = computeEqualParts(100, 3);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
    expect(parts.reduce((s, p) => s + p, 0)).toBeCloseTo(100, 5);
  });

  it('equal split on ৳500 across 3 diners sums exactly', () => {
    const parts = computeEqualParts(500, 3);
    expect(parts.reduce((s, p) => s + p, 0)).toBeCloseTo(500, 5);
    expect(parts.every((p) => p > 0)).toBe(true);
  });
});

describe('POST /api/orders/:id/split — item split', () => {
  it('splits by item: parts reconcile exactly, cash parts paid on the spot', async () => {
    const res = await splitOrder(cashierToken, orderId, {
      mode: 'item',
      diners: [
        { label: 'Rahim', method: 'cash' },
        { label: 'Karim', method: 'cash' },
      ],
      allocations: [
        { orderItemId: orderItemIds[0], quantity: 1, dinerIndex: 0 },
        { orderItemId: orderItemIds[0], quantity: 1, dinerIndex: 1 },
        { orderItemId: orderItemIds[1], quantity: 1, dinerIndex: 1 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.mode).toBe('item');
    expect(res.body.payment_status).toBe('paid'); // all-cash
    expect(res.body.parts).toHaveLength(2);
    expect(res.body.parts[0]).toMatchObject({ dinerLabel: 'Rahim', amount: 200, status: 'paid' });
    expect(res.body.parts[1]).toMatchObject({ dinerLabel: 'Karim', amount: 300, status: 'paid' });

    const state = await getSplit(managerToken, orderId);
    expect(state.status).toBe(200);
    expect(state.body.totals).toMatchObject({ grandTotal: 500, sumOfParts: 500, reconciles: true });
    expect(state.body.parts[0].items).toHaveLength(1);
    expect(state.body.parts[1].items).toHaveLength(2);

    const order = await Order.findByPk(orderId);
    expect(order.payment_method).toBe('split');
    expect(order.payment_status).toBe('paid');
  });

  it('rejects over-allocation with a precise 400 (nothing written)', async () => {
    const res = await splitOrder(cashierToken, orderId, {
      mode: 'item',
      diners: [
        { label: 'A', method: 'cash' },
        { label: 'B', method: 'cash' },
      ],
      allocations: [
        { orderItemId: orderItemIds[0], quantity: 3, dinerIndex: 0 }, // only 2 ordered
        { orderItemId: orderItemIds[1], quantity: 1, dinerIndex: 1 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SPLIT_ALLOCATION_INVALID');
    expect(res.body.error.message).toMatch(/Over-allocated: Burger/);

    // Rollback: the previous split is untouched.
    const state = await getSplit(managerToken, orderId);
    expect(state.body.totals.reconciles).toBe(true);
    expect(state.body.parts).toHaveLength(2);
  });

  it('rejects under-allocation (unassigned items) and unknown order items', async () => {
    const under = await splitOrder(cashierToken, orderId, {
      mode: 'item',
      diners: [
        { label: 'A', method: 'cash' },
        { label: 'B', method: 'cash' },
      ],
      allocations: [{ orderItemId: orderItemIds[0], quantity: 1, dinerIndex: 0 }],
    });
    expect(under.status).toBe(400);
    expect(under.body.error.message).toMatch(/Unassigned/);

    const unknown = await splitOrder(cashierToken, orderId, {
      mode: 'item',
      diners: [
        { label: 'A', method: 'cash' },
        { label: 'B', method: 'cash' },
      ],
      allocations: [
        { orderItemId: 999999, quantity: 1, dinerIndex: 0 },
        { orderItemId: orderItemIds[0], quantity: 2, dinerIndex: 1 },
        { orderItemId: orderItemIds[1], quantity: 1, dinerIndex: 1 },
      ],
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a disabled payment method for a part (fail-closed)', async () => {
    const res = await splitOrder(cashierToken, orderId, {
      mode: 'item',
      diners: [
        { label: 'A', method: 'card' },
        { label: 'B', method: 'card' },
      ],
      allocations: [
        { orderItemId: orderItemIds[0], quantity: 1, dinerIndex: 0 },
        { orderItemId: orderItemIds[0], quantity: 1, dinerIndex: 1 },
        { orderItemId: orderItemIds[1], quantity: 1, dinerIndex: 1 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PAYMENT_METHOD');
  });
});

describe('equal + custom splits', () => {
  it('equal split on a fresh ৳300 order / 3 diners sums exactly, mixed → partial', async () => {
    const fresh = await placeDineIn(managerToken, [
      { product_id: burger.id, quantity: 1 },
      { product_id: fries.id, quantity: 1 },
    ]);
    const res = await splitOrder(cashierToken, fresh.body.id, {
      mode: 'equal',
      diners: [
        { label: 'One', method: 'bkash' },
        { label: 'Two', method: 'cash' },
        { label: 'Three', method: 'cash' },
      ],
    });
    expect(res.status).toBe(201);
    const sum = res.body.parts.reduce((s, p) => s + p.amount, 0);
    expect(sum).toBeCloseTo(300, 5);
    expect(res.body.payment_status).toBe('partial');
    expect(res.body.parts[0]).toMatchObject({ method: 'bkash', status: 'pending' });
    expect(res.body.parts[1]).toMatchObject({ method: 'cash', status: 'paid' });
  });

  it('custom split validates the exact sum (mismatch → 400)', async () => {
    const fresh = await placeDineIn(managerToken, [
      { product_id: burger.id, quantity: 1 },
      { product_id: fries.id, quantity: 1 },
    ]);
    const ok = await splitOrder(cashierToken, fresh.body.id, {
      mode: 'custom',
      diners: [
        { label: 'A', method: 'cash', amount: 200 },
        { label: 'B', method: 'cash', amount: 100 },
      ],
    });
    expect(ok.status).toBe(201);
    expect(ok.body.parts.map((p) => p.amount).sort()).toEqual([100, 200]);

    const bad = await splitOrder(cashierToken, fresh.body.id, {
      mode: 'custom',
      diners: [
        { label: 'A', method: 'cash', amount: 250 },
        { label: 'B', method: 'cash', amount: 100 },
      ],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('SPLIT_MISMATCH');
  });
});

describe('payment reconciliation + guards', () => {
  it('duplicate submission replaces parts instead of double-collecting', async () => {
    const fresh = await placeDineIn(managerToken, [
      { product_id: burger.id, quantity: 1 },
      { product_id: fries.id, quantity: 1 },
    ]);
    await splitOrder(cashierToken, fresh.body.id, {
      mode: 'equal',
      diners: [
        { label: 'A', method: 'cash' },
        { label: 'B', method: 'cash' },
      ],
    });
    const res = await splitOrder(cashierToken, fresh.body.id, {
      mode: 'equal',
      diners: [
        { label: 'A', method: 'cash' },
        { label: 'B', method: 'cash' },
        { label: 'C', method: 'cash' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.parts).toHaveLength(3);
    const rows = await Payment.findAll({ where: { order_id: fresh.body.id } });
    expect(rows).toHaveLength(3); // replaced, not appended
    const collected = rows.reduce((s, r) => s + Number(r.amount), 0);
    expect(collected).toBeCloseTo(300, 5);
  });

  it('a collected wallet part blocks re-splitting (409 SPLIT_LOCKED)', async () => {
    const fresh = await placeDineIn(managerToken, [
      { product_id: burger.id, quantity: 1 },
      { product_id: fries.id, quantity: 1 },
    ]);
    await splitOrder(cashierToken, fresh.body.id, {
      mode: 'equal',
      diners: [
        { label: 'A', method: 'bkash' },
        { label: 'B', method: 'cash' },
      ],
    });
    const state = await getSplit(managerToken, fresh.body.id);
    const bkashPart = state.body.parts.find((p) => p.method === 'bkash');
    const confirm = await request(app)
      .patch(`/api/payments/${bkashPart.paymentId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: 'paid', reference: 'TRX-ABC-123' });
    expect(confirm.status).toBe(200);

    // The panel's GET state now surfaces the lock (with the reason), so the
    // cashier sees why before attempting a change.
    const after = await getSplit(managerToken, fresh.body.id);
    expect(after.body.locked).toBe(true);
    expect(after.body.lockReason).toMatch(/refund it first/);

    const res = await splitOrder(cashierToken, fresh.body.id, {
      mode: 'equal',
      diners: [
        { label: 'A', method: 'cash' },
        { label: 'B', method: 'cash' },
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SPLIT_LOCKED');
  });

  it('an all-cash split is not locked (re-splittable while nothing collected)', async () => {
    const fresh = await placeDineIn(managerToken, [{ product_id: burger.id, quantity: 1 }]);
    await splitOrder(cashierToken, fresh.body.id, {
      mode: 'equal',
      diners: [
        { label: 'A', method: 'cash' },
        { label: 'B', method: 'cash' },
      ],
    });
    const state = await getSplit(managerToken, fresh.body.id);
    expect(state.body.locked).toBe(false);
    expect(state.body.lockReason).toBeNull();
  });

  it('cannot split a canceled order', async () => {
    const c = await placeDineIn(managerToken, [{ product_id: burger.id, quantity: 1 }]);
    const cancel = await request(app)
      .patch(`/api/orders/${c.body.id}/status`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: 'canceled' });
    expect(cancel.status).toBe(200);

    const res = await splitOrder(cashierToken, c.body.id, {
      mode: 'equal',
      diners: [
        { label: 'A', method: 'cash' },
        { label: 'B', method: 'cash' },
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SPLIT_LOCKED');
  });

  it('DELETE /split clears the split back to a single cash row', async () => {
    const fresh = await placeDineIn(managerToken, [{ product_id: burger.id, quantity: 1 }]);
    await splitOrder(cashierToken, fresh.body.id, {
      mode: 'equal',
      diners: [
        { label: 'A', method: 'cash' },
        { label: 'B', method: 'cash' },
      ],
    });
    const res = await request(app)
      .delete(`/api/orders/${fresh.body.id}/split`)
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(res.status).toBe(200);
    expect(res.body.payment_method).toBe('cash');
    const rows = await Payment.findAll({ where: { order_id: fresh.body.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].method).toBe('cash');
    expect(Number(rows[0].amount)).toBeCloseTo(200, 5);
  });
});

describe('discount + VAT allocation', () => {
  it('allocates line discounts proportionally across diners', async () => {
    const promoOrder = await Order.findByPk(promoOrderId, {
      include: [{ association: 'items' }],
    });
    const [line] = promoOrder.items; // a single qty-2 line
    // 2×Burger with 10% off: line discount 40, line total 360.
    expect(Number(line.discount)).toBeCloseTo(40, 5);
    expect(Number(line.line_total)).toBeCloseTo(360, 5);

    const res = await splitOrder(cashierToken, promoOrderId, {
      mode: 'item',
      diners: [
        { label: 'A', method: 'cash' },
        { label: 'B', method: 'cash' },
      ],
      allocations: [
        { orderItemId: line.id, quantity: 1, dinerIndex: 0 },
        { orderItemId: line.id, quantity: 1, dinerIndex: 1 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.parts.map((p) => p.amount)).toEqual([180, 180]);

    const splitItems = await OrderSplitItem.findAll({ where: { order_id: promoOrderId } });
    expect(splitItems).toHaveLength(2);
    for (const si of splitItems) {
      expect(Number(si.discount_amount)).toBeCloseTo(20, 5); // half of the line discount
      expect(Number(si.line_amount)).toBeCloseTo(180, 5);
    }
  });

  it('computes per-diner VAT from the item vat_rate (NBR convention)', async () => {
    const twoPizza = await placeDineIn(managerToken, [{ product_id: pizza.id, quantity: 2 }]);
    const ord = await Order.findByPk(twoPizza.body.id, {
      include: [{ association: 'items' }],
    });
    const line = ord.items[0]; // 2× Pizza @300 = 600 line
    const res = await splitOrder(cashierToken, twoPizza.body.id, {
      mode: 'item',
      diners: [
        { label: 'A', method: 'cash' },
        { label: 'B', method: 'cash' },
      ],
      allocations: [
        { orderItemId: line.id, quantity: 1, dinerIndex: 0 },
        { orderItemId: line.id, quantity: 1, dinerIndex: 1 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.parts.map((p) => p.amount)).toEqual([300, 300]);

    const state = await getSplit(cashierToken, twoPizza.body.id);
    const partA = state.body.parts[0];
    expect(partA.items[0]).toMatchObject({ quantity: 1, line_amount: 300, vat_rate: 15 });

    const receipt = await request(app)
      .get(`/api/orders/${twoPizza.body.id}/split/receipts/${partA.paymentId}`)
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(receipt.status).toBe(200);
    expect(receipt.body.items[0].vat).toBeCloseTo(39.13, 2); // 300 × 15/115
    expect(receipt.body.totals.vat).toBeCloseTo(39.13, 2);
    expect(receipt.body.totals.payable).toBeCloseTo(300, 5);

    // Kitchen order ticket — items + quantities ONLY (never prices/payment).
    const kot = await request(app)
      .get(`/api/orders/${twoPizza.body.id}/split/receipts/${partA.paymentId}/kot`)
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(kot.status).toBe(200);
    expect(kot.body.kotNo).toMatch(/^KOT-/);
    expect(kot.body.dinerLabel).toBe('A');
    expect(kot.body.tableNo).toBe(3);
    expect(kot.body.items).toEqual([{ itemName: 'Pizza', quantity: 1 }]);
    expect(JSON.stringify(kot.body)).not.toContain('amount');
    expect(JSON.stringify(kot.body)).not.toContain('payable');
    expect(JSON.stringify(kot.body)).not.toContain('vat');

    const kotHtml = await request(app)
      .get(`/api/orders/${twoPizza.body.id}/split/receipts/${partA.paymentId}/kot?print=1`)
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(kotHtml.status).toBe(200);
    expect(kotHtml.text).toContain('KITCHEN');
    expect(kotHtml.text).toContain('Pizza');
    expect(kotHtml.text).not.toContain('Payable');
    expect(kotHtml.text).not.toContain('৳');
  });

  it('per-diner receipt survives product soft-delete (snapshot)', async () => {
    const target = await placeDineIn(managerToken, [
      { product_id: burger.id, quantity: 1 },
      { product_id: fries.id, quantity: 1 },
    ]);
    const ord = await Order.findByPk(target.body.id, {
      include: [{ association: 'items' }],
    });
    // Match by name — PG does not guarantee row order without ORDER BY.
    const bLine = ord.items.find((l) => l.item_name === 'Burger');
    const fLine = ord.items.find((l) => l.item_name === 'Fries');
    const res = await splitOrder(cashierToken, target.body.id, {
      mode: 'item',
      diners: [
        { label: 'Rahim', method: 'cash' },
        { label: 'Karim', method: 'cash' },
      ],
      allocations: [
        { orderItemId: bLine.id, quantity: 1, dinerIndex: 0 },
        { orderItemId: fLine.id, quantity: 1, dinerIndex: 1 },
      ],
    });
    expect(res.status).toBe(201);
    const paymentA = res.body.parts[0].paymentId;

    // Soft-delete the burger AFTER the split.
    await burger.destroy();

    const receipt = await request(app)
      .get(`/api/orders/${target.body.id}/split/receipts/${paymentA}`)
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(receipt.status).toBe(200);
    expect(receipt.body.dinerLabel).toBe('Rahim');
    expect(receipt.body.items[0].itemName).toBe('Burger'); // snapshot intact
    expect(receipt.body.totals.payable).toBeCloseTo(200, 5);

    const print = await request(app)
      .get(`/api/orders/${target.body.id}/split/receipts/${paymentA}?print=1`)
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(print.status).toBe(200);
    expect(print.headers['content-type']).toMatch(/html/);
    expect(print.text).toContain('Diner receipt');
    expect(print.text).toContain('Payable');
  });
});

describe('RBAC + tenant isolation', () => {
  it('kitchen cannot create a split (403)', async () => {
    const res = await splitOrder(kitchenToken, orderId, {
      mode: 'equal',
      diners: [
        { label: 'A', method: 'cash' },
        { label: 'B', method: 'cash' },
      ],
    });
    expect(res.status).toBe(403);
  });

  it('another tenant cannot see or split this order (404)', async () => {
    const state = await getSplit(managerBToken, orderId);
    expect(state.status).toBe(404);

    const res = await splitOrder(managerBToken, orderId, {
      mode: 'equal',
      diners: [
        { label: 'A', method: 'cash' },
        { label: 'B', method: 'cash' },
      ],
    });
    expect(res.status).toBe(404);
  });

  it('receipts from another tenant 404', async () => {
    const state = await getSplit(managerToken, orderId);
    const first = state.body.parts[0];
    const res = await request(app)
      .get(`/api/orders/${orderId}/split/receipts/${first.paymentId}`)
      .set('Authorization', `Bearer ${managerBToken}`);
    expect(res.status).toBe(404);
  });
});

describe('split-method analytics', () => {
  it('dashboard aggregates split orders by method + revenue once', async () => {
    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    const sa = res.body.splitAnalytics;
    expect(sa).toBeDefined();
    // Surviving splits: item (orderId, promo, twoPizza, target), equal
    // (fresh equal + duplicate + locked), custom (custom-ok fresh).
    expect(sa.splitOrders.item).toBeGreaterThanOrEqual(1);
    expect(sa.splitOrders.equal).toBeGreaterThanOrEqual(1);
    expect(sa.splitOrders.custom).toBeGreaterThanOrEqual(1);
    expect(sa.splitOrders.total).toBeGreaterThanOrEqual(4);
    // Revenue is counted ONCE per order via its parts (never 3×).
    const methodTotal = sa.revenue.reduce((s, r) => s + r.revenue, 0);
    const splitRevenue = sa.methodMix.reduce((s, m) => s + m.amount, 0);
    expect(methodTotal).toBeCloseTo(splitRevenue, 5);
    expect(sa.avgDiners).toBeGreaterThanOrEqual(2);
    expect(sa.avgPerDiner).toBeGreaterThan(0);
  });
});
