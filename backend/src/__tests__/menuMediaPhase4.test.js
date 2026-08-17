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
  MenuCategory,
  ItemVariant,
  InventoryItem,
} from '../models/index.js';
import {
  isAvailableNow,
  isAvailableAt,
  buildAvailabilityContext,
  normalizeTags,
  ITEM_TAGS,
  dateKey,
  computeNextOpenAt,
} from '../services/menuService.js';
import sharp from 'sharp';

/**
 * Phase 4 — Menu & Media: item-level availability schedule, dietary/merch
 * tags, bulk edit + category duplication, drag-and-drop sort, variant-level
 * stock (enforcement + decrement), and the image optimize (crop/compress +
 * CDN invalidation) endpoint.
 */

const PASSWORD = 'Str0ngPass!42';

let tenant;
let ownerToken;

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

async function login(email) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password: PASSWORD });
  return res.body?.accessToken;
}

async function createProduct(overrides = {}) {
  const res = await request(app)
    .post('/api/products')
    .set(auth(ownerToken))
    .send({
      name: 'Kacchi Biryani',
      description: 'Long-grain rice + slow-cooked mutton',
      price: 320,
      weight_gm: 500,
      category_id: overrides.categoryId ?? null,
      ...overrides,
    });
  return res.body;
}

beforeAll(async () => {
  await resetTestDb();

  const [free] = await Plan.findOrCreate({
    where: { code: 'free' },
    defaults: { name: 'Free', price_mo: 0, max_products: 50, max_orders_per_day: 50, max_members: 10, storage_mb: 100 },
  });
  await free.update({ max_products: 50, max_orders_per_day: 50, max_members: 10, storage_mb: 100 });

  tenant = await Tenant.create({ name: 'P4 Diner', slug: 'p4-diner', plan_id: free.id });
  const owner = await User.create({
    name: 'P4 Owner',
    email: 'p4.owner@example.com',
    password: await bcrypt.hash(PASSWORD, 4),
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenant.id, role: 'owner' });
  ownerToken = await login(owner.email);
});

afterAll(async () => {
  await sequelize.close();
});

describe('item-level availability schedule', () => {
  it('filters scheduled items in the public menu and rejects checkout outside the window', async () => {
    // Open window (all-day): from 00:00 to 23:59 (a 1-minute-per-day
    // 23:59 edge is acceptable; the closed window below is the guarantee).
    const open = await createProduct({ name: 'Open Item', available_from: '00:00', available_to: '23:59' });
    // Closed window: structurally empty (from === to) — available only when
    // now >= 09:00 AND now < 09:00, which is never, at any wall-clock time.
    const closed = await createProduct({ name: 'Closed Item', available_from: '09:00', available_to: '09:00' });

    const pub = await request(app).get('/api/public/restaurants/p4-diner/menu');
    const items = pub.body.categories.flatMap((c) => c.items);
    const openItem = items.find((i) => i.id === open.id);
    const closedItem = items.find((i) => i.id === closed.id);

    expect(openItem.available).toBe(true);
    // The closed item is filtered out entirely when ?available=true (default).
    expect(closedItem).toBeUndefined();

    // And the storefront with available=false shows it flagged unavailable.
    const all = await request(app).get('/api/public/restaurants/p4-diner/menu?available=false');
    const closedShown = all.body.categories.flatMap((c) => c.items).find((i) => i.id === closed.id);
    expect(closedShown.available).toBe(false);

    // Checkout of the closed item is rejected even though enabled=true.
    const attempt = await request(app)
      .post('/api/public/restaurants/p4-diner/checkout')
      .send({
        order_type: 'delivery',
        customer_name: 'Buyer',
        customer_phone: '+8801711111111',
        customer_address: '12 Dhanmondi',
        items: [{ product_id: closed.id, quantity: 1 }],
      });
    expect(attempt.status).toBe(400);
    expect(attempt.body.error.code).toBe('AVAILABILITY_WINDOW');
  });

  it('isAvailableNow treats NULL bounds as always available', () => {
    expect(isAvailableNow({ available_from: null, available_to: null })).toBe(true);
  });

  it('isAvailableNow handles disabled items, overnight and one-sided windows', () => {
    // Hard switch off wins even inside the window.
    expect(isAvailableNow({ enabled: false, available_from: '00:00', available_to: '23:59' })).toBe(false);
    // Null item → false.
    expect(isAvailableNow(null)).toBe(false);

    // Overnight window (from > to): orderable late at night AND early morning.
    const overnight = { enabled: true, available_from: '22:00', available_to: '04:00' };
    expect(isAvailableNow(overnight, new Date('2026-08-17T23:30:00'))).toBe(true);
    expect(isAvailableNow(overnight, new Date('2026-08-17T02:30:00'))).toBe(true);
    expect(isAvailableNow(overnight, new Date('2026-08-17T12:00:00'))).toBe(false);

    // One-sided windows: only a start bound → open from then on.
    expect(isAvailableNow({ enabled: true, available_from: '10:00', available_to: null }, new Date('2026-08-17T11:00:00'))).toBe(true);
    expect(isAvailableNow({ enabled: true, available_from: '10:00', available_to: null }, new Date('2026-08-17T09:00:00'))).toBe(false);
    // Only an end bound → open until then.
    expect(isAvailableNow({ enabled: true, available_from: null, available_to: '18:00' }, new Date('2026-08-17T17:00:00'))).toBe(true);
    expect(isAvailableNow({ enabled: true, available_from: null, available_to: '18:00' }, new Date('2026-08-17T19:00:00'))).toBe(false);

    // Invalid time strings are treated as "no bound" → any time.
    expect(isAvailableNow({ enabled: true, available_from: '99:99', available_to: '99:99' })).toBe(true);
  });
});

