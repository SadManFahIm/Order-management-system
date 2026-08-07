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
  PromotionSlab,
  MenuCategory,
  ItemVariant,
  ItemAddon,
} from '../models/index.js';

/**
 * DELETE endpoints (Phase 4 completion): products + promotions.
 * Verifies hard delete, cascade of children (variants/add-ons, slabs), and
 * fail-closed tenant scoping.
 */

let tenantA;
let tenantB;
let ownerToken;
let cashierToken;

beforeAll(async () => {
  await resetTestDb();

  tenantA = await Tenant.create({ name: 'Del Cafe A', slug: 'del-a' });
  tenantB = await Tenant.create({ name: 'Del Cafe B', slug: 'del-b' });
  const cat = await MenuCategory.create({ tenant_id: tenantA.id, name: 'Burgers' });

  const owner = await User.create({
    name: 'Del Owner',
    email: 'delowner@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  const cashier = await User.create({
    name: 'Del Cashier',
    email: 'delcashier@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenantA.id, role: 'owner' });
  await UserTenant.create({ user_id: cashier.id, tenant_id: tenantA.id, role: 'cashier' });

  const login = async (email) =>
    (await request(app).post('/api/auth/login').send({ email, password: 'password123' })).body
      .accessToken;
  ownerToken = await login('delowner@example.com');
  cashierToken = await login('delcashier@example.com');

  // Seed a product with variants + add-ons, and a weighted promotion with slabs.
  const product = await Product.create({
    tenant_id: tenantA.id,
    name: 'Doomed Burger',
    price: 250,
    weight_gm: 300,
    enabled: true,
    category_id: cat.id,
  });
  await ItemVariant.create({ tenant_id: tenantA.id, product_id: product.id, name: 'Large', price_adjustment: 50 });
  await ItemAddon.create({ tenant_id: tenantA.id, product_id: product.id, name: 'Extra Cheese', price: 40 });

  const promo = await Promotion.create({
    tenant_id: tenantA.id,
    title: 'Doomed Promo',
    type: 'weighted',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    enabled: true,
  });
  await PromotionSlab.create({
    promotion_id: promo.id,
    min_weight_gm: 1000,
    max_weight_gm: 2000,
    discount_per_500gm: 50,
  });

  // A product in tenant B to prove isolation.
  await Product.create({ tenant_id: tenantB.id, name: 'Other Tenant Item', price: 10, weight_gm: 10 });
  await Promotion.create({
    tenant_id: tenantB.id,
    title: 'Other Tenant Promo',
    type: 'percentage',
    percentage_value: 10,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    enabled: true,
  });
});

afterAll(async () => {
  await sequelize.close();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('DELETE /api/products/:id', () => {
  it('deletes a product and cascades variants + add-ons', async () => {
    const product = await Product.findOne({ where: { tenant_id: tenantA.id, name: 'Doomed Burger' } });
    const variantsBefore = await ItemVariant.count({ where: { product_id: product.id } });
    const addonsBefore = await ItemAddon.count({ where: { product_id: product.id } });
    expect(variantsBefore).toBe(1);
    expect(addonsBefore).toBe(1);

    const res = await request(app)
      .delete(`/api/products/${product.id}`)
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: product.id, deleted: true });

    expect(await Product.findByPk(product.id)).toBeNull();
    expect(await ItemVariant.count({ where: { product_id: product.id } })).toBe(0);
    expect(await ItemAddon.count({ where: { product_id: product.id } })).toBe(0);
  });

  it('404s for products in other tenants (fail-closed)', async () => {
    const other = await Product.findOne({ where: { tenant_id: tenantB.id } });
    const res = await request(app)
      .delete(`/api/products/${other.id}`)
      .set(auth(ownerToken));
    expect(res.status).toBe(404);
    expect(await Product.findByPk(other.id)).not.toBeNull();
  });

  it('404s for unknown ids', async () => {
    const res = await request(app).delete('/api/products/999999').set(auth(ownerToken));
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const product = await Product.findOne({ where: { tenant_id: tenantB.id } });
    const res = await request(app).delete(`/api/products/${product.id}`);
    expect(res.status).toBe(401);
  });

  it('blocks non-menu roles (RBAC manage:menu)', async () => {
    const product = await Product.findOne({ where: { tenant_id: tenantB.id } });
    const res = await request(app)
      .delete(`/api/products/${product.id}`)
      .set(auth(cashierToken));
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/promotions/:id', () => {
  it('deletes a promotion and cascades slabs', async () => {
    const promo = await Promotion.findOne({ where: { tenant_id: tenantA.id, title: 'Doomed Promo' } });
    expect(await PromotionSlab.count({ where: { promotion_id: promo.id } })).toBe(1);

    const res = await request(app)
      .delete(`/api/promotions/${promo.id}`)
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: promo.id, deleted: true });

    expect(await Promotion.findByPk(promo.id)).toBeNull();
    expect(await PromotionSlab.count({ where: { promotion_id: promo.id } })).toBe(0);
  });

  it('404s for promotions in other tenants (fail-closed)', async () => {
    const other = await Promotion.findOne({ where: { tenant_id: tenantB.id } });
    const res = await request(app)
      .delete(`/api/promotions/${other.id}`)
      .set(auth(ownerToken));
    expect(res.status).toBe(404);
    expect(await Promotion.findByPk(other.id)).not.toBeNull();
  });

  it('requires authentication and manage:promotions', async () => {
    const other = await Promotion.findOne({ where: { tenant_id: tenantB.id } });
    const anon = await request(app).delete(`/api/promotions/${other.id}`);
    expect(anon.status).toBe(401);

    const cashierRes = await request(app)
      .delete(`/api/promotions/${other.id}`)
      .set(auth(cashierToken));
    expect(cashierRes.status).toBe(403);
  });
});
