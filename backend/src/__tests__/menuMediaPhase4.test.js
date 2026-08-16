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
import { isAvailableNow, normalizeTags, ITEM_TAGS } from '../services/menuService.js';
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