describe('dietary / merchandising tags', () => {
  it('normalizes and de-dupes tags, rejecting unknown values', () => {
    expect(normalizeTags(['veg', 'VEG', 'spicy', 'veg'])).toEqual(['veg', 'spicy']);
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags(null)).toEqual([]);
    expect(ITEM_TAGS).toContain('bestseller');
  });

  it('persists tags on create and returns them in the public menu', async () => {
    const p = await createProduct({ name: 'Tagged Dish', tags: ['veg', 'bestseller'] });
    expect(p.tags).toEqual(['veg', 'bestseller']);

    const pub = await request(app).get('/api/public/restaurants/p4-diner/menu?available=false');
    const items = pub.body.categories.flatMap((c) => c.items);
    const shown = items.find((i) => i.id === p.id);
    expect(shown.tags).toEqual(['veg', 'bestseller']);
  });
});

describe('bulk edit', () => {
  it('updates price, enabled, tags and inventory stock across many items in one call', async () => {
    const a = await createProduct({ name: 'Bulk A', price: 100 });
    const b = await createProduct({ name: 'Bulk B', price: 200 });

    const res = await request(app)
      .post('/api/products/bulk')
      .set(auth(ownerToken))
      .send({
        ids: [a.id, b.id],
        price: 150,
        enabled: false,
        tags: ['spicy'],
        inventory: { stock_qty: 42, low_stock_at: 5, unit: 'plate' },
      });
    expect(res.status).toBe(200);
    expect(res.body.updated).toHaveLength(2);
    for (const row of res.body.updated) {
      expect(row.price).toBe(150);
      expect(row.enabled).toBe(false);
      expect(row.tags).toEqual(['spicy']);
    }

    const inv = await InventoryItem.findAll({ where: { tenant_id: tenant.id } });
    expect(inv.some((i) => Number(i.stock_qty) === 42)).toBe(true);
  });

  it('rejects an empty id list', async () => {
    const res = await request(app)
      .post('/api/products/bulk')
      .set(auth(ownerToken))
      .send({ ids: [], price: 1 });
    expect(res.status).toBe(400);
  });

  it('validates bulk payload fields', async () => {
    const a = await createProduct({ name: 'Bulk Valid' });
    // Negative price.
    let res = await request(app).post('/api/products/bulk').set(auth(ownerToken)).send({ ids: [a.id], price: -5 });
    expect(res.status).toBe(400);
    // Out-of-range vatRate.
    res = await request(app).post('/api/products/bulk').set(auth(ownerToken)).send({ ids: [a.id], vatRate: 150 });
    expect(res.status).toBe(400);
    // tags neither an array nor a valid single tag → rejected.
    res = await request(app).post('/api/products/bulk').set(auth(ownerToken)).send({ ids: [a.id], tags: 42 });
    expect(res.status).toBe(400);
    // More than 200 ids.
    const many = Array.from({ length: 201 }, (_, i) => i + 1);
    res = await request(app).post('/api/products/bulk').set(auth(ownerToken)).send({ ids: many });
    expect(res.status).toBe(400);
    // No matching items in this tenant → 404.
    res = await request(app).post('/api/products/bulk').set(auth(ownerToken)).send({ ids: [999999] });
    expect(res.status).toBe(404);
  });
});

describe('category duplication', () => {
  it('deep-copies a category with items, variants and add-ons', async () => {
    const cat = await MenuCategory.create({ tenant_id: tenant.id, name: 'Grill', sort_order: 1 });
    const p = await createProduct({ name: 'Grill Item', categoryId: cat.id });
    await ItemVariant.create({ tenant_id: tenant.id, product_id: p.id, name: 'Large', price_adjustment: 50, stock: 8 });

    const res = await request(app)
      .post(`/api/products/categories/${cat.id}/duplicate`)
      .set(auth(ownerToken));
    expect(res.status).toBe(201);

    const copy = res.body;
    expect(copy.id).not.toBe(cat.id);
    expect(copy.name).toContain('(copy)');
    expect(copy.products).toHaveLength(1);
    expect(copy.products[0].variants).toHaveLength(1);
    expect(copy.products[0].variants[0].name).toBe('Large');
  });
});

describe('variant-level stock', () => {
  it('rejects ordering more than the variant stock and decrements after placement', async () => {
    const p = await createProduct({ name: 'Stocked Dish', price: 120 });
    const v = await ItemVariant.create({ tenant_id: tenant.id, product_id: p.id, name: 'Small', price_adjustment: 0, stock: 3 });

    // Over-stock attempt → 400 VARIANT_OUT_OF_STOCK.
    const over = await request(app)
      .post('/api/public/restaurants/p4-diner/checkout')
      .send({
        order_type: 'delivery',
        customer_name: 'Buyer',
        customer_phone: '+8801711111111',
        customer_address: '12 Dhanmondi',
        items: [{ product_id: p.id, quantity: 5, variant_id: v.id }],
      });
    expect(over.status).toBe(400);
    expect(over.body.error.code).toBe('VARIANT_OUT_OF_STOCK');

    // Valid placement → stock 3 → 1.
    const ok = await request(app)
      .post('/api/public/restaurants/p4-diner/checkout')
      .send({
        order_type: 'delivery',
        customer_name: 'Buyer',
        customer_phone: '+8801711111111',
        customer_address: '12 Dhanmondi',
        items: [{ product_id: p.id, quantity: 2, variant_id: v.id }],
      });
    expect(ok.status).toBe(201);

    const after = await ItemVariant.findByPk(v.id);
    expect(Number(after.stock)).toBe(1);
  });

  it('leaves unlimited variants (stock NULL) untouched', async () => {
    const p = await createProduct({ name: 'Unlimited Dish' });
    const v = await ItemVariant.create({ tenant_id: tenant.id, product_id: p.id, name: 'Regular', price_adjustment: 0, stock: null });

    const ok = await request(app)
      .post('/api/public/restaurants/p4-diner/checkout')
      .send({
        order_type: 'delivery',
        customer_name: 'Buyer',
        customer_phone: '+8801711111111',
        customer_address: '12 Dhanmondi',
        items: [{ product_id: p.id, quantity: 4, variant_id: v.id }],
      });
    expect(ok.status).toBe(201);
    const after = await ItemVariant.findByPk(v.id);
    expect(after.stock).toBeNull();
  });
});

