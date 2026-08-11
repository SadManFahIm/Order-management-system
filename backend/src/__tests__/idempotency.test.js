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
import Order from '../models/Order.js';

/**
 * Idempotent order creation (Phase 5) — the DB-level unique key makes
 * duplicate orders impossible, including concurrent same-key requests.
 */

let token;
let productId;
let tenantId;

const place = (key, body) =>
  request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .set(...(key ? ['Idempotency-Key', key] : ['x-noop', '1']))
    .send(body ?? { customer_name: 'Rahim', items: [{ product_id: productId, quantity: 1 }] });

beforeAll(async () => {
  await resetTestDb();
  const tenant = await Tenant.create({ name: 'Idempotent Diner', slug: 'idempotent-diner' });
  tenantId = tenant.id;
  const cashier = await User.create({
    name: 'Cashier',
    email: 'cashier@idem.test',
    password: await bcrypt.hash('supersecret1', 10),
  });
  await UserTenant.create({ user_id: cashier.id, tenant_id: tenant.id, role: 'cashier' });
  token = (
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'cashier@idem.test', password: 'supersecret1' })
  ).body.accessToken;
  productId = (
    await Product.create({ tenant_id: tenant.id, name: 'Burger', price: 200, weight_gm: 300, enabled: true })
  ).id;
});

afterAll(async () => {
  await sequelize.close();
});

describe('Idempotency-Key on order creation', () => {
  it('replays the same order for the same key', async () => {
    const before = await Order.count();
    const first = await place('same-key-1');
    const second = await place('same-key-1');
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.order_no).toBe(first.body.order_no);
    expect(await Order.count()).toBe(before + 1);
  });

  it('creates separate orders for different keys', async () => {
    const before = await Order.count();
    await place('key-1');
    await place('key-2');
    expect(await Order.count()).toBe(before + 2);
  });

  it('concurrent same-key requests create exactly one order', async () => {
    const before = await Order.count();
    const key = 'concurrent-key';
    const results = await Promise.all([place(key), place(key), place(key)]);
    const ids = new Set(results.map((r) => r.body?.id));
    expect(ids.size).toBe(1);
    expect(ids.has(undefined)).toBe(false);
    expect(await Order.count()).toBe(before + 1);
  });

  it('a failed request with a key can be retried with the same key', async () => {
    const before = await Order.count();
    const bad = await place('retry-key', { customer_name: 'Rahim', items: [{ product_id: 99999, quantity: 1 }] });
    expect(bad.status).toBe(400);
    const good = await place('retry-key');
    expect(good.status).toBe(201);
    expect(await Order.count()).toBe(before + 1);
  });

  it('rejects reusing a key with a different request body', async () => {
    const first = await place('mismatch-key', { customer_name: 'Rahim', items: [{ product_id: productId, quantity: 1 }] });
    expect(first.status).toBe(201);
    const second = await place('mismatch-key', { customer_name: 'Other', items: [{ product_id: productId, quantity: 2 }] });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('IDEMPOTENCY_KEY_MISMATCH');
  });

  it('orders without a key are unaffected (backward compatible)', async () => {
    const before = await Order.count();
    const res = await place();
    expect(res.status).toBe(201);
    expect(await Order.count()).toBe(before + 1);
  });

  it('keys are scoped per tenant (same key, different tenant = separate)', async () => {
    const other = await Tenant.create({ name: 'Other Idem', slug: 'other-idem' });
    const otherCashier = await User.create({
      name: 'Other Cashier',
      email: 'other@idem.test',
      password: await bcrypt.hash('supersecret1', 10),
    });
    await UserTenant.create({ user_id: otherCashier.id, tenant_id: other.id, role: 'cashier' });
    const otherToken = (
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'other@idem.test', password: 'supersecret1' })
    ).body.accessToken;
    const otherProduct = await Product.create({
      tenant_id: other.id,
      name: 'Other Burger',
      price: 150,
      weight_gm: 200,
      enabled: true,
    });

    const a = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${otherToken}`)
      .set('Idempotency-Key', 'same-key-1') // same literal key as the first test
      .send({ customer_name: 'Other', items: [{ product_id: otherProduct.id, quantity: 1 }] });
    expect(a.status).toBe(201);
    // The first tenant's order with this key has a different id — not replayed.
    const orders = await Order.findAll({ where: { tenant_id: tenantId } });
    expect(orders.some((o) => o.id === a.body.id)).toBe(false);
  });
});
