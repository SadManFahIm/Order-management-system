import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant, Product, MenuCategory, ItemVariant, ItemAddon, Table } from '../models/index.js';

/**
 * Public storefront menu API suite (Phase 4).
 * Read-only, no authentication, whitelist-only serialisation. Verifies that
 * suspended/archived tenants 404 and that no internal fields leak.
 */

let tenantA;
let tenantB;
let tenantWallet;
let categoryBurgers;
let categoryDrinks;
let itemAvailable;

beforeAll(async () => {
  await resetTestDb();

  tenantA = await Tenant.create({ name: 'Public Cafe A', slug: 'public-a' });
  tenantB = await Tenant.create({ name: 'Public Cafe B', slug: 'public-b' });
  await Tenant.create({ name: 'Hidden Cafe', slug: 'hidden-cafe', status: 'suspended' });
  // Wallet receiving numbers (Phase 6 UX): a tenant with bKash + Nagad
  // enabled and numbered — the public API must expose these (customers need
  // them to pay), but never any gateway/internal settings.
  tenantWallet = await Tenant.create({
    name: 'Wallet Cafe',
    slug: 'wallet-cafe',
    settings: {
      paymentMethods: {
        cash: { enabled: true },
        bkash: { enabled: true, number: '01711112222' },
        nagad: { enabled: true, number: '01733334444' },
      },
      internalNote: 'do-not-leak-this',
    },
  });

  categoryBurgers = await MenuCategory.create({ tenant_id: tenantA.id, name: 'Burgers', sort_order: 1 });
  categoryDrinks = await MenuCategory.create({ tenant_id: tenantA.id, name: 'Drinks', sort_order: 2 });

  itemAvailable = await Product.create({
    tenant_id: tenantA.id,
    name: 'Beef Burger',
    price: 220,
    weight_gm: 300,
    enabled: true,
    category_id: categoryBurgers.id,
    prep_minutes: 10,
    image_url: 'https://cdn.example.com/burger.webp',
    description: 'Juicy beef patty',
  });
  await Product.create({
    tenant_id: tenantA.id,
    name: 'Secret Burger',
    price: 999,
    weight_gm: 400,
    enabled: false,
    category_id: categoryBurgers.id,
  });
  await Product.create({
    tenant_id: tenantA.id,
    name: 'Cold Drink',
    price: 50,
    weight_gm: 250,
    enabled: true,
    category_id: categoryDrinks.id,
  });
  // A product with no category — should appear under "Other".
  await Product.create({
    tenant_id: tenantA.id,
    name: 'Uncategorised Snack',
    price: 80,
    weight_gm: 100,
    enabled: true,
  });

  await ItemVariant.create({ tenant_id: tenantA.id, product_id: itemAvailable.id, name: 'Large', price_adjustment: 50, sort_order: 1 });
  await ItemAddon.create({ tenant_id: tenantA.id, product_id: itemAvailable.id, name: 'Extra Cheese', price: 30, sort_order: 1 });

  // QR table menu (Phase 5 starter): public tables listing.
  await Table.create({ tenant_id: tenantA.id, table_no: 1, name: 'Window 1', capacity: 2 });
  await Table.create({ tenant_id: tenantA.id, table_no: 2, name: 'Family', capacity: 6, is_active: false });
  await Table.create({ tenant_id: tenantB.id, table_no: 1, name: 'Beta Secret', capacity: 4 });

  // A member user to prove public routes ignore auth entirely.
  const owner = await User.create({
    name: 'Pub Owner',
    email: 'pubowner@example.com',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenantA.id, role: 'owner' });
});

afterAll(async () => {
  await sequelize.close();
});

