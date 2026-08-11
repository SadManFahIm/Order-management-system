import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import UserTenant from '../models/UserTenant.js';
import Product from '../models/Product.js';

/**
 * Delivery-type orders (Phase 5) — assignment, reassignment, the delivery
 * person's queue, authorization guards, and the out_for_delivery lifecycle.
 * Pickup behavior is untouched (covered by orders.test.js).
 */

let cashierToken;
let kitchenToken;
let deliveryToken;
let managerToken;
let riderId;
let rider2Id;
let productId;

const login = async (email) =>
  (
    await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'supersecret1' })
  ).body.accessToken;

const placeDelivery = (over = {}) =>
  request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${cashierToken}`)
    .send({
      customer_name: 'Delivery Guest',
      customer_phone: '01712345678',
      customer_address: 'Dhanmondi 27, Dhaka',
      order_type: 'delivery',
      items: [{ product_id: productId, quantity: 1 }],
      ...over,
    });

beforeAll(async () => {
  await resetTestDb();

  const tenant = await Tenant.create({
    name: 'Delivery Diner',
    slug: 'delivery-diner',
    settings: { delivery: { enabled: true, fee: 50 } },
  });
  const mkUser = async (name, email, role) => {
    const user = await User.create({
      name,
      email,
      password: await bcrypt.hash('supersecret1', 10),
    });
    await UserTenant.create({ user_id: user.id, tenant_id: tenant.id, role });
    return user;
  };

  await mkUser('Cashier', 'cashier@delivery.test', 'cashier');
  await mkUser('Kitchen', 'kitchen@delivery.test', 'kitchen');
  const rider1 = await mkUser('Rider 1', 'rider1@delivery.test', 'delivery');
  const rider2 = await mkUser('Rider 2', 'rider2@delivery.test', 'delivery');
  await mkUser('Manager', 'manager@delivery.test', 'manager');
  riderId = rider1.id;
  rider2Id = rider2.id;

  cashierToken = await login('cashier@delivery.test');
  kitchenToken = await login('kitchen@delivery.test');
  deliveryToken = await login('rider1@delivery.test');
  managerToken = await login('manager@delivery.test');

  const product = await Product.create({
    tenant_id: tenant.id,
    name: 'Delivery Burger',
    price: 300,
    weight_gm: 250,
    enabled: true,
  });
  productId = product.id;
});

afterAll(async () => {
  await sequelize.close();
});

describe('PATCH /api/orders/:id/assign (delivery assignment)', () => {
  it('manager assigns a delivery order to a rider', async () => {
    const placed = await placeDelivery();
    expect(placed.status).toBe(201);

    const res = await request(app)
      .patch(`/api/orders/${placed.body.id}/assign`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ delivery_user_id: riderId });
    expect(res.status).toBe(200);
    expect(res.body.assigned_to).toBe(riderId);
  });

  it('manager reassigns to another rider', async () => {
    const placed = await placeDelivery();
    await request(app)
      .patch(`/api/orders/${placed.body.id}/assign`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ delivery_user_id: riderId });

    const res = await request(app)
      .patch(`/api/orders/${placed.body.id}/assign`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ delivery_user_id: rider2Id });
    expect(res.status).toBe(200);
    expect(res.body.assigned_to).toBe(rider2Id);
  });

  it('manager unassigns with null', async () => {
    const placed = await placeDelivery();
    await request(app)
      .patch(`/api/orders/${placed.body.id}/assign`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ delivery_user_id: riderId });

    const res = await request(app)
      .patch(`/api/orders/${placed.body.id}/assign`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ delivery_user_id: null });
    expect(res.status).toBe(200);
    expect(res.body.assigned_to).toBeNull();
  });

  it('rejects assigning a pickup order', async () => {
    const placed = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ customer_name: 'Pickup Guest', items: [{ product_id: productId, quantity: 1 }] });
    const res = await request(app)
      .patch(`/api/orders/${placed.body.id}/assign`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ delivery_user_id: riderId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_DELIVERY_ORDER');
  });

  it('rejects a target who is not a delivery member of this workspace', async () => {
    const placed = await placeDelivery();
    const kitchen = await User.findOne({ where: { email: 'kitchen@delivery.test' } });
    const res = await request(app)
      .patch(`/api/orders/${placed.body.id}/assign`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ delivery_user_id: kitchen.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DELIVERY_USER');
  });

  it('forbids non-managers from assigning', async () => {
    const placed = await placeDelivery();
    for (const token of [cashierToken, kitchenToken, deliveryToken]) {
      const res = await request(app)
        .patch(`/api/orders/${placed.body.id}/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({ delivery_user_id: riderId });
      expect(res.status).toBe(403);
    }
  });

  it('forbids reassigning a delivered order', async () => {
    const placed = await placeDelivery();
    const id = placed.body.id;
    await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'preparing' });
    await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'ready' });
    await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${deliveryToken}`)
      .send({ status: 'out_for_delivery' });
    await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${deliveryToken}`)
      .send({ status: 'delivered' });

    const res = await request(app)
      .patch(`/api/orders/${id}/assign`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ delivery_user_id: rider2Id });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/orders?assigned_to=me (delivery queue)', () => {
  it('shows only the rider’s own assigned orders', async () => {
    const mine = await placeDelivery();
    const other = await placeDelivery();
    await request(app)
      .patch(`/api/orders/${mine.body.id}/assign`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ delivery_user_id: riderId });
    await request(app)
      .patch(`/api/orders/${other.body.id}/assign`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ delivery_user_id: rider2Id });

    const res = await request(app)
      .get('/api/orders?assigned_to=me')
      .set('Authorization', `Bearer ${deliveryToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((o) => o.assigned_to === riderId)).toBe(true);
    expect(res.body.some((o) => o.id === other.body.id)).toBe(false);
  });

  it('forbids a rider filtering by another user’s assignments', async () => {
    const res = await request(app)
      .get(`/api/orders?assigned_to=${rider2Id}`)
      .set('Authorization', `Bearer ${deliveryToken}`);
    expect(res.status).toBe(403);
  });

  it('forbids cashiers from using assigned_to=me', async () => {
    const res = await request(app)
      .get('/api/orders?assigned_to=me')
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(res.status).toBe(403);
  });
});

describe('Delivery lifecycle (out_for_delivery)', () => {
  it('delivery order: placed → preparing → ready → out_for_delivery → delivered', async () => {
    const placed = await placeDelivery();
    const id = placed.body.id;

    await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'preparing' });
    await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'ready' });

    const dispatch = await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${deliveryToken}`)
      .send({ status: 'out_for_delivery' });
    expect(dispatch.status).toBe(200);
    expect(dispatch.body.status).toBe('out_for_delivery');

    const done = await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${deliveryToken}`)
      .send({ status: 'delivered' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('delivered');
  });

  it('pickup orders cannot be marked out_for_delivery', async () => {
    const placed = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ customer_name: 'Pickup Guest', items: [{ product_id: productId, quantity: 1 }] });
    const id = placed.body.id;
    await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'preparing' });
    await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'ready' });

    const res = await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${deliveryToken}`)
      .send({ status: 'out_for_delivery' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('cashier cannot dispatch or deliver', async () => {
    const placed = await placeDelivery();
    const id = placed.body.id;
    await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'preparing' });
    await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'ready' });

    const res = await request(app)
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ status: 'out_for_delivery' });
    expect(res.status).toBe(403);
  });
});

