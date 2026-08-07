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
  InventoryItem,
  MenuCategory,
  ItemVariant,
} from '../models/index.js';

/**
 * Phase 4 completion — soft delete, optimistic locking, inventory.
 * - DELETE /api/products/:id soft-deletes (row keeps deleted_at, lists and
 *   the public storefront no longer see it; order history unaffected).
 * - PUT /api/products/:id enforces the optimistic lock (409 on stale version).
 * - Inventory rides on product create/update + PATCH /:id/inventory.
 */

let tenantA;
let tenantB;
let ownerToken;
let cashierToken;

beforeAll(async () => {
  await resetTestDb();

  tenantA = await Tenant.create({ name: 'Conc Cafe A', slug: 'conc-a' });
  tenantB = await Tenant.create({ name: 'Conc Cafe B', slug: 'conc-b' });
  const cat = await MenuCategory.create({ tenant_id: tenantA.id, name: 'Snacks' });

  const owner = await User.create({
    name: 'Conc Owner',
    email: 'concowner@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  const cashier = await User.create({
    name: 'Conc Cashier',
    email: 'conccashier@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenantA.id, role: 'owner' });
  await UserTenant.create({ user_id: cashier.id, tenant_id: tenantA.id, role: 'cashier' });

  const login = async (email) =>
    (await request(app).post('/api/auth/login').send({ email, password: 'password123' })).body
      .accessToken;
  ownerToken = await login('concowner@example.com');
  cashierToken = await login('conccashier@example.com');

  await Product.create({
    tenant_id: tenantA.id,
    name: 'Keepable Item',
    price: 100,
    weight_gm: 200,
    enabled: true,
    category_id: cat.id,
  });
  await Product.create({
    tenant_id: tenantA.id,
    name: 'Locked Item',
    price: 120,
    weight_gm: 220,
    enabled: true,
  });
  await Product.create({ tenant_id: tenantB.id, name: 'Other Tenant', price: 5, weight_gm: 5 });
});

afterAll(async () => {
  await sequelize.close();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('soft delete', () => {
  it('DELETE removes the item from lists but keeps the row (deleted_at set)', async () => {
    const product = await Product.findOne({ where: { tenant_id: tenantA.id, name: 'Keepable Item' } });
    await ItemVariant.create({ tenant_id: tenantA.id, product_id: product.id, name: 'Small' });

    const res = await request(app)
      .delete(`/api/products/${product.id}`)
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: product.id, deleted: true });

    // Paranoid scope hides it…
    expect(await Product.findByPk(product.id)).toBeNull();
    expect(await Product.count({ where: { tenant_id: tenantA.id, name: 'Keepable Item' } })).toBe(0);
    // …but the row physically remains with a deleted_at timestamp.
    const raw = await Product.findOne({ where: { id: product.id }, paranoid: false });
    expect(raw).not.toBeNull();
    expect(raw.deletedAt).toBeTruthy();
    // Child variants were hard-removed by the route.
    expect(await ItemVariant.count({ where: { product_id: product.id } })).toBe(0);
  });

  it('a soft-deleted item disappears from the public storefront', async () => {
    const product = await Product.findOne({ where: { tenant_id: tenantA.id, name: 'Keepable Item' }, paranoid: false });
    const menu = await request(app).get('/api/public/restaurants/conc-a/menu');
    const allNames = menu.body.categories.flatMap((c) => c.items.map((i) => i.name));
    expect(allNames).not.toContain('Keepable Item');
    expect(product.deletedAt).toBeTruthy();
  });

  it('re-deleting a soft-deleted item 404s (fail-closed)', async () => {
    const product = await Product.findOne({ where: { tenant_id: tenantA.id, name: 'Keepable Item' }, paranoid: false });
    const res = await request(app)
      .delete(`/api/products/${product.id}`)
      .set(auth(ownerToken));
    expect(res.status).toBe(404);
  });
});

describe('optimistic locking (version)', () => {
  it('PUT without a version keeps working (legacy callers)', async () => {
    const product = await Product.findOne({ where: { tenant_id: tenantA.id, name: 'Locked Item' } });
    const res = await request(app)
      .put(`/api/products/${product.id}`)
      .set(auth(ownerToken))
      .send({ price: 130 });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
  });

  it('PUT with a stale version → 409 VERSION_CONFLICT', async () => {
    const product = await Product.findOne({ where: { tenant_id: tenantA.id, name: 'Locked Item' } });
    const stale = await request(app)
      .put(`/api/products/${product.id}`)
      .set(auth(ownerToken))
      .send({ price: 999, version: product.version - 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    // Nothing changed.
    const fresh = await Product.findByPk(product.id);
    expect(Number(fresh.price)).toBe(130);
    expect(fresh.version).toBe(2);
  });

  it('PUT with the correct version succeeds and bumps the version', async () => {
    const product = await Product.findOne({ where: { tenant_id: tenantA.id, name: 'Locked Item' } });
    const res = await request(app)
      .put(`/api/products/${product.id}`)
      .set(auth(ownerToken))
      .send({ price: 140, version: product.version });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(product.version + 1);
  });
});

describe('inventory', () => {
  it('create accepts an inventory snapshot', async () => {
    const res = await request(app)
      .post('/api/products')
      .set(auth(ownerToken))
      .send({
        name: 'Stocked Item',
        price: 60,
        weight_gm: 100,
        inventory: { stock_qty: 25, low_stock_at: 5, unit: 'pcs' },
      });
    expect(res.status).toBe(201);
    expect(res.body.inventory).toMatchObject({ stock_qty: 25, low_stock_at: 5, unit: 'pcs' });
  });

  it('PATCH /:id/inventory adjusts stock quickly', async () => {
    const product = await Product.findOne({ where: { tenant_id: tenantA.id, name: 'Stocked Item' } });
    const res = await request(app)
      .patch(`/api/products/${product.id}/inventory`)
      .set(auth(ownerToken))
      .send({ stock_qty: 3 });
    expect(res.status).toBe(200);
    expect(res.body.stock_qty).toBe(3);
    expect(res.body.low_stock_at).toBe(5); // untouched field preserved
  });

  it('GET /api/products returns the inventory with each item', async () => {
    const res = await request(app)
      .get('/api/products?limit=50')
      .set(auth(ownerToken));
    const stocked = res.body.find((p) => p.name === 'Stocked Item');
    expect(stocked.inventory).toMatchObject({ stock_qty: 3, low_stock_at: 5, unit: 'pcs' });
  });

  it('inventory is tenant-scoped (fail-closed)', async () => {
    const other = await Product.findOne({ where: { tenant_id: tenantB.id } });
    const res = await request(app)
      .patch(`/api/products/${other.id}/inventory`)
      .set(auth(ownerToken))
      .send({ stock_qty: 99 });
    expect(res.status).toBe(404);
    expect(await InventoryItem.count({ where: { tenant_id: tenantB.id } })).toBe(0);
  });

  it('blocks non-menu roles (RBAC manage:menu)', async () => {
    const product = await Product.findOne({ where: { tenant_id: tenantA.id, name: 'Stocked Item' } });
    const res = await request(app)
      .patch(`/api/products/${product.id}/inventory`)
      .set(auth(cashierToken))
      .send({ stock_qty: 1 });
    expect(res.status).toBe(403);
  });
});