describe('drag-and-drop sort', () => {
  it('persists sort_order from an ordered id list', async () => {
    const a = await createProduct({ name: 'Sort A' });
    const b = await createProduct({ name: 'Sort B' });
    const c = await createProduct({ name: 'Sort C' });

    const res = await request(app)
      .post('/api/products/sort')
      .set(auth(ownerToken))
      .send({ order: [c.id, a.id, b.id] });
    expect(res.status).toBe(200);

    const ordered = res.body.updated;
    expect(ordered.map((r) => r.id)).toEqual([c.id, a.id, b.id]);
    expect(ordered.map((r) => r.sort_order)).toEqual([0, 1, 2]);
  });

  it('validates the sort payload', async () => {
    // Empty order list → 400.
    let res = await request(app).post('/api/products/sort').set(auth(ownerToken)).send({ order: [] });
    expect(res.status).toBe(400);
    // More than 500 ids → 400.
    const many = Array.from({ length: 501 }, (_, i) => i + 1);
    res = await request(app).post('/api/products/sort').set(auth(ownerToken)).send({ order: many });
    expect(res.status).toBe(400);
    // Unknown ids are ignored but the request still succeeds.
    res = await request(app).post('/api/products/sort').set(auth(ownerToken)).send({ order: [999999] });
    expect(res.status).toBe(200);
    expect(res.body.updated).toEqual([]);
  });
});

describe('category drag-and-drop sort', () => {
  it('persists category sort_order and validates the payload', async () => {
    const c1 = await MenuCategory.create({ tenant_id: tenant.id, name: 'A', sort_order: 0 });
    const c2 = await MenuCategory.create({ tenant_id: tenant.id, name: 'B', sort_order: 1 });
    const c3 = await MenuCategory.create({ tenant_id: tenant.id, name: 'C', sort_order: 2 });

    const res = await request(app)
      .post('/api/menu/categories/sort')
      .set(auth(ownerToken))
      .send({ order: [c3.id, c1.id, c2.id] });
    expect(res.status).toBe(200);
    expect(res.body.updated.map((c) => c.id)).toEqual([c3.id, c1.id, c2.id]);
    expect(res.body.updated.map((c) => c.sort_order)).toEqual([0, 1, 2]);

    // Empty order → 400.
    let bad = await request(app).post('/api/menu/categories/sort').set(auth(ownerToken)).send({ order: [] });
    expect(bad.status).toBe(400);
    // Unknown ids are ignored, request still succeeds.
    bad = await request(app).post('/api/menu/categories/sort').set(auth(ownerToken)).send({ order: [999999] });
    expect(bad.status).toBe(200);
  });
});

describe('variant-level low stock', () => {
  it('persists lowStockAt on variants and flags the dashboard alert', async () => {
    const p = await createProduct({ name: 'Low-Stock Dish' });
    const v = await ItemVariant.create({
      tenant_id: tenant.id,
      product_id: p.id,
      name: 'Medium',
      price_adjustment: 10,
      stock: 3,
      low_stock_at: 5,
    });

    // PUT supports the lowStockAt field.
    const upd = await request(app)
      .put(`/api/menu/variants/${v.id}`)
      .set(auth(ownerToken))
      .send({ lowStockAt: 4 });
    expect(upd.status).toBe(200);
    expect(upd.body.low_stock_at).toBe(4);

    // The dashboard alert lists the variant (stock 3 <= threshold 4).
    const dash = await request(app).get('/api/dashboard').set(auth(ownerToken));
    expect(dash.status).toBe(200);
    const alert = (dash.body.alerts || []).find((a) => a.code === 'LOW_VARIANT_STOCK');
    expect(alert).toBeDefined();
    expect(alert.count).toBeGreaterThan(0);
    expect(alert.items[0].name).toContain('Low-Stock Dish');
  });

  it('does not alert for variants without a threshold or with NULL stock', async () => {
    const p = await createProduct({ name: 'Quiet Variants' });
    // Stocked but no threshold.
    await ItemVariant.create({ tenant_id: tenant.id, product_id: p.id, name: 'S', price_adjustment: 0, stock: 1, low_stock_at: null });
    // Above threshold.
    await ItemVariant.create({ tenant_id: tenant.id, product_id: p.id, name: 'L', price_adjustment: 0, stock: 9, low_stock_at: 2 });
    // NULL stock (unlimited) with a threshold — never alerted.
    await ItemVariant.create({ tenant_id: tenant.id, product_id: p.id, name: 'XL', price_adjustment: 0, stock: null, low_stock_at: 3 });

    const dash = await request(app).get('/api/dashboard').set(auth(ownerToken));
    const alert = (dash.body.alerts || []).find((a) => a.code === 'LOW_VARIANT_STOCK');
    // If the alert exists it must not include these quiet variants.
    const names = (alert?.items || []).map((i) => i.name);
    expect(names.some((n) => n.includes('Quiet Variants'))).toBe(false);
  });
});

describe('decrementVariantStock helper', () => {
  it('no-ops with no tracked variants and skips removed variants', async () => {
    const { decrementVariantStock } = await import('../services/menuService.js');
    // No tracked lines → nothing happens.
    await expect(decrementVariantStock([])).resolves.toBeUndefined();
    await expect(decrementVariantStock([{ variant: null, quantity: 2 }])).resolves.toBeUndefined();
    // A variant row that no longer exists is skipped, not fatal.
    await expect(
      decrementVariantStock([{ variant: { id: 999999, stock: 5 }, quantity: 2 }])
    ).resolves.toBeUndefined();
    // Zero/negative quantity lines are skipped too.
    const p = await createProduct({ name: 'Decrement Safe' });
    const v = await ItemVariant.create({ tenant_id: tenant.id, product_id: p.id, name: 'L', price_adjustment: 0, stock: 4 });
    await decrementVariantStock([{ variant: v, quantity: 0 }]);
    const after = await ItemVariant.findByPk(v.id);
    expect(Number(after.stock)).toBe(4);
  });
});