describe('GET /api/public/restaurants/:slug', () => {
  it('returns a public restaurant summary', async () => {
    const res = await request(app).get('/api/public/restaurants/public-a');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: tenantA.id,
      name: 'Public Cafe A',
      slug: 'public-a',
      logoUrl: null,
      status: 'active',
      brand: null,
      // Checkout config (Phase 5) — additive, public-safe: only the enabled
      // method list + wallet numbers + delivery availability/fee.
      checkout: {
        paymentMethods: ['cash'],
        walletNumbers: {},
        deliveryEnabled: true,
        deliveryFee: 0,
      },
    });
    // No actual phone number leaks (the empty walletNumbers key is fine).
    expect(JSON.stringify(res.body)).not.toContain('017');
    expect(JSON.stringify(res.body)).not.toContain('settings');
  });

  it('exposes only the enabled wallet receiving numbers (never internal settings)', async () => {
    const res = await request(app).get('/api/public/restaurants/wallet-cafe');
    expect(res.status).toBe(200);
    expect(res.body.checkout.paymentMethods).toEqual(['cash', 'bkash', 'nagad']);
    expect(res.body.checkout.walletNumbers).toEqual({
      bkash: '01711112222',
      nagad: '01733334444',
    });
    const serialized = JSON.stringify(res.body);
    // Internal-only settings never leave, even though numbers are public.
    expect(serialized).not.toContain('internalNote');
    expect(serialized).not.toContain('do-not-leak-this');
  });

  it('exposes only the public-safe brand whitelist when a brand is set', async () => {
    await tenantA.update({
      settings: {
        description: 'internal note that must never leak',
        brand: {
          primaryColor: '#e4002b',
          accentColor: '#ffd400',
          tagline: 'Taste the fire',
          heroImage: 'https://cdn.example.com/hero.jpg',
          // sensitive extras stored with the brand must NOT surface
          ownerPhone: '+8801XXXXXXXXX',
        },
      },
    });

    const res = await request(app).get('/api/public/restaurants/public-a');
    expect(res.status).toBe(200);
    expect(res.body.brand).toEqual({
      primaryColor: '#e4002b',
      accentColor: '#ffd400',
      tagline: 'Taste the fire',
    });
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('heroImage');
    expect(json).not.toContain('ownerPhone');
    expect(json).not.toContain('description');
    expect(json).not.toContain('settings');
  });

  it('404s for unknown slugs', async () => {
    const res = await request(app).get('/api/public/restaurants/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('404s for suspended tenants (never reveals hidden workspaces)', async () => {
    const res = await request(app).get('/api/public/restaurants/hidden-cafe');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/public/restaurants/:slug/menu', () => {
  it('returns categories with only enabled items and whitelisted fields', async () => {
    const res = await request(app).get('/api/public/restaurants/public-a/menu');
    expect(res.status).toBe(200);

    const { restaurant, categories } = res.body;
    expect(restaurant.slug).toBe('public-a');

    const burgers = categories.find((c) => c.name === 'Burgers');
    expect(burgers).toBeDefined();
    expect(burgers.items.map((i) => i.name)).toEqual(['Beef Burger']);
    // Hidden item never appears.
    expect(burgers.items.some((i) => i.name === 'Secret Burger')).toBe(false);

    const burger = burgers.items[0];
    expect(burger).toMatchObject({
      id: itemAvailable.id,
      name: 'Beef Burger',
      price: 220,
      weightGm: 300,
      prepMinutes: 10,
      imageUrl: 'https://cdn.example.com/burger.webp',
      available: true,
    });
    expect(burger.variants).toHaveLength(1);
    expect(burger.variants[0].name).toBe('Large');
    expect(burger.addons).toHaveLength(1);
    expect(burger.addons[0].name).toBe('Extra Cheese');

    // Uncategorised items surface under "Other".
    const other = categories.find((c) => c.name === 'Other');
    expect(other.items.map((i) => i.name)).toContain('Uncategorised Snack');
  });

  it('does not expose internal or sensitive fields', async () => {
    const res = await request(app).get('/api/public/restaurants/public-a/menu');
    const burger = res.body.categories.find((c) => c.name === 'Burgers').items[0];
    const itemJson = JSON.stringify(burger);
    // Whitelist only: no tenant_id, no settings, no user data, no hashes.
    expect(itemJson).not.toContain('tenant_id');
    expect(itemJson).not.toContain('password');
    expect(itemJson).not.toContain('settings');
    expect(itemJson).not.toContain('plan_id');
    expect(itemJson).not.toContain('email');
    expect(res.body.categories[0]).not.toHaveProperty('tenant_id');
  });

  it('supports categoryId filtering', async () => {
    const res = await request(app)
      .get(`/api/public/restaurants/public-a/menu?categoryId=${categoryDrinks.id}`);
    const names = res.body.categories
      .flatMap((c) => c.items.map((i) => i.name));
    expect(names).toEqual(['Cold Drink']);
  });

  it('available=false returns hidden items too', async () => {
    const res = await request(app).get('/api/public/restaurants/public-a/menu?available=false');
    const allItems = res.body.categories.flatMap((c) => c.items);
    expect(allItems.some((i) => i.name === 'Secret Burger')).toBe(true);
  });

  it('requires no authentication (public)', async () => {
    // No Authorization header at all — and it must still work.
    const res = await request(app).get('/api/public/restaurants/public-a/menu');
    expect(res.status).toBe(200);
  });

  it('sets public caching headers (Cache-Control + ETag)', async () => {
    const res = await request(app).get('/api/public/restaurants/public-a/menu');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/public, max-age=\d+/);
    expect(res.headers.etag).toMatch(/^"[a-f0-9]{16}"$/);

    // The restaurant summary endpoint caches too.
    const summary = await request(app).get('/api/public/restaurants/public-a');
    expect(summary.headers['cache-control']).toMatch(/public, max-age=\d+/);
    expect(summary.headers.etag).toBeTruthy();
  });

  it('answers 304 Not Modified when the client sends a fresh If-None-Match', async () => {
    const first = await request(app).get('/api/public/restaurants/public-a/menu');
    const etag = first.headers.etag;
    expect(etag).toBeTruthy();

    const cached = await request(app)
      .get('/api/public/restaurants/public-a/menu')
      .set('If-None-Match', etag);
    expect(cached.status).toBe(304);
    expect(cached.body).toEqual({});
  });

  it('the ETag changes when menu content changes', async () => {
    const before = await request(app).get('/api/public/restaurants/public-a/menu');
    await Product.create({
      tenant_id: tenantA.id,
      name: 'Cache Buster',
      price: 1,
      weight_gm: 1,
      enabled: true,
      category_id: categoryBurgers.id,
    });
    const after = await request(app).get('/api/public/restaurants/public-a/menu');
    expect(after.headers.etag).not.toBe(before.headers.etag);
  });

  it('404s for unknown or non-public tenants', async () => {
    const missing = await request(app).get('/api/public/restaurants/nope/menu');
    expect(missing.status).toBe(404);

    const hidden = await request(app).get('/api/public/restaurants/hidden-cafe/menu');
    expect(hidden.status).toBe(404);
  });

  it('never returns other tenants items', async () => {
    await Product.create({ tenant_id: tenantB.id, name: 'Beta Secret', price: 1, weight_gm: 1, enabled: true });
    const res = await request(app).get('/api/public/restaurants/public-a/menu');
    const allItems = res.body.categories.flatMap((c) => c.items);
    expect(allItems.some((i) => i.name === 'Beta Secret')).toBe(false);
  });

  it('paginates items with limit/offset and X-Total-Count', async () => {
    // 4 enabled items exist for tenant A at this point (Beef Burger, Cold
    // Drink, Uncategorised Snack, Cache Buster) — page through 2 at a time.
    const page1 = await request(app).get('/api/public/restaurants/public-a/menu?limit=2&offset=0');
    expect(page1.status).toBe(200);
    expect(Number(page1.headers['x-total-count'])).toBeGreaterThanOrEqual(4);
    const page1Items = page1.body.categories.flatMap((c) => c.items);
    expect(page1Items).toHaveLength(2);

    const page2 = await request(app).get('/api/public/restaurants/public-a/menu?limit=2&offset=2');
    const page2Items = page2.body.categories.flatMap((c) => c.items);
    expect(page2Items).toHaveLength(2);
    // Pages never overlap (stable ordering by id ASC).
    const page1Ids = new Set(page1Items.map((i) => i.id));
    expect(page2Items.some((i) => page1Ids.has(i.id))).toBe(false);

    // Offset beyond the end yields no items but the true total.
    const beyond = await request(app).get('/api/public/restaurants/public-a/menu?limit=2&offset=999');
    expect(beyond.body.categories.flatMap((c) => c.items)).toHaveLength(0);
    expect(Number(beyond.headers['x-total-count'])).toBeGreaterThanOrEqual(4);
  });

  it('respects the category filter while paginating', async () => {
    const res = await request(app)
      .get(`/api/public/restaurants/public-a/menu?categoryId=${categoryDrinks.id}&limit=5`);
    expect(Number(res.headers['x-total-count'])).toBe(1);
    expect(res.body.categories.flatMap((c) => c.items).map((i) => i.name)).toEqual(['Cold Drink']);
  });
});

