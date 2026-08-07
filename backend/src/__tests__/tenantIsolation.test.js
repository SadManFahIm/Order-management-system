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
  Product,
  Promotion,
} from '../models/index.js';

/**
 * Tenant-isolation security suite (Phase 3).
 * Asserts that a user in tenant A can NEVER read or write tenant B's data —
 * including direct ID injection attempts — across every business route.
 */

let tenantA;
let tenantB;
let ownerA;
let ownerB;
let tokenA;
let tokenB;
let adminToken;
let productA;
let productB;

beforeAll(async () => {
  await resetTestDb();

  tenantA = await Tenant.create({ name: 'Cafe Alpha', slug: 'cafe-alpha' });
  tenantB = await Tenant.create({ name: 'Cafe Beta', slug: 'cafe-beta' });

  ownerA = await User.create({
    name: 'Owner A',
    email: 'ownera@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  ownerB = await User.create({
    name: 'Owner B',
    email: 'ownerb@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: ownerA.id, tenant_id: tenantA.id, role: 'owner' });
  await UserTenant.create({ user_id: ownerB.id, tenant_id: tenantB.id, role: 'owner' });

  await User.create({
    name: 'Platform Admin',
    email: 'admin@platform.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'platform_admin',
  });

  const login = async (email) =>
    (await request(app).post('/api/auth/login').send({ email, password: 'password123' })).body
      .accessToken;
  tokenA = await login('ownera@example.com');
  tokenB = await login('ownerb@example.com');
  adminToken = await login('admin@platform.com');

  productA = await Product.create({
    tenant_id: tenantA.id,
    name: 'Alpha Burger',
    price: 200,
    weight_gm: 500,
    enabled: true,
  });
  productB = await Product.create({
    tenant_id: tenantB.id,
    name: 'Beta Pizza',
    price: 600,
    weight_gm: 800,
    enabled: true,
  });
  await Promotion.create({
    tenant_id: tenantA.id,
    title: 'Alpha Deal',
    type: 'percentage',
    percentage_value: 10,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    enabled: true,
  });
  await Promotion.create({
    tenant_id: tenantB.id,
    title: 'Beta Deal',
    type: 'fixed',
    fixed_value: 50,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    enabled: true,
  });
});

afterAll(async () => {
  await sequelize.close();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('read isolation', () => {
  it('user A sees only tenant A products', async () => {
    const res = await request(app).get('/api/products').set(auth(tokenA));
    expect(res.status).toBe(200);
    const ids = res.body.map((p) => p.id);
    expect(ids).toContain(productA.id);
    expect(ids).not.toContain(productB.id);
  });

  it('user A sees only tenant A promotions', async () => {
    const res = await request(app).get('/api/promotions').set(auth(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.some((p) => p.title === 'Beta Deal')).toBe(false);
    expect(res.body.some((p) => p.title === 'Alpha Deal')).toBe(true);
  });

  it('rejects X-Tenant spoofing to a workspace the user does not belong to', async () => {
    const res = await request(app)
      .get('/api/products')
      .set({ ...auth(tokenA), 'X-Tenant': String(tenantB.id) });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('cannot read another tenants workspace detail', async () => {
    const res = await request(app)
      .get(`/api/tenants/${tenantB.id}`)
      .set(auth(tokenA));
    expect(res.status).toBe(403);
  });

  it('platform admin can read any workspace', async () => {
    const res = await request(app)
      .get(`/api/tenants/${tenantB.id}`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('cafe-beta');
  });
});

describe('write isolation (ID injection)', () => {
  it('user A cannot update tenant B product (404, not 200)', async () => {
    const res = await request(app)
      .put(`/api/products/${productB.id}`)
      .set(auth(tokenA))
      .send({ name: 'Hijacked', price: 1, weight_gm: 1, enabled: true });
    expect(res.status).toBe(404);
  });

  it('user A cannot create an order referencing tenant B product', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set(auth(tokenA))
      .send({
        customer_name: 'Rahim',
        items: [{ product_id: productB.id, quantity: 1 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PRODUCT_UNAVAILABLE');
  });

  it('user A cannot delete/invite members into tenant B', async () => {
    const res = await request(app)
      .post(`/api/tenants/${tenantB.id}/members`)
      .set(auth(tokenA))
      .send({ email: 'sneaky@example.com', role: 'manager', password: 'password123' });
    expect(res.status).toBe(403);
  });

  it('member B cannot manage tenant A', async () => {
    const res = await request(app)
      .patch(`/api/tenants/${tenantA.id}`)
      .set(auth(tokenB))
      .send({ name: 'Renamed by B' });
    expect(res.status).toBe(403);
  });
});

describe('role switching across workspaces', () => {
  it('applies the selected workspaces membership role, not the login-time role', async () => {
    // Bob is a cashier in tenant A but an owner in tenant B. The access token
    // baked in his FIRST membership (cashier). After switching to B via
    // X-Tenant, he must be treated as owner (can manage the menu).
    const bob = await User.create({
      name: 'Bob',
      email: 'bob@example.com',
      password: await bcrypt.hash('password123', 10),
      platform_role: 'member',
    });
    await UserTenant.create({ user_id: bob.id, tenant_id: tenantA.id, role: 'cashier' });
    await UserTenant.create({ user_id: bob.id, tenant_id: tenantB.id, role: 'owner' });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bob@example.com', password: 'password123' });
    const token = login.body.accessToken;

    // In tenant B (owner) he may create a product…
    const create = await request(app)
      .post('/api/products')
      .set({ ...auth(token), 'X-Tenant': String(tenantB.id) })
      .send({ name: 'Bobs Special', price: 99, weight_gm: 200, enabled: true });
    expect(create.status).toBe(201);

    // …but in tenant A (cashier) the same mutation is blocked.
    const blocked = await request(app)
      .post('/api/products')
      .set({ ...auth(token), 'X-Tenant': String(tenantA.id) })
      .send({ name: 'Bobs Sneak', price: 1, weight_gm: 1 });
    expect(blocked.status).toBe(403);
  });
});

describe('suspended / archived tenants', () => {
  it('member access to a suspended workspace is blocked', async () => {
    await Tenant.update({ status: 'suspended' }, { where: { id: tenantB.id } });
    const res = await request(app)
      .get('/api/products')
      .set({ ...auth(tokenB), 'X-Tenant': String(tenantB.id) });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TENANT_UNAVAILABLE');
  });

  it('platform admin can still operate on a suspended workspace', async () => {
    const res = await request(app)
      .get(`/api/tenants/${tenantB.id}`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
  });

  it('re-activating restores member access', async () => {
    await Tenant.update({ status: 'active' }, { where: { id: tenantB.id } });
    const res = await request(app)
      .get('/api/products')
      .set({ ...auth(tokenB), 'X-Tenant': String(tenantB.id) });
    expect(res.status).toBe(200);
    expect(res.body.map((p) => p.id)).toContain(productB.id);
  });
});