describe('per-day availability overrides', () => {
  const tomorrow = () => dateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const today = () => dateKey();

  it('isAvailableNow honors an override: closed all day, windowed, and none', () => {
    const item = { enabled: true, available_from: null, available_to: null };
    // No override → all-day.
    expect(isAvailableNow(item, new Date('2026-08-17T12:00:00'))).toBe(true);
    // Override with no bounds → closed all day.
    const closed = { available_from: null, available_to: null };
    expect(isAvailableNow(item, new Date('2026-08-17T12:00:00'), closed)).toBe(false);
    // Windowed override replaces the base schedule.
    const morning = { available_from: '08:00', available_to: '10:00' };
    expect(isAvailableNow(item, new Date('2026-08-17T09:00:00'), morning)).toBe(true);
    expect(isAvailableNow(item, new Date('2026-08-17T12:00:00'), morning)).toBe(false);
    // A base-closed item opens under a windowed override.
    const baseClosed = { enabled: true, available_from: '09:00', available_to: '09:00' };
    expect(isAvailableNow(baseClosed, new Date('2026-08-17T09:00:00'))).toBe(false);
    expect(isAvailableNow(baseClosed, new Date('2026-08-17T09:00:00'), { available_from: '00:00', available_to: '23:59' })).toBe(true);
    // The enabled switch still wins even with an override.
    expect(isAvailableNow({ ...item, enabled: false }, new Date(), morning)).toBe(false);
  });

  it('PUT replaces the override set, GET lists it, and validation rejects bad input', async () => {
    const p = await createProduct({ name: 'Override Item' });
    const later = dateKey(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));

    // Replace-all: two overrides.
    let res = await request(app)
      .put(`/api/products/${p.id}/overrides`)
      .set(auth(ownerToken))
      .send({
        overrides: [
          { date: tomorrow(), available_from: null, available_to: null },
          { date: later, available_from: '10:00', available_to: '22:00' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].date).toBe(tomorrow());
    expect(res.body[0].available_from).toBeNull();
    expect(res.body[1].available_from).toBe('10:00');

    // GET returns them date-ascending.
    res = await request(app).get(`/api/products/${p.id}/overrides`).set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body.map((o) => o.date)).toEqual([tomorrow(), later]);

    // Replace with a single entry drops the other.
    res = await request(app)
      .put(`/api/products/${p.id}/overrides`)
      .set(auth(ownerToken))
      .send({ overrides: [{ date: later, available_from: null, available_to: null }] });
    expect(res.body).toHaveLength(1);
    expect(res.body[0].date).toBe(later);

    // Empty list clears everything.
    res = await request(app)
      .put(`/api/products/${p.id}/overrides`)
      .set(auth(ownerToken))
      .send({ overrides: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);

    // Validation: bad date.
    res = await request(app)
      .put(`/api/products/${p.id}/overrides`)
      .set(auth(ownerToken))
      .send({ overrides: [{ date: '2026-13-40', available_from: null, available_to: null }] });
    expect(res.status).toBe(400);
    // Validation: malformed time.
    res = await request(app)
      .put(`/api/products/${p.id}/overrides`)
      .set(auth(ownerToken))
      .send({ overrides: [{ date: tomorrow(), available_from: '9am', available_to: null }] });
    expect(res.status).toBe(400);
    // Validation: duplicate date.
    res = await request(app)
      .put(`/api/products/${p.id}/overrides`)
      .set(auth(ownerToken))
      .send({
        overrides: [
          { date: tomorrow(), available_from: null, available_to: null },
          { date: tomorrow(), available_from: '10:00', available_to: '12:00' },
        ],
      });
    expect(res.status).toBe(400);
    // Unknown product → 404.
    res = await request(app)
      .put('/api/products/999999/overrides')
      .set(auth(ownerToken))
      .send({ overrides: [] });
    expect(res.status).toBe(404);
  });

  it('hides an item closed for today from the storefront and rejects checkout', async () => {
    const p = await createProduct({ name: 'Holiday-Closed Dish' });
    await request(app)
      .put(`/api/products/${p.id}/overrides`)
      .set(auth(ownerToken))
      .send({ overrides: [{ date: today(), available_from: null, available_to: null }] });

    const pub = await request(app).get('/api/public/restaurants/p4-diner/menu');
    const items = pub.body.categories.flatMap((c) => c.items);
    expect(items.find((i) => i.id === p.id)).toBeUndefined();

    // available=false shows it flagged unavailable.
    const all = await request(app).get('/api/public/restaurants/p4-diner/menu?available=false');
    const shown = all.body.categories.flatMap((c) => c.items).find((i) => i.id === p.id);
    expect(shown.available).toBe(false);

    // Checkout rejects the closed-for-today item.
    const attempt = await request(app)
      .post('/api/public/restaurants/p4-diner/checkout')
      .send({
        order_type: 'delivery',
        customer_name: 'Buyer',
        customer_phone: '+8801711111111',
        customer_address: '12 Dhanmondi',
        items: [{ product_id: p.id, quantity: 1 }],
      });
    expect(attempt.status).toBe(400);
    expect(attempt.body.error.code).toBe('AVAILABILITY_WINDOW');

    // Clearing the override restores it.
    await request(app)
      .put(`/api/products/${p.id}/overrides`)
      .set(auth(ownerToken))
      .send({ overrides: [] });
    const again = await request(app).get('/api/public/restaurants/p4-diner/menu');
    const restored = again.body.categories.flatMap((c) => c.items).find((i) => i.id === p.id);
    expect(restored).toBeDefined();
    expect(restored.available).toBe(true);
  });

  it('a windowed override can open an item that is base-closed', async () => {
    const p = await createProduct({ name: 'Event Night Dish', available_from: '09:00', available_to: '09:00' });
    await request(app)
      .put(`/api/products/${p.id}/overrides`)
      .set(auth(ownerToken))
      .send({ overrides: [{ date: today(), available_from: '00:00', available_to: '23:59' }] });

    const pub = await request(app).get('/api/public/restaurants/p4-diner/menu');
    const items = pub.body.categories.flatMap((c) => c.items);
    expect(items.find((i) => i.id === p.id).available).toBe(true);
  });

  it('a scheduled order is validated against the scheduled date override', async () => {
    const p = await createProduct({ name: 'Scheduled-Closed Dish' });
    // Closed tomorrow.
    await request(app)
      .put(`/api/products/${p.id}/overrides`)
      .set(auth(ownerToken))
      .send({ overrides: [{ date: tomorrow(), available_from: null, available_to: null }] });

    // Immediate order (today) is fine.
    const now = await request(app)
      .post('/api/public/restaurants/p4-diner/checkout')
      .send({
        order_type: 'delivery',
        customer_name: 'Buyer',
        customer_phone: '+8801711111111',
        customer_address: '12 Dhanmondi',
        items: [{ product_id: p.id, quantity: 1 }],
      });
    expect(now.status).toBe(201);

    // Scheduled for tomorrow 12:00 → rejected (override closes that day).
    const at = new Date();
    at.setDate(at.getDate() + 1);
    at.setHours(12, 0, 0, 0);
    const attempt = await request(app)
      .post('/api/public/restaurants/p4-diner/checkout')
      .send({
        order_type: 'scheduled_pickup',
        customer_name: 'Buyer',
        customer_phone: '+8801711111111',
        scheduled_at: at.toISOString(),
        items: [{ product_id: p.id, quantity: 1 }],
      });
    expect(attempt.status).toBe(400);
    expect(attempt.body.error.code).toBe('AVAILABILITY_WINDOW');
  });
});

describe('storefront scarcity cue', () => {
  it('serializes product + variant stock and low-stock thresholds publicly', async () => {
    const tracked = await createProduct({ name: 'Low Stock Dish' });
    await request(app)
      .patch(`/api/products/${tracked.id}/inventory`)
      .set(auth(ownerToken))
      .send({ stock_qty: 3, low_stock_at: 5, unit: 'pcs' });
    await ItemVariant.create({
      tenant_id: tenant.id,
      product_id: tracked.id,
      name: 'Regular',
      price_adjustment: 0,
      stock: 2,
      low_stock_at: 4,
    });

    const untracked = await createProduct({ name: 'Untracked Dish' });

    const pub = await request(app).get('/api/public/restaurants/p4-diner/menu?available=false');
    const items = pub.body.categories.flatMap((c) => c.items);
    const a = items.find((i) => i.id === tracked.id);
    const b = items.find((i) => i.id === untracked.id);

    expect(a.stock).toBe(3);
    expect(a.lowStockAt).toBe(5);
    expect(a.variants[0].stock).toBe(2);
    expect(a.variants[0].lowStockAt).toBe(4);
    // Untracked items stay null — the storefront shows no cue.
    expect(b.stock).toBeNull();
    expect(b.lowStockAt).toBeNull();
    expect(b.variants).toEqual([]);
  });
});

describe('menu bulk organize', () => {
  it('moves items to a category and stamps an availability window in one call', async () => {
    const cat = await MenuCategory.create({ tenant_id: tenant.id, name: 'Bulk Zone', sort_order: 5 });
    const a = await createProduct({ name: 'Organize A' });
    const b = await createProduct({ name: 'Organize B' });

    const res = await request(app)
      .post('/api/products/bulk')
      .set(auth(ownerToken))
      .send({
        ids: [a.id, b.id],
        category_id: cat.id,
        available_from: '09:00',
        available_to: '22:00',
      });
    expect(res.status).toBe(200);
    for (const row of res.body.updated) {
      expect(row.category_id).toBe(cat.id);
      expect(row.available_from).toBe('09:00');
      expect(row.available_to).toBe('22:00');
    }

    // category_id: null uncategorises.
    const moved = await request(app)
      .post('/api/products/bulk')
      .set(auth(ownerToken))
      .send({ ids: [a.id], category_id: null });
    expect(moved.body.updated[0].category_id).toBeNull();

    // A category from another tenant is rejected (fail-closed).
    const other = await Tenant.create({ name: 'Other Co', slug: 'other-bulk-co', plan_id: tenant.plan_id });
    const foreign = await MenuCategory.create({ tenant_id: other.id, name: 'Foreign', sort_order: 1 });
    const bad = await request(app)
      .post('/api/products/bulk')
      .set(auth(ownerToken))
      .send({ ids: [b.id], category_id: foreign.id });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_CATEGORY');

    // Malformed window time → 400.
    const badTime = await request(app)
      .post('/api/products/bulk')
      .set(auth(ownerToken))
      .send({ ids: [b.id], available_from: '25:00', available_to: '22:00' });
    expect(badTime.status).toBe(400);

    // Clearing a window is possible with null bounds.
    const cleared = await request(app)
      .post('/api/products/bulk')
      .set(auth(ownerToken))
      .send({ ids: [b.id], available_from: null, available_to: null });
    expect(cleared.body.updated[0].available_from).toBeNull();
    expect(cleared.body.updated[0].available_to).toBeNull();
  });
});

describe('image optimization (crop / compress + CDN invalidation)', () => {
  it('rejects optimizing a non-existent image', async () => {
    const res = await request(app)
      .post('/api/uploads/images/00000000-0000-0000-0000-000000000000-nope.webp/optimize')
      .set(auth(ownerToken))
      .send({ quality: 60 });
    // Local driver: reading a missing file surfaces as 404.
    expect([400, 404]).toContain(res.status);
  });

  it('validates the upload key format', async () => {
    const res = await request(app)
      .post('/api/uploads/images/../../etc/passwd/optimize')
      .set(auth(ownerToken))
      .send({ quality: 60 });
    // Express normalizes `..` before routing, so a traversal attempt can
    // 404 before reaching the route — either outcome is a safe rejection.
    expect([400, 404]).toContain(res.status);
  });

  it('re-processes an uploaded image: crop, compress, same key', async () => {
    // Generate a real 64×64 red PNG in memory (no fixture files).
    const png = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 30, b: 30 } },
    })
      .png()
      .toBuffer();

    const up = await request(app)
      .post('/api/uploads/images')
      .set(auth(ownerToken))
      .attach('image', png, 'dish.png');
    expect(up.status).toBe(201);
    const fullKey = up.body.key;
    const fileName = fullKey.split('/').pop();

    // Crop a 32×32 region from the top-left + drop quality to 40.
    const opt = await request(app)
      .post(`/api/uploads/images/${fileName}/optimize`)
      .set(auth(ownerToken))
      .send({ quality: 40, crop: { x: 0, y: 0, width: 32, height: 32 } });
    expect(opt.status).toBe(200);
    expect(opt.body.width).toBe(32);
    expect(opt.body.height).toBe(32);
    expect(opt.body.url).toBe(fullKey);
    expect(opt.body.bytes).toBeGreaterThan(0);

    // Invalid quality (out of range) is clamped, not rejected.
    const clamped = await request(app)
      .post(`/api/uploads/images/${fileName}/optimize`)
      .set(auth(ownerToken))
      .send({ quality: 5 });
    expect(clamped.status).toBe(200);
  });
});