describe('Kitchen accept / reject (Phase 5)', () => {
  it('kitchen can accept a placed order, then prepare it', async () => {
    const placed = await placeDelivery();
    const accept = await request(app)
      .patch(`/api/orders/${placed.body.id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'accepted' });
    expect(accept.status).toBe(200);
    expect(accept.body.status).toBe('accepted');

    const prep = await request(app)
      .patch(`/api/orders/${placed.body.id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'preparing' });
    expect(prep.status).toBe(200);
  });

  it('kitchen can reject a placed order with a reason', async () => {
    const placed = await placeDelivery();
    const res = await request(app)
      .patch(`/api/orders/${placed.body.id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'rejected', reason: 'Out of chicken' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
    expect(res.body.rejected_reason).toBe('Out of chicken');

    // Rejected is terminal — cannot continue to preparing.
    const after = await request(app)
      .patch(`/api/orders/${placed.body.id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'preparing' });
    expect(after.status).toBe(400);
  });

  it('reject without a reason is a 400', async () => {
    const placed = await placeDelivery();
    const res = await request(app)
      .patch(`/api/orders/${placed.body.id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'rejected' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('cashier cannot accept or reject', async () => {
    const placed = await placeDelivery();
    for (const status of ['accepted', 'rejected']) {
      const res = await request(app)
        .patch(`/api/orders/${placed.body.id}/status`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ status, reason: 'x' });
      expect(res.status).toBe(403);
    }
  });

  it('a preparing order cannot be rejected (only placed/accepted)', async () => {
    const placed = await placeDelivery();
    await request(app)
      .patch(`/api/orders/${placed.body.id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'preparing' });
    const res = await request(app)
      .patch(`/api/orders/${placed.body.id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'rejected', reason: 'Too late' });
    expect(res.status).toBe(409);
  });
});
