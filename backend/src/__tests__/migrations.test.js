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
    expect(status).toHaveLength(6);
  });

  it('rolls back only the most recent migration, then re-applies', async () => {
    // Down: 006 drops the QR table-menu `tables` table and its record.
    expect(await migrateDown(sequelize)).toBe(1);
    const qi = sequelize.getQueryInterface();
    expect(await qi.tableExists('tables')).toBe(false);

    // Re-applying restores it.
    expect(await migrateUp(sequelize)).toBe(1);
    expect(await qi.tableExists('tables')).toBe(true);
    const columns = await qi.describeTable('tables');
    expect(columns).toHaveProperty('table_no');
    expect(columns).toHaveProperty('tenant_id');
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