describe('restaurant-wide closures + recurring weekday rules (Phase 5)', () => {
  const tomorrow = () => dateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const today = () => dateKey();

  // A fixed Monday (2026-08-17 is a Monday) for weekday-rule resolution.
  const MON = '2026-08-17';
  const monNoon = new Date(`${MON}T12:00:00`);

  it('PUT/GET tenant closures: replace-all, validation, weekday closures', async () => {
    // Replace-all closure dates.
    let res = await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: [tomorrow(), today()] });
    expect(res.status).toBe(200);
    expect(res.body.map((c) => c.date).sort()).toEqual([today(), tomorrow()]);

    // Replace with one drops the other; empty clears.
    res = await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: [tomorrow()] });
    expect(res.body).toHaveLength(1);
    res = await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: [] });
    expect(res.body).toEqual([]);

    // Validation: bad date + duplicate.
    res = await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: ['not-a-date'] });
    expect(res.status).toBe(400);
    res = await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: [tomorrow(), tomorrow()] });
    expect(res.status).toBe(400);

    // Weekday closures (0=Sun … 6=Sat): replace-all + validation.
    res = await request(app)
      .put(`/api/tenants/${tenant.id}/weekday-closures`)
      .set(auth(ownerToken))
      .send({ weekdays: [1, 5] }); // Mondays + Saturdays
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.weekday).sort()).toEqual([1, 5]);

    res = await request(app).get(`/api/tenants/${tenant.id}/weekday-closures`).set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.weekday).sort()).toEqual([1, 5]);

    res = await request(app)
      .put(`/api/tenants/${tenant.id}/weekday-closures`)
      .set(auth(ownerToken))
      .send({ weekdays: [9] });
    expect(res.status).toBe(400);

    // Clear both so later tests start from a clean slate.
    await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: [] });
    await request(app)
      .put(`/api/tenants/${tenant.id}/weekday-closures`)
      .set(auth(ownerToken))
      .send({ weekdays: [] });
  });

  it('a restaurant-wide closure date darkens the menu and rejects checkout', async () => {
    const p = await createProduct({ name: 'Closure-Day Dish' });
    await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: [today()] });

    // Menu: closedToday flag + the item is filtered out entirely.
    const pub = await request(app).get('/api/public/restaurants/p4-diner/menu');
    expect(pub.body.closedToday).toBe(true);
    expect(pub.body.categories.flatMap((c) => c.items).find((i) => i.id === p.id)).toBeUndefined();

    // Immediate checkout is rejected while closed.
    const attempt = await request(app)
      .post('/api/public/restaurants/p4-diner/checkout')
      .send({
        order_type: 'pickup',
        customer_name: 'Buyer',
        customer_phone: '+8801711111111',
        items: [{ product_id: p.id, quantity: 1 }],
      });
    expect(attempt.status).toBe(400);
    expect(attempt.body.error.code).toBe('AVAILABILITY_WINDOW');

    // A scheduled order for the closure date is rejected even though it is
    // placed while the closure is in effect for a different day (tomorrow).
    await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: [tomorrow()] });
    const scheduled = await request(app)
      .post('/api/public/restaurants/p4-diner/checkout')
      .send({
        order_type: 'scheduled_pickup',
        scheduled_at: new Date(`${tomorrow()}T12:00:00`).toISOString(),
        customer_name: 'Buyer',
        customer_phone: '+8801711111111',
        items: [{ product_id: p.id, quantity: 1 }],
      });
    expect(scheduled.status).toBe(400);
    expect(scheduled.body.error.code).toBe('AVAILABILITY_WINDOW');

    await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: [] });
  });

  it('a restaurant-wide weekday closure hides everything on that weekday', async () => {
    const p = await createProduct({ name: 'Weekday-Closure Dish' });
    await request(app)
      .put(`/api/tenants/${tenant.id}/weekday-closures`)
      .set(auth(ownerToken))
      .send({ weekdays: [monNoon.getDay()] }); // the weekday of the check date

    const ctx = await buildAvailabilityContext(tenant.id, monNoon);
    expect(ctx.restaurantWeekdayClosed).toBe(true);
    expect(isAvailableAt({ id: p.id, enabled: true }, ctx)).toBe(false);

    // The public menu flags closedToday for that weekday (server clock is
    // 'now', so this only asserts the resolution helper — the menu payload
    // itself uses the real today).
    const ctxNow = await buildAvailabilityContext(tenant.id);
    expect(ctxNow.restaurantWeekdayClosed).toBe(
      ctxNow.weekday === monNoon.getDay()
    );

    await request(app)
      .put(`/api/tenants/${tenant.id}/weekday-closures`)
      .set(auth(ownerToken))
      .send({ weekdays: [] });
  });

  it('per-item weekday rules replace the base window and can close a weekday', async () => {
    const p = await createProduct({ name: 'Weekday-Rule Dish' });

    // PUT: closed Mondays + weekend-only hours.
    let res = await request(app)
      .put(`/api/products/${p.id}/weekday-rules`)
      .set(auth(ownerToken))
      .send({
        rules: [
          { weekday: 1, available_from: null, available_to: null },
          { weekday: 6, available_from: '10:00', available_to: '18:00' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    // GET lists them weekday-ascending.
    res = await request(app).get(`/api/products/${p.id}/weekday-rules`).set(auth(ownerToken));
    expect(res.body.map((r) => r.weekday)).toEqual([1, 6]);

    // Validation: bad weekday, duplicate, malformed time.
    res = await request(app)
      .put(`/api/products/${p.id}/weekday-rules`)
      .set(auth(ownerToken))
      .send({ rules: [{ weekday: 7 }] });
    expect(res.status).toBe(400);
    res = await request(app)
      .put(`/api/products/${p.id}/weekday-rules`)
      .set(auth(ownerToken))
      .send({ rules: [{ weekday: 1 }, { weekday: 1 }] });
    expect(res.status).toBe(400);
    res = await request(app)
      .put(`/api/products/${p.id}/weekday-rules`)
      .set(auth(ownerToken))
      .send({ rules: [{ weekday: 1, available_from: '9am' }] });
    expect(res.status).toBe(400);

    // Resolution: closed on Monday (weekday 1), weekend window applies.
    // `p` is the createProduct JSON response (a plain object), so it is
    // spread directly — no toJSON needed.
    const monday = new Date('2026-08-17T12:00:00'); // a Monday
    const saturday = new Date('2026-08-22T12:00:00'); // a Saturday
    const ctxMon = await buildAvailabilityContext(tenant.id, monday);
    expect(isAvailableAt({ ...p, enabled: true }, ctxMon)).toBe(false);
    const ctxSat = await buildAvailabilityContext(tenant.id, saturday);
    expect(isAvailableAt({ ...p, enabled: true }, ctxSat)).toBe(true);
    // Outside the Saturday window.
    const ctxSatLate = await buildAvailabilityContext(tenant.id, new Date('2026-08-22T20:00:00'));
    expect(isAvailableAt({ ...p, enabled: true }, ctxSatLate)).toBe(false);
    // A weekday without a rule falls back to the base window (all-day here).
    const ctxTue = await buildAvailabilityContext(tenant.id, new Date('2026-08-18T12:00:00'));
    expect(isAvailableAt({ ...p, enabled: true }, ctxTue)).toBe(true);

    // Clearing the rules restores the base schedule.
    res = await request(app)
      .put(`/api/products/${p.id}/weekday-rules`)
      .set(auth(ownerToken))
      .send({ rules: [] });
    expect(res.body).toEqual([]);
    const ctxMonAfter = await buildAvailabilityContext(tenant.id, monday);
    expect(isAvailableAt({ ...p, enabled: true }, ctxMonAfter)).toBe(true);
  });

  it('the public availability endpoint previews per-item availability with reasons', async () => {
    const p = await createProduct({ name: 'Availability Preview Dish' });

    // Base item: all-day → open at the requested instant.
    let res = await request(app).get(
      `/api/public/restaurants/p4-diner/availability?date=${MON}&time=12:00`
    );
    expect(res.status).toBe(200);
    expect(res.body.date).toBe(MON);
    expect(res.body.restaurantClosed).toBe(false);
    const item = res.body.items.find((i) => i.id === p.id);
    expect(item.available).toBe(true);
    expect(item.reason).toBe('open');

    // A Monday closure for the item → reason 'weekday_closed'.
    await request(app)
      .put(`/api/products/${p.id}/weekday-rules`)
      .set(auth(ownerToken))
      .send({ rules: [{ weekday: 1, available_from: null, available_to: null }] });
    res = await request(app).get(
      `/api/public/restaurants/p4-diner/availability?date=${MON}&time=12:00`
    );
    expect(res.body.items.find((i) => i.id === p.id).reason).toBe('weekday_closed');
    expect(res.body.items.find((i) => i.id === p.id).available).toBe(false);

    // Restaurant-wide closure date → restaurantClosed + all items unavailable.
    await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: [MON] });
    res = await request(app).get(
      `/api/public/restaurants/p4-diner/availability?date=${MON}&time=12:00`
    );
    expect(res.body.restaurantClosed).toBe(true);
    expect(res.body.items.every((i) => i.available === false)).toBe(true);
    expect(res.body.items.find((i) => i.id === p.id).reason).toBe('restaurant_closed');

    // Validation: bad date / time.
    res = await request(app).get('/api/public/restaurants/p4-diner/availability?date=bad');
    expect(res.status).toBe(400);
    res = await request(app).get(
      `/api/public/restaurants/p4-diner/availability?date=${MON}&time=25:00`
    );
    expect(res.status).toBe(400);

    // Clean up so other suites are unaffected.
    await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: [] });
    await request(app)
      .put(`/api/products/${p.id}/weekday-rules`)
      .set(auth(ownerToken))
      .send({ rules: [] });
  });

  it('reports closure conflicts: windowed overrides/rules on closed days', async () => {
    const p = await createProduct({ name: 'Conflict Dish' });
    const later = dateKey(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));

    // Closure date + a WINDOWED override on it → conflict.
    await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: [later] });
    await request(app)
      .put(`/api/products/${p.id}/overrides`)
      .set(auth(ownerToken))
      .send({ overrides: [{ date: later, available_from: '10:00', available_to: '18:00' }] });

    let res = await request(app)
      .get(`/api/tenants/${tenant.id}/closure-conflicts`)
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    const dateConflict = res.body.dates.find((d) => d.date === later);
    expect(dateConflict).toBeDefined();
    expect(dateConflict.conflicts[0].itemId).toBe(p.id);
    expect(dateConflict.conflicts[0].availableFrom).toBe('10:00');

    // A closed override (both bounds NULL) is consistent → no conflict.
    await request(app)
      .put(`/api/products/${p.id}/overrides`)
      .set(auth(ownerToken))
      .send({ overrides: [{ date: later, available_from: null, available_to: null }] });
    res = await request(app)
      .get(`/api/tenants/${tenant.id}/closure-conflicts`)
      .set(auth(ownerToken));
    expect(res.body.dates.find((d) => d.date === later)?.conflicts ?? []).toEqual([]);
    await request(app)
      .put(`/api/products/${p.id}/overrides`)
      .set(auth(ownerToken))
      .send({ overrides: [] });
    await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: [] });

    // Weekday closure + a WINDOWED per-item rule on it → conflict.
    await request(app)
      .put(`/api/tenants/${tenant.id}/weekday-closures`)
      .set(auth(ownerToken))
      .send({ weekdays: [2] }); // Wednesdays
    await request(app)
      .put(`/api/products/${p.id}/weekday-rules`)
      .set(auth(ownerToken))
      .send({ rules: [{ weekday: 2, available_from: '12:00', available_to: '20:00' }] });
    res = await request(app)
      .get(`/api/tenants/${tenant.id}/closure-conflicts`)
      .set(auth(ownerToken));
    const weekdayConflict = res.body.weekdays.find((w) => w.weekday === 2);
    expect(weekdayConflict).toBeDefined();
    expect(weekdayConflict.conflicts[0].itemId).toBe(p.id);

    await request(app)
      .put(`/api/products/${p.id}/weekday-rules`)
      .set(auth(ownerToken))
      .send({ rules: [] });
    await request(app)
      .put(`/api/tenants/${tenant.id}/weekday-closures`)
      .set(auth(ownerToken))
      .send({ weekdays: [] });
  });

  it('computes nextOpenAt: skips closed days, returns the earliest opening', async () => {
    const later = dateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
    await createProduct({ name: 'Next-Open Dish', available_from: '11:00', available_to: '22:00' });

    // Closed today → next open is tomorrow (the earliest item opening across
    // the shared suite DB — all-day items start at 00:00, the 11:00 window
    // included, so only the DAY is asserted).
    await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: [dateKey()] });
    const nextOpen = await computeNextOpenAt(tenant.id);
    expect(nextOpen).not.toBeNull();
    const d = new Date(nextOpen);
    expect(d.getDate()).toBe(new Date(later + 'T00:00:00').getDate());

    // Tomorrow closed too → the day after.
    const dayAfter = dateKey(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));
    await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: [dateKey(), later] });
    const nextOpen2 = new Date(await computeNextOpenAt(tenant.id));
    expect(nextOpen2.getDate()).toBe(new Date(dayAfter + 'T00:00:00').getDate());

    // Restaurant open now → returns now.
    await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: [] });
    const open = await computeNextOpenAt(tenant.id);
    expect(Math.abs(new Date(open).getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('the availability endpoint answers windows mode (date-only) vs instant mode', async () => {
    const p = await createProduct({ name: 'Windows Dish', available_from: '09:00', available_to: '18:00' });

    // Windows mode: date-only → per-item open segments.
    let res = await request(app).get(
      `/api/public/restaurants/p4-diner/availability?date=${MON}`
    );
    expect(res.status).toBe(200);
    const item = res.body.items.find((i) => i.id === p.id);
    expect(item.windows).toEqual([{ from: '09:00', to: '18:00' }]);
    expect(item.available).toBeUndefined(); // no instant check in windows mode

    // All-day item → [{00:00,24:00}]; overnight → two segments.
    const allDay = await createProduct({ name: 'Windows All-Day' });
    res = await request(app).get(`/api/public/restaurants/p4-diner/availability?date=${MON}`);
    expect(res.body.items.find((i) => i.id === allDay.id).windows).toEqual([
      { from: '00:00', to: '24:00' },
    ]);

    const overnight = await createProduct({ name: 'Windows Overnight', available_from: '22:00', available_to: '04:00' });
    res = await request(app).get(`/api/public/restaurants/p4-diner/availability?date=${MON}`);
    expect(res.body.items.find((i) => i.id === overnight.id).windows).toEqual([
      { from: '22:00', to: '24:00' },
      { from: '00:00', to: '04:00' },
    ]);

    // Restaurant closed that day → every item's windows empty.
    await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: [MON] });
    res = await request(app).get(`/api/public/restaurants/p4-diner/availability?date=${MON}`);
    expect(res.body.restaurantClosed).toBe(true);
    expect(res.body.items.every((i) => i.windows.length === 0)).toBe(true);
    await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: [] });

    // Instant mode (with time) still returns available + reason.
    res = await request(app).get(
      `/api/public/restaurants/p4-diner/availability?date=${MON}&time=12:00`
    );
    const instant = res.body.items.find((i) => i.id === p.id);
    expect(instant.available).toBe(true);
    expect(instant.reason).toBe('open');
    expect(instant.windows).toBeUndefined();
  });

  it('the public menu payload carries nextOpenAt while closed', async () => {
    const pub = await request(app).get('/api/public/restaurants/p4-diner/menu');
    expect(pub.body.closedToday).toBe(false);
    expect(pub.body.nextOpenAt).toBeNull();

    await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: [dateKey()] });
    const closed = await request(app).get('/api/public/restaurants/p4-diner/menu');
    expect(closed.body.closedToday).toBe(true);
    expect(typeof closed.body.nextOpenAt).toBe('string');

    await request(app)
      .put(`/api/tenants/${tenant.id}/closures`)
      .set(auth(ownerToken))
      .send({ dates: [] });
  });
});
