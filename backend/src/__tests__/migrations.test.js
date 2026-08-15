import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QueryTypes } from 'sequelize';

/**
 * Migration runner tests.
 *
 * The shared test DB (data.test.sqlite) is created via `sync()` by other
 * suites, so these tests run against a dedicated scratch file and point
 * DB_STORAGE at it before the config module loads (dynamic import below).
 */
const SCRATCH_DB = './data.migrations-test.sqlite';
process.env.DB_STORAGE = SCRATCH_DB;
process.env.DB_DIALECT = 'sqlite';

const { migrateUp, migrateDown, migrationStatus, listMigrationFiles, sequelize } =
  await import('../../scripts/migrate.js');

const EXPECTED_TABLES = [
  'users',
  'tenants',
  'user_tenants',
  'refresh_tokens',
  'auth_tokens',
  'login_attempts',
  'audit_logs',
  'plans',
  'subscriptions',
  'feature_flags',
  'usage_counters',
  'menu_categories',
  'menu_items',
  'item_variants',
  'item_addons',
  'allergens',
  'item_allergens',
  'inventory_items',
  'promotions',
  'promotion_slabs',
  'orders',
  'order_items',
  'tables',
  'payments',
  'daily_stats',
  'idempotency_keys',
  'order_split_items',
];

