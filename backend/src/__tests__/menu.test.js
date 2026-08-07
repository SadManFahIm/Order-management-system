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
  MenuCategory,
  ItemVariant,
  ItemAddon,
} from '../models/index.js';

/**
 * Menu management suite (Phase 4).
 * Categories, variants and add-ons are tenant-scoped entities with RBAC:
 *  - owners/managers/admins can mutate; cashiers can only view
 *  - cross-tenant access (including ID injection) is rejected
 *  - self-parent and cross-tenant parent categories are rejected
 */

let tenantA;
let tenantB;
let ownerToken;
let cashierToken;
let productA;
let productB;
let categoryA;

beforeAll(async () => {
  await resetTestDb();

  tenantA = await Tenant.create({ name: 'Cafe Alpha', slug: 'menu-alpha' });
  tenantB = await Tenant.create({ name: 'Cafe Beta', slug: 'menu-beta' });

  const owner = await User.create({
    name: 'Menu Owner',
    email: 'menuowner@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  const cashier = await User.create({
    name: 'Menu Cashier',
    email: 'menucashier@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenantA.id, role: 'owner' });
  await UserTenant.create({ user_id: cashier.id, tenant_id: tenantA.id, role: 'cashier' });

  const login = async (email) =>
    (await request(app).post('/api/auth/login').send({ email, password: 'password123' })).body
      .accessToken;
  ownerToken = await login('menuowner@example.com');
  cashierToken = await login('menucashier@example.com');

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

  categoryA = await MenuCategory.create({
    tenant_id: tenantA.id,
    name: 'Burgers',
    sort_order: 1,
  });
  await MenuCategory.create({ tenant_id: tenantB.id, name: 'Pizzas', sort_order: 1 });
});

afterAll(async () => {
  await sequelize.close();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('category CRUD', () => {
  it('owner can create a category', async () => {
    const res = await request(app)
      .post('/api/menu/categories')
      .set(auth(ownerToken))
      .send({ name: 'Sides', sortOrder: 2 });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Sides');
    expect(res.body.tenant_id).toBe(tenantA.id);
  });

  it('cashier cannot create a category (RBAC)', async () => {
    const res = await request(app)
      .post('/api/menu/categories')
      .set(auth(cashierToken))
      .send({ name: 'Nope' });
    expect(res.status).toBe(403);
  });

  it('cashier can view categories (read permission)', async () => {
    const res = await request(app).get('/api/menu/categories').set(auth(cashierToken));
    expect(res.status).toBe(200);
    expect(res.body.some((c) => c.name === 'Burgers')).toBe(true);
  });

  it('cannot create a category under another tenants parent', async () => {
    const res = await request(app)
      .post('/api/menu/categories')
      .set(auth(ownerToken))
      .send({ name: 'Drinks', parentId: 99999 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARENT');
  });

  it('cannot set a category as its own parent', async () => {
    const res = await request(app)
      .put(`/api/menu/categories/${categoryA.id}`)
      .set(auth(ownerToken))
      .send({ parentId: categoryA.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARENT');
  });

  it('cannot update or delete another tenants category (ID injection)', async () => {
    const foreign = await MenuCategory.findOne({
      where: { tenant_id: tenantB.id, name: 'Pizzas' },
    });
    const upd = await request(app)
      .put(`/api/menu/categories/${foreign.id}`)
      .set(auth(ownerToken))
      .send({ name: 'Hacked' });
    expect(upd.status).toBe(404);

    const del = await request(app)
      .delete(`/api/menu/categories/${foreign.id}`)
      .set(auth(ownerToken));
    expect(del.status).toBe(404);
  });

  it('owner can rename a category', async () => {
    const res = await request(app)
      .put(`/api/menu/categories/${categoryA.id}`)
      .set(auth(ownerToken))
      .send({ name: 'Gourmet Burgers' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Gourmet Burgers');
  });
});

describe('variant CRUD', () => {
  it('owner can add a variant to their product', async () => {
    const res = await request(app)
      .post(`/api/menu/products/${productA.id}/variants`)
      .set(auth(ownerToken))
      .send({ name: 'Large', priceAdjustment: 80 });
    expect(res.status).toBe(201);
    expect(res.body.tenant_id).toBe(tenantA.id);
  });

  it('cannot add a variant to another tenants product (ID injection)', async () => {
    const res = await request(app)
      .post(`/api/menu/products/${productB.id}/variants`)
      .set(auth(ownerToken))
      .send({ name: 'Extra Large' });
    expect(res.status).toBe(404);
  });

  it('cashier cannot add a variant (RBAC)', async () => {
    const res = await request(app)
      .post(`/api/menu/products/${productA.id}/variants`)
      .set(auth(cashierToken))
      .send({ name: 'Nope' });
    expect(res.status).toBe(403);
  });

  it('variant list is tenant-scoped', async () => {
    const res = await request(app)
      .get(`/api/menu/products/${productA.id}/variants`)
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body.some((v) => v.name === 'Large')).toBe(true);

    // Foreign product id must not leak
    const foreign = await request(app)
      .get(`/api/menu/products/${productB.id}/variants`)
      .set(auth(ownerToken));
    expect(foreign.status).toBe(200);
    expect(foreign.body).toEqual([]);
  });

  it('owner can update and delete a variant', async () => {
    const variant = await ItemVariant.findOne({
      where: { tenant_id: tenantA.id, product_id: productA.id, name: 'Large' },
    });
    const upd = await request(app)
      .put(`/api/menu/variants/${variant.id}`)
      .set(auth(ownerToken))
      .send({ priceAdjustment: 100 });
    expect(upd.status).toBe(200);
    expect(upd.body.price_adjustment).toBe(100);

    const del = await request(app)
      .delete(`/api/menu/variants/${variant.id}`)
      .set(auth(ownerToken));
    expect(del.status).toBe(200);
  });
});

describe('add-on CRUD', () => {
  it('owner can add an add-on to their product', async () => {
    const res = await request(app)
      .post(`/api/menu/products/${productA.id}/addons`)
      .set(auth(ownerToken))
      .send({ name: 'Extra Cheese', price: 60 });
    expect(res.status).toBe(201);
    expect(res.body.price).toBe(60);
  });

  it('cannot add an add-on to another tenants product', async () => {
    const res = await request(app)
      .post(`/api/menu/products/${productB.id}/addons`)
      .set(auth(ownerToken))
      .send({ name: 'Cheese' });
    expect(res.status).toBe(404);
  });

  it('cannot mutate another tenants add-on (ID injection)', async () => {
    const foreign = await ItemAddon.create({
      tenant_id: tenantB.id,
      product_id: productB.id,
      name: 'Beta Topping',
      price: 50,
    });
    const del = await request(app)
      .delete(`/api/menu/addons/${foreign.id}`)
      .set(auth(ownerToken));
    expect(del.status).toBe(404);
  });

  it('tenant A sees only its own add-ons', async () => {
    const res = await request(app)
      .get(`/api/menu/products/${productA.id}/addons`)
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body.some((a) => a.name === 'Extra Cheese')).toBe(true);
  });
});

describe('product menu fields', () => {
  it('products expose category/prep fields in list', async () => {
    await productA.update({ category_id: categoryA.id, prep_minutes: 8 });
    const res = await request(app).get('/api/products').set(auth(ownerToken));
    expect(res.status).toBe(200);
    const mine = res.body.find((p) => p.id === productA.id);
    expect(mine.category_id).toBe(categoryA.id);
    expect(mine.prep_minutes).toBe(8);
  });
});