describe('GET /api/public/restaurants/:slug/tables (QR menu)', () => {
  it('returns only active tables with storefront-safe fields', async () => {
    const res = await request(app).get('/api/public/restaurants/public-a/tables');
    expect(res.status).toBe(200);
    expect(res.body.tables).toEqual([{ tableNo: 1, name: 'Window 1', capacity: 2 }]);
  });

  it('never leaks another tenant tables or internal columns', async () => {
    const res = await request(app).get('/api/public/restaurants/public-a/tables');
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('Beta Secret');
    expect(json).not.toContain('tenant_id');
    expect(json).not.toContain('is_active');
    expect(json).not.toContain('settings');
  });

  it('404s for hidden workspaces and caches like the menu', async () => {
    const hidden = await request(app).get('/api/public/restaurants/hidden-cafe/tables');
    expect(hidden.status).toBe(404);

    const res = await request(app).get('/api/public/restaurants/public-a/tables');
    expect(res.headers['cache-control']).toMatch(/public, max-age=\d+/);
  });
});

describe('GET /api/public/restaurants/:slug/qr (print coupon)', () => {
  it('returns the storefront URL + a scannable SVG data URI', async () => {
    const res = await request(app).get('/api/public/restaurants/public-a/qr');
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('/m/public-a');
    expect(res.body.svg).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(res.body.svg).toContain('data:image');
  });

  it('embeds the table number when asked', async () => {
    const res = await request(app).get('/api/public/restaurants/public-a/qr?table=3');
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('?table=3');
    expect(res.body.table).toBe(3);
  });

  it('ignores invalid tables and 404s hidden workspaces', async () => {
    const bad = await request(app).get('/api/public/restaurants/public-a/qr?table=abc');
    expect(bad.status).toBe(200);
    expect(bad.body.url).not.toContain('?table=');
    expect(bad.body.table).toBeNull();

    const hidden = await request(app).get('/api/public/restaurants/hidden-cafe/qr');
    expect(hidden.status).toBe(404);
  });
});