describe('migration runner', () => {
  beforeAll(async () => {
    await migrateUp(sequelize);
  });

  afterAll(async () => {
    await sequelize.close();
    fs.rmSync(path.join(process.cwd(), SCRATCH_DB), { force: true });
  });

  it('discovers versioned migration files in order', () => {
    expect(listMigrationFiles()).toEqual([
      '001_identity_auth.js',
      '002_tenancy_saas.js',
      '003_menu_catalog.js',
      '004_order_promotions.js',
      '005_v1_field_bridge.js',
      '006_tables.js',
      '007_order_table_no.js',
      '008_payments.js',
      '009_vat_and_digest.js',
      '010_split_refund_recon.js',
      '011_daily_stats.js',
      '012_delivery_realtime_idempotency.js',
      '013_split_billing.js',
      '014_customer_email.js',
      '015_hot_query_indexes.js',
    ]);
  });

  it('applies every migration and records them in schema_migrations', async () => {
    const applied = await sequelize.query('SELECT name FROM schema_migrations ORDER BY name', {
      type: QueryTypes.SELECT,
    });
    expect(applied.map((row) => row.name)).toEqual(
      listMigrationFiles().map((file) => file.replace(/\.js$/, ''))
    );
  });

  it('creates the full expected table set', async () => {
    const qi = sequelize.getQueryInterface();
    for (const table of EXPECTED_TABLES) {
      expect(await qi.tableExists(table), `table ${table} should exist`).toBe(true);
    }
  });

  it('adds tenants.plan_id via migration 002', async () => {
    const columns = await sequelize.getQueryInterface().describeTable('tenants');
    expect(columns).toHaveProperty('plan_id');
  });

  it('is a no-op when nothing is pending', async () => {
    expect(await migrateUp(sequelize)).toBe(0);
  });

  it('reports every migration as applied', async () => {
    const status = await migrationStatus(sequelize);
    expect(status.every((row) => row.state === 'applied')).toBe(true);
    expect(status).toHaveLength(15);
  });

  it('adds menu_items.vat_rate via migration 009', async () => {
    const columns = await sequelize.getQueryInterface().describeTable('menu_items');
    expect(columns).toHaveProperty('vat_rate');
    // Defaults to the BD food rate (5%), NOT NULL.
    // SQLite reports defaults as strings; PG as numbers.
    expect(Number(columns.vat_rate.defaultValue)).toBe(5);
    expect(columns.vat_rate.allowNull).toBe(false);
  });

  it('rolls back only the most recent migration, then re-applies', async () => {
    const qi = sequelize.getQueryInterface();

    // Down 015: removes the hot-query indexes (orders/payments by tenant + day).
    expect(await migrateDown(sequelize)).toBe(1);
    const orderIndexes = await qi.showIndex('orders', {});
    const paymentIndexes = await qi.showIndex('payments', {});
    expect(orderIndexes.some((i) => i.name === 'ix_orders_tenant_created_at')).toBe(false);
    expect(paymentIndexes.some((i) => i.name === 'ix_payments_tenant_created_at')).toBe(false);

    // Down 014: removes the optional customer_email column.
    expect(await migrateDown(sequelize)).toBe(1);
    expect((await qi.describeTable('orders')).customer_email).toBeUndefined();

    // Down 013: drops the split-billing table + payments.split columns.
    expect(await migrateDown(sequelize)).toBe(1);
    expect(await qi.tableExists('order_split_items')).toBe(false);
    expect((await qi.describeTable('payments')).split_method).toBeUndefined();

    // Down 012: removes reject fields + idempotency (delivery_fee/assigned_to
    // are v1-era migration-004 columns and survive — that is by design).
    expect(await migrateDown(sequelize)).toBe(1);
    expect(await qi.tableExists('idempotency_keys')).toBe(false);
    expect((await qi.describeTable('orders')).rejected_reason).toBeUndefined();
    expect((await qi.describeTable('orders')).delivery_fee).toBeDefined();
    expect((await qi.describeTable('orders')).assigned_to).toBeDefined();

    // Down 011: drops the analytics rollup table.
    expect(await migrateDown(sequelize)).toBe(1);
    expect(await qi.tableExists('daily_stats')).toBe(false);

    // Down 010: removes the split/refund/reconciliation columns on payments.
    expect(await migrateDown(sequelize)).toBe(1);
    expect((await qi.describeTable('payments')).refunded_amount).toBeUndefined();

    // Down 009: removes menu_items.vat_rate (VAT compliance).
    expect(await migrateDown(sequelize)).toBe(1);
    expect((await qi.describeTable('menu_items')).vat_rate).toBeUndefined();

    // Down 008: drops `payments` and removes orders.payment_method.
    expect(await migrateDown(sequelize)).toBe(1);
    expect(await qi.tableExists('payments')).toBe(false);
    expect((await qi.describeTable('orders')).payment_method).toBeUndefined();

    // Down 007: removes orders.table_no (table-aware orders).
    expect(await migrateDown(sequelize)).toBe(1);
    expect((await qi.describeTable('orders')).table_no).toBeUndefined();

    // Re-applying restores all nine rolled-back.
    expect(await migrateUp(sequelize)).toBe(9);
    expect(await qi.tableExists('order_split_items')).toBe(true);
    expect((await qi.describeTable('payments')).split_method).toBeDefined();
    expect((await qi.describeTable('menu_items')).vat_rate).toBeDefined();
    expect(await qi.tableExists('payments')).toBe(true);
    expect(await qi.tableExists('daily_stats')).toBe(true);
    expect(await qi.tableExists('idempotency_keys')).toBe(true);
    expect((await qi.describeTable('payments')).refunded_amount).toBeDefined();
    expect((await qi.describeTable('orders')).payment_method).toBeDefined();
    expect((await qi.describeTable('orders')).table_no).toBeDefined();
    expect((await qi.describeTable('orders')).rejected_reason).toBeDefined();
    expect((await qi.describeTable('orders')).customer_email).toBeDefined();
    const reorderIndexes = await qi.showIndex('orders', {});
    const repayIndexes = await qi.showIndex('payments', {});
    expect(reorderIndexes.some((i) => i.name === 'ix_orders_tenant_created_at')).toBe(true);
    expect(repayIndexes.some((i) => i.name === 'ix_payments_tenant_created_at')).toBe(true);
  });

  it('refuses to roll back a migration that is not the most recent', async () => {
    await expect(migrateDown(sequelize, '001_identity_auth')).rejects.toThrow(
      /only the most recent applied migration/
    );
  });

  it('rejects unknown migration names', async () => {
    await expect(migrateDown(sequelize, '999_nope')).rejects.toThrow(/Unknown migration/);
  });
});
