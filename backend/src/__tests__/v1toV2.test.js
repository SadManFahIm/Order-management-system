import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Sequelize } from 'sequelize';

/**
 * v1 → v2 data migration tests (schema doc §8).
 *
 * Builds a fixture v1 SQLite database (legacy model tables), migrates a scratch
 * target, then runs the copy and asserts the full mapping: users/password_hash,
 * admin membership, "General" category, DECIMAL rounding, promotions/slabs
 * remap, orders status/payment mapping, order-item snapshot + remap, and the
 * money + FK verification.
 */

const SOURCE_DB = './data.v1toV2-source.sqlite';
const TARGET_DB = './data.v1toV2-target.sqlite';

process.env.DB_STORAGE = TARGET_DB;
process.env.DB_DIALECT = 'sqlite';

const { runV1ToV2Migration, verifyCopy } = await import('../../scripts/migrate-v1-to-v2.js');
const { migrateUp, sequelize } = await import('../../scripts/migrate.js');

/** Create the legacy v1 tables and seed deterministic rows. */
async function buildSourceV1() {
  const s = new Sequelize({ dialect: 'sqlite', storage: SOURCE_DB, logging: false });
  await s.query(`CREATE TABLE Users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, platform_role TEXT, email_verified_at DATETIME,
    two_factor_enabled INTEGER DEFAULT 0, two_factor_secret TEXT
  )`);
  await s.query(`CREATE TABLE Products (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, name TEXT, description TEXT,
    price REAL, weight_gm INTEGER, enabled INTEGER
  )`);
  await s.query(`CREATE TABLE Promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, title TEXT, type TEXT,
    percentage_value REAL, fixed_value REAL, start_date TEXT, end_date TEXT, enabled INTEGER
  )`);
  await s.query(`CREATE TABLE PromotionSlabs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, promotion_id INTEGER,
    min_weight_gm INTEGER, max_weight_gm INTEGER, discount_per_500gm REAL
  )`);
  await s.query(`CREATE TABLE Orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, customer_name TEXT,
    customer_phone TEXT, customer_address TEXT, subtotal REAL, total_discount REAL, grand_total REAL
  )`);
  await s.query(`CREATE TABLE OrderItems (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, product_id INTEGER, tenant_id INTEGER,
    quantity INTEGER, unit_price REAL, discount REAL, line_total REAL
  )`);

  await s.query(`INSERT INTO Users (id, name, email, password, platform_role)
    VALUES (1, 'Admin', 'admin@x.com', 'hash-admin', 'platform_admin'),
           (2, 'Member', 'm@x.com', 'hash-member', 'member')`);
  await s.query(`INSERT INTO Products (id, tenant_id, name, description, price, weight_gm, enabled)
    VALUES (1, 1, 'Burger', 'Beef burger', 12.345, 250, 1),
           (2, 1, 'Pizza', '', 40.0, 400, 0),
           (3, 2, 'Fries', NULL, 5.5, 150, 1)`);
  await s.query(`INSERT INTO Promotions (id, tenant_id, title, type, percentage_value, fixed_value, start_date, end_date, enabled)
    VALUES (1, 1, 'Summer 10%', 'percentage', 10.0, NULL, '2026-01-01', '2026-02-01', 1),
           (2, 1, 'Fixed 50', 'fixed', NULL, 50.0, '2026-03-01', '2026-04-01', 0)`);
  await s.query(`INSERT INTO PromotionSlabs (id, promotion_id, min_weight_gm, max_weight_gm, discount_per_500gm)
    VALUES (1, 1, 1000, 2000, 15.0), (2, 2, 500, 1000, 8.55)`);
  // Order 1: subtotal 100 (2×30 Burger + 1×40 Pizza), discount 10, total 90.
  await s.query(`INSERT INTO Orders (id, tenant_id, customer_name, customer_phone, customer_address, subtotal, total_discount, grand_total)
    VALUES (1, 1, 'Karim', '01711111111', 'Mirpur', 100.0, 10.0, 90.0),
           (2, 1, 'Rahim', '01722222222', 'Dhanmondi', 50.0, 0.0, 50.0)`);
  await s.query(`INSERT INTO OrderItems (id, order_id, product_id, tenant_id, quantity, unit_price, discount, line_total)
    VALUES (1, 1, 1, 1, 2, 30.0, 0.0, 60.0),
           (2, 1, 2, 1, 1, 40.0, 10.0, 30.0),
           (3, 2, 3, 1, 1, 50.0, 0.0, 50.0)`);
  await s.close();
}

