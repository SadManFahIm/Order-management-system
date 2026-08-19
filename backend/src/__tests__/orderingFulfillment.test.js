import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import {
  User,
  Tenant,
  UserTenant,
  Plan,
  Order,
  OrderItem,
  Product,
  ItemVariant,
  OrderEditRequest,
  DeliveryZone,
} from '../models/index.js';
import { autoAssign, autoAssignTenant, deliveryMembers } from '../services/assignmentService.js';
import { createEditRequest, approveEditRequest, rejectEditRequest } from '../services/editRequestService.js';

/**
 * Phase 5 follow-up — ordering & fulfillment: order editing with an approval
 * flow, delivery auto-assignment (zone + rider load), KDS (bump bar / prep
 * timer / overdue), and cancellation reasons.
 */

const PASSWORD = 'Str0ngPass!42';

let tenant;
let ownerToken;
let kitchenToken;
let managerToken;
let productId;
let productBId;

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

async function login(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return res.body?.accessToken;
}

async function makeUser(name, email, role, extra = {}) {
  const u = await User.create({
    name,
    email,
    password: await bcrypt.hash(PASSWORD, 4),
  });
  await UserTenant.create({ user_id: u.id, tenant_id: tenant.id, role, ...extra });
  return u;
}

async function placeOrder(over = {}) {
  const res = await request(app)
    .post('/api/orders')
    .set(auth(ownerToken))
    .send({
      customer_name: 'Rahim',
      customer_phone: '01712345678',
      payment_method: 'cash',
      items: [{ product_id: productId, quantity: 1 }],
      ...over,
    });
  return res;
}

beforeAll(async () => {
  await resetTestDb();

  const [free] = await Plan.findOrCreate({
    where: { code: 'free' },
    defaults: { name: 'Free', price_mo: 0, max_products: 100, max_orders_per_day: 200, max_members: 50, storage_mb: 500 },
  });
  await free.update({ max_products: 100, max_orders_per_day: 200, max_members: 50, storage_mb: 500 });

  tenant = await Tenant.create({
    name: 'Fulfill Diner',
    slug: 'fulfill-diner',
    plan_id: free.id,
    settings: { delivery: { enabled: true, fee: 60 } },
  });

  await makeUser('Owner', 'fulfill.owner@example.com', 'owner');
  await makeUser('Manager', 'fulfill.manager@example.com', 'manager');
  await makeUser('Kitchen', 'fulfill.kitchen@example.com', 'kitchen');
  ownerToken = await login('fulfill.owner@example.com');
  managerToken = await login('fulfill.manager@example.com');
  kitchenToken = await login('fulfill.kitchen@example.com');

  const a = await Product.create({
    tenant_id: tenant.id,
    name: 'Zinger Burger',
    price: 250,
    weight_gm: 300,
    enabled: true,
  });
  productId = a.id;
  const b = await Product.create({
    tenant_id: tenant.id,
    name: 'Fries',
    price: 100,
    weight_gm: 150,
    enabled: true,
  });
  productBId = b.id;
});

afterAll(async () => {
  await sequelize.close();
});

describe('migration 025 — new schema', () => {
  it('adds cancel/delivery/KDS columns to orders', async () => {
    const cols = await sequelize.getQueryInterface().describeTable('orders');
    for (const c of ['cancel_reason', 'canceled_by', 'delivery_zone', 'prep_started_at', 'bumped_at']) {
      expect(cols, c).toHaveProperty(c);
    }
  });

  it('creates order_edit_requests and delivery_zones tables', async () => {
    const qi = sequelize.getQueryInterface();
    expect(await qi.tableExists('order_edit_requests')).toBe(true);
    expect(await qi.tableExists('delivery_zones')).toBe(true);
  });
});

