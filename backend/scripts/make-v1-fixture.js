import { Sequelize } from 'sequelize';

/**
 * Creates a small, deterministic v1 SQLite database (fixture-v1.sqlite) with
 * legacy model-shaped tables. Used by CI to exercise the v1 → v2 data
 * migration against the real PostgreSQL service:
 *
 *   node scripts/make-v1-fixture.js
 *   node scripts/migrate-v1-to-v2.js --source ./fixture-v1.sqlite --force
 */
const OUT = './fixture-v1.sqlite';

const s = new Sequelize({ dialect: 'sqlite', storage: OUT, logging: false });

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
  VALUES (1, 'CI Admin', 'ci-admin@fixture.dev', '$2a$10$c1adminhashplaceholder000000000000000000000000000000000000000', 'platform_admin'),
         (2, 'CI Member', 'ci-member@fixture.dev', '$2a$10$c1memberhashplaceholder000000000000000000000000000000000000000', 'member')`);
await s.query(`INSERT INTO Products (id, tenant_id, name, description, price, weight_gm, enabled)
  VALUES (1, 1, 'Burger', 'Beef burger', 12.345, 250, 1),
         (2, 1, 'Pizza', '', 40.0, 400, 0),
         (3, 2, 'Fries', NULL, 5.5, 150, 1)`);
await s.query(`INSERT INTO Promotions (id, tenant_id, title, type, percentage_value, fixed_value, start_date, end_date, enabled)
  VALUES (1, 1, 'Summer 10%', 'percentage', 10.0, NULL, '2026-01-01', '2026-02-01', 1),
         (2, 1, 'Fixed 50', 'fixed', NULL, 50.0, '2026-03-01', '2026-04-01', 0)`);
await s.query(`INSERT INTO PromotionSlabs (id, promotion_id, min_weight_gm, max_weight_gm, discount_per_500gm)
  VALUES (1, 1, 1000, 2000, 15.0), (2, 2, 500, 1000, 8.55)`);
await s.query(`INSERT INTO Orders (id, tenant_id, customer_name, customer_phone, customer_address, subtotal, total_discount, grand_total)
  VALUES (1, 1, 'Karim', '01711111111', 'Mirpur', 100.0, 10.0, 90.0),
         (2, 1, 'Rahim', '01722222222', 'Dhanmondi', 50.0, 0.0, 50.0)`);
await s.query(`INSERT INTO OrderItems (id, order_id, product_id, tenant_id, quantity, unit_price, discount, line_total)
  VALUES (1, 1, 1, 1, 2, 30.0, 0.0, 60.0),
         (2, 1, 2, 1, 1, 40.0, 10.0, 30.0),
         (3, 2, 3, 1, 1, 50.0, 0.0, 50.0)`);

await s.close();
console.log(`fixture written to ${OUT} (2 users, 3 products, 2 orders)`);