describe('v1 → v2 data migration', () => {
  beforeAll(async () => {
    fs.rmSync(path.join(process.cwd(), SOURCE_DB), { force: true });
    fs.rmSync(path.join(process.cwd(), TARGET_DB), { force: true });
    await buildSourceV1();
    await migrateUp(sequelize);
    await runV1ToV2Migration({ sourcePath: SOURCE_DB, target: sequelize, force: true });
  });

  afterAll(async () => {
    await sequelize.close();
    fs.rmSync(path.join(process.cwd(), SOURCE_DB), { force: true });
    fs.rmSync(path.join(process.cwd(), TARGET_DB), { force: true });
  });

  it('creates the default tenant and maps users (password → password_hash)', async () => {
    const [users] = await sequelize.query('SELECT id, email, password_hash, platform_role FROM users ORDER BY id');
    expect(users).toHaveLength(2);
    expect(users[0]).toMatchObject({ email: 'admin@x.com', password_hash: 'hash-admin', platform_role: 'platform_admin' });
    expect(users[1]).toMatchObject({ email: 'm@x.com', password_hash: 'hash-member', platform_role: 'member' });

    const [[tenant]] = await sequelize.query("SELECT id, name, slug FROM tenants WHERE slug = 'default'");
    expect(tenant).toMatchObject({ name: 'Your Restaurant', slug: 'default' });

    const [memberships] = await sequelize.query('SELECT user_id, tenant_id, role FROM user_tenants');
    expect(memberships).toEqual([{ user_id: 1, tenant_id: 1, role: 'owner' }]); // admin only
  });

  it('maps products to menu_items under a General category with rounded DECIMAL money', async () => {
    const [categories] = await sequelize.query(
      "SELECT id, tenant_id, name FROM menu_categories WHERE name = 'General'"
    );
    expect(categories).toHaveLength(1);
    const categoryId = categories[0].id;

    const [items] = await sequelize.query('SELECT id, category_id, name, base_price, is_available FROM menu_items ORDER BY id');
    expect(items).toHaveLength(3);
    // 12.345 → 12.35 (defensive rounding), disabled → unavailable.
    expect(items[0]).toMatchObject({ id: 1, category_id: categoryId, name: 'Burger', base_price: 12.35, is_available: 1 });
    expect(items[1]).toMatchObject({ id: 2, name: 'Pizza', base_price: 40, is_available: 0 });
    expect(items[2]).toMatchObject({ id: 3, name: 'Fries', base_price: 5.5, is_available: 1 });
  });

  it('maps promotions and remaps promotion_slabs', async () => {
    const [promotions] = await sequelize.query('SELECT id, title, type, percentage_value, is_enabled FROM promotions ORDER BY id');
    expect(promotions).toHaveLength(2);
    expect(promotions[0]).toMatchObject({ title: 'Summer 10%', type: 'percentage', percentage_value: 10, is_enabled: 1 });
    expect(promotions[1]).toMatchObject({ title: 'Fixed 50', type: 'fixed', percentage_value: null, is_enabled: 0 });

    const [slabs] = await sequelize.query('SELECT id, promotion_id, discount_per_500gm FROM promotion_slabs ORDER BY id');
    expect(slabs).toEqual([
      { id: 1, promotion_id: 1, discount_per_500gm: 15 },
      { id: 2, promotion_id: 2, discount_per_500gm: 8.55 },
    ]);
  });

  it('maps orders to placed/unpaid with remapped items and name snapshots', async () => {
    const [orders] = await sequelize.query('SELECT id, order_no, status, type, payment_status, subtotal_amount, discount_amount, total_amount, notes FROM orders ORDER BY id');
    expect(orders).toHaveLength(2);
    expect(orders[0]).toMatchObject({
      id: 1, order_no: 'V1-00000001', status: 'placed', type: 'pickup', payment_status: 'unpaid',
      subtotal_amount: 100, discount_amount: 10, total_amount: 90,
      notes: 'Karim · 01711111111',
    });
    expect(orders[1]).toMatchObject({ order_no: 'V1-00000002', total_amount: 50 });

    const [items] = await sequelize.query('SELECT id, order_id, menu_item_id, item_name, quantity, unit_amount, line_amount FROM order_items ORDER BY id');
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ id: 1, order_id: 1, menu_item_id: 1, item_name: 'Burger', quantity: 2, unit_amount: 30, line_amount: 60 });
    expect(items[1]).toMatchObject({ order_id: 1, menu_item_id: 2, item_name: 'Pizza', unit_amount: 40, line_amount: 30 });
    expect(items[2]).toMatchObject({ order_id: 2, menu_item_id: 3, item_name: 'Fries', unit_amount: 50, line_amount: 50 });
  });

  it('passes verification (counts, money invariants, FK integrity)', async () => {
    const src = new Sequelize({ dialect: 'sqlite', storage: SOURCE_DB, logging: false });
    const issues = await verifyCopy(src, sequelize);
    await src.close();
    expect(issues).toEqual([]);
  });

  it('refuses to run over an already-populated target without --force', async () => {
    await expect(
      runV1ToV2Migration({ sourcePath: SOURCE_DB, target: sequelize })
    ).rejects.toThrow(/not empty/);
  });
});