describe('cancellation reasons', () => {
  it('requires a reason and records it (manager cancel)', async () => {
    const placed = await placeOrder();
    expect(placed.status).toBe(201);

    const noReason = await request(app)
      .patch(`/api/orders/${placed.body.id}/status`)
      .set(auth(managerToken))
      .send({ status: 'canceled' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.code).toBe('VALIDATION_ERROR');

    const ok = await request(app)
      .patch(`/api/orders/${placed.body.id}/status`)
      .set(auth(managerToken))
      .send({ status: 'canceled', reason: 'customer_canceled: changed mind' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('canceled');
    expect(ok.body.cancel_reason).toContain('customer_canceled');

    const order = await Order.findByPk(placed.body.id);
    expect(order.cancel_reason).toContain('customer_canceled');
    expect(order.canceled_by).toBeTruthy();
  });
});

describe('KDS — prep timer + bump bar', () => {
  it('stamps prep_started_at when moving to preparing', async () => {
    const placed = await placeOrder();
    await request(app)
      .patch(`/api/orders/${placed.body.id}/status`)
      .set(auth(kitchenToken))
      .send({ status: 'accepted' });
    const preparing = await request(app)
      .patch(`/api/orders/${placed.body.id}/status`)
      .set(auth(kitchenToken))
      .send({ status: 'preparing' });
    expect(preparing.status).toBe(200);
    const order = await Order.findByPk(placed.body.id);
    expect(order.prep_started_at).toBeTruthy();
  });

  it('bump moves preparing → ready and is idempotent', async () => {
    const placed = await placeOrder();
    await request(app)
      .patch(`/api/orders/${placed.body.id}/status`)
      .set(auth(kitchenToken))
      .send({ status: 'accepted' });
    await request(app)
      .patch(`/api/orders/${placed.body.id}/status`)
      .set(auth(kitchenToken))
      .send({ status: 'preparing' });

    const bumped = await request(app)
      .post(`/api/orders/${placed.body.id}/bump`)
      .set(auth(kitchenToken));
    expect(bumped.status).toBe(200);
    expect(bumped.body.status).toBe('ready');
    expect(bumped.body.bumped_at).toBeTruthy();

    const again = await request(app)
      .post(`/api/orders/${placed.body.id}/bump`)
      .set(auth(kitchenToken));
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('ready');
  });
});

describe('order editing — approval flow', () => {
  it('creates a pending request, rejects it untouched, and approves with re-pricing', async () => {
    const placed = await placeOrder({ items: [{ product_id: productId, quantity: 1 }] });
    const orderId = placed.body.id;
    expect(placed.body.grand_total).toBe(250);

    // Request: swap to 2 × Fries (200).
    const req = await request(app)
      .post(`/api/orders/${orderId}/edit-request`)
      .set(auth(ownerToken))
      .send({ items: [{ product_id: productBId, quantity: 2 }], reason: 'change side' });
    expect(req.status).toBe(201);
    expect(req.body.status).toBe('pending');
    const reqId = req.body.id;

    // A second pending request is rejected (one at a time).
    const dup = await request(app)
      .post(`/api/orders/${orderId}/edit-request`)
      .set(auth(ownerToken))
      .send({ items: [{ product_id: productBId, quantity: 1 }] });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EDIT_REQUEST_PENDING');

    // Reject leaves the order byte-for-byte unchanged.
    const rejected = await request(app)
      .post(`/api/orders/${orderId}/edit-request/${reqId}/reject`)
      .set(auth(managerToken))
      .send({ note: 'out of fries' });
    expect(rejected.status).toBe(200);
    let order = await Order.findByPk(orderId);
    expect(order.grand_total).toBe(250);
    expect(order.total_discount).toBe(0);

    // New request, then approve → items + totals recomputed.
    const req2 = await request(app)
      .post(`/api/orders/${orderId}/edit-request`)
      .set(auth(ownerToken))
      .send({ items: [{ product_id: productBId, quantity: 2 }] });
    const approved = await request(app)
      .post(`/api/orders/${orderId}/edit-request/${req2.body.id}/approve`)
      .set(auth(managerToken));
    expect(approved.status).toBe(200);
    expect(approved.body.grand_total).toBe(200);

    order = await Order.findByPk(orderId);
    expect(order.grand_total).toBe(200);
    const items = await OrderItem.findAll({ where: { order_id: orderId } });
    expect(items).toHaveLength(1);
    expect(Number(items[0].product_id)).toBe(productBId);
    expect(Number(items[0].quantity)).toBe(2);

    const edit = await OrderEditRequest.findByPk(req2.body.id);
    expect(edit.status).toBe('approved');
  });
});

describe('delivery auto-assignment', () => {
  it('assigns the least-loaded in-zone rider', async () => {
    const r1 = await makeUser('Rider One', 'rider.one@example.com', 'delivery', {
      delivery_zones: ['Dhanmondi'],
    });
    const r2 = await makeUser('Rider Two', 'rider.two@example.com', 'delivery', {
      delivery_zones: ['Dhanmondi'],
    });
    // r2 already has an active order → r1 (less loaded) should win.
    const existing = await Order.create({
      tenant_id: tenant.id,
      order_no: 'ORD-LOAD',
      customer_name: 'X',
      type: 'delivery',
      status: 'out_for_delivery',
      assigned_to: r2.id,
      subtotal: 0,
      total_discount: 0,
      grand_total: 0,
    });
    await existing.save();

    const deliveryOrder = await Order.create({
      tenant_id: tenant.id,
      order_no: 'ORD-ZONE',
      customer_name: 'Y',
      type: 'delivery',
      delivery_zone: 'Dhanmondi',
      status: 'ready',
      subtotal: 0,
      total_discount: 0,
      grand_total: 0,
    });
    const picked = await autoAssign(tenant.id, deliveryOrder);
    expect(picked).toBe(r1.id);

    // Already-assigned orders are never overwritten.
    const assigned = await Order.create({
      tenant_id: tenant.id,
      order_no: 'ORD-KEEP',
      customer_name: 'Z',
      type: 'delivery',
      assigned_to: r2.id,
      status: 'ready',
      subtotal: 0,
      total_discount: 0,
      grand_total: 0,
    });
    expect(await autoAssign(tenant.id, assigned)).toBe(r2.id);
  });

  it('is a no-op without eligible riders (no rider, no assignment)', async () => {
    const order = await Order.create({
      tenant_id: tenant.id,
      order_no: 'ORD-NORIDER',
      customer_name: 'Q',
      type: 'delivery',
      delivery_zone: 'Gulshan', // no rider covers Gulshan
      status: 'ready',
      subtotal: 0,
      total_discount: 0,
      grand_total: 0,
    });
    expect(await autoAssign(tenant.id, order)).toBeNull();
    expect(order.assigned_to ?? null).toBeNull();
  });
});

describe('delivery zone CRUD + rider coverage', () => {
  it('creates/lists a zone and sets rider coverage', async () => {
    const created = await request(app)
      .post('/api/orders/delivery-zones')
      .set(auth(managerToken))
      .send({ name: 'Mirpur' });
    expect(created.status).toBe(201);

    const list = await request(app).get('/api/orders/delivery-zones').set(auth(managerToken));
    expect(list.status).toBe(200);
    expect(list.body.some((z) => z.name === 'Mirpur')).toBe(true);
  });

  it('renames/toggles and deletes a zone', async () => {
    const created = await request(app)
      .post('/api/orders/delivery-zones')
      .set(auth(managerToken))
      .send({ name: 'Uttara' });
    const id = created.body.id;
    expect(created.status).toBe(201);

    const toggled = await request(app)
      .patch(`/api/orders/delivery-zones/${id}`)
      .set(auth(managerToken))
      .send({ is_active: false });
    expect(toggled.status).toBe(200);
    expect(toggled.body.is_active).toBe(false);

    const renamed = await request(app)
      .patch(`/api/orders/delivery-zones/${id}`)
      .set(auth(managerToken))
      .send({ name: 'Uttara North' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Uttara North');

    const del = await request(app)
      .delete(`/api/orders/delivery-zones/${id}`)
      .set(auth(managerToken));
    expect(del.status).toBe(200);
    const list = await request(app).get('/api/orders/delivery-zones').set(auth(managerToken));
    expect(list.body.some((z) => z.id === id)).toBe(false);
  });

  it('lists delivery members and updates their zone coverage', async () => {
    const members = await request(app).get('/api/orders/delivery-members').set(auth(managerToken));
    expect(members.status).toBe(200);
    const rider = members.body.find((m) => m.email === 'rider.one@example.com');
    expect(rider).toBeTruthy();

    const set = await request(app)
      .patch(`/api/orders/delivery-members/${rider.id}/zones`)
      .set(auth(managerToken))
      .send({ delivery_zones: ['Gulshan', 'Banani'] });
    expect(set.status).toBe(200);
    expect(set.body.delivery_zones).toEqual(['Gulshan', 'Banani']);

    const after = await request(app).get('/api/orders/delivery-members').set(auth(managerToken));
    expect(after.body.find((m) => m.id === rider.id).delivery_zones).toEqual(['Gulshan', 'Banani']);
  });

  it('sweeps the tenant queue via the auto-assign endpoint', async () => {
    await request(app).post('/api/orders/auto-assign').set(auth(managerToken)).expect(200);
  });
});

describe('assignment service edge coverage', () => {
  it('autoAssignTenant assigns every eligible unassigned delivery order', async () => {
    const rider = await makeUser('Rider Sweep', 'rider.sweep@example.com', 'delivery', {
      delivery_zones: ['SweepZone'],
    });
    const unassigned = await Order.create({
      tenant_id: tenant.id,
      order_no: 'ORD-SWEEP',
      customer_name: 'Q',
      type: 'delivery',
      delivery_zone: 'SweepZone',
      status: 'ready',
      subtotal: 0,
      total_discount: 0,
      grand_total: 0,
    });
    const count = await autoAssignTenant(tenant.id);
    expect(count).toBeGreaterThanOrEqual(1);
    await unassigned.reload();
    expect(unassigned.assigned_to).toBe(rider.id);
  });

  it('deliveryMembers returns the delivery-role members with user info', async () => {
    const members = await deliveryMembers(tenant.id);
    expect(members.length).toBeGreaterThanOrEqual(1);
    expect(members[0].User).toBeTruthy();
  });

  it('coversZone treats empty coverage as covering all zones', async () => {
    const noZones = await makeUser('Rider Anywhere', 'rider.anywhere@example.com', 'delivery');
    const order = await Order.create({
      tenant_id: tenant.id,
      order_no: 'ORD-ANY',
      customer_name: 'A',
      type: 'delivery',
      delivery_zone: 'Dhanmondi',
      status: 'ready',
      subtotal: 0,
      total_discount: 0,
      grand_total: 0,
    });
    expect(await autoAssign(tenant.id, order)).toBe(noZones.id);
  });

  it('autoAssign is a no-op for terminal / non-delivery orders', async () => {
    const delivered = await Order.create({
      tenant_id: tenant.id,
      order_no: 'ORD-TERM',
      customer_name: 'T',
      type: 'delivery',
      status: 'delivered',
      subtotal: 0,
      total_discount: 0,
      grand_total: 0,
    });
    expect(await autoAssign(tenant.id, delivered)).toBeNull();
    const pickup = await Order.create({
      tenant_id: tenant.id,
      order_no: 'ORD-PICK',
      customer_name: 'P',
      type: 'pickup',
      status: 'ready',
      subtotal: 0,
      total_discount: 0,
      grand_total: 0,
    });
    expect(await autoAssign(tenant.id, pickup)).toBeNull();
  });
});

describe('order editing — approval flow edge cases', () => {
  it('rejects edit requests on non-editable orders', async () => {
    const order = await Order.create({
      tenant_id: tenant.id,
      order_no: 'ORD-FINAL',
      customer_name: 'F',
      type: 'pickup',
      status: 'delivered',
      subtotal: 0,
      total_discount: 0,
      grand_total: 0,
    });
    const res = await request(app)
      .post(`/api/orders/${order.id}/edit-request`)
      .set(auth(ownerToken))
      .send({ items: [{ product_id: productBId, quantity: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('rejects edit requests referencing unavailable products', async () => {
    const placed = await placeOrder();
    const res = await request(app)
      .post(`/api/orders/${placed.body.id}/edit-request`)
      .set(auth(ownerToken))
      .send({ items: [{ product_id: 99999, quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PRODUCT_UNAVAILABLE');
  });

  it('stores the reject decision note', async () => {
    const placed = await placeOrder();
    const req = await request(app)
      .post(`/api/orders/${placed.body.id}/edit-request`)
      .set(auth(ownerToken))
      .send({ items: [{ product_id: productBId, quantity: 1 }] });
    const rejected = await request(app)
      .post(`/api/orders/${placed.body.id}/edit-request/${req.body.id}/reject`)
      .set(auth(managerToken))
      .send({ note: 'ran out of fries tonight' });
    expect(rejected.status).toBe(200);
    const edit = await OrderEditRequest.findByPk(req.body.id);
    expect(edit.decision_note).toBe('ran out of fries tonight');
    expect(edit.decided_by).toBeTruthy();
  });

  it('approve/reject a second time is a 409 (already decided)', async () => {
    const placed = await placeOrder();
    const req = await request(app)
      .post(`/api/orders/${placed.body.id}/edit-request`)
      .set(auth(ownerToken))
      .send({ items: [{ product_id: productBId, quantity: 1 }] });
    await request(app)
      .post(`/api/orders/${placed.body.id}/edit-request/${req.body.id}/approve`)
      .set(auth(managerToken));
    const again = await request(app)
      .post(`/api/orders/${placed.body.id}/edit-request/${req.body.id}/approve`)
      .set(auth(managerToken));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('EDIT_ALREADY_DECIDED');
  });

  it('lists edit requests for an order (newest first)', async () => {
    const placed = await placeOrder();
    await request(app)
      .post(`/api/orders/${placed.body.id}/edit-request`)
      .set(auth(ownerToken))
      .send({ items: [{ product_id: productBId, quantity: 1 }] });
    const list = await request(app)
      .get(`/api/orders/${placed.body.id}/edit-requests`)
      .set(auth(ownerToken));
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThanOrEqual(1);
  });

  it('approving a delivery order adds the delivery fee to the new total', async () => {
    const rider = await makeUser('Rider Fee', 'rider.fee@example.com', 'delivery', {
      delivery_zones: ['FeeZone'],
    });
    const placed = await placeOrder({
      order_type: 'delivery',
      customer_address: 'Dhanmondi Rd 7',
      delivery_zone: 'FeeZone',
      items: [{ product_id: productId, quantity: 1 }],
    });
    expect(placed.status).toBe(201);
    const req = await request(app)
      .post(`/api/orders/${placed.body.id}/edit-request`)
      .set(auth(ownerToken))
      .send({ items: [{ product_id: productBId, quantity: 2 }] });
    const approved = await request(app)
      .post(`/api/orders/${placed.body.id}/edit-request/${req.body.id}/approve`)
      .set(auth(managerToken));
    expect(approved.status).toBe(200);
    // 2 × Fries (200) + delivery fee (60).
    expect(approved.body.grand_total).toBe(200 + 60);
  });

  it('bump rejects terminal orders (delivered)', async () => {
    const delivered = await Order.create({
      tenant_id: tenant.id,
      order_no: 'ORD-BUMPTERM',
      customer_name: 'X',
      type: 'pickup',
      status: 'delivered',
      subtotal: 0,
      total_discount: 0,
      grand_total: 0,
    });
    const res = await request(app)
      .post(`/api/orders/${delivered.id}/bump`)
      .set(auth(kitchenToken));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });
});