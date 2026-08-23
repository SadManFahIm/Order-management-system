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
  'tenant_invites',
  'tenant_saml_configs',
  'saml_sp_config',
  'availability_overrides',
  'tenant_closure_dates',
  'availability_weekday_rules',
  'order_edit_requests',
  'delivery_zones',
  'payment_refunds',
  'settlements',
  'analytics_events',
  'outlets',
  'outlet_memberships',
  'outlet_menu_overrides',
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
      '016_auth_hardening.js',
      '017_plan_quotas_invites.js',
      '018_tenant_saml_configs.js',
      '019_saml_slo_sp_config.js',
      '020_menu_media_enhancements.js',
      '021_variant_low_stock.js',
      '022_availability_overrides.js',
      '023_restaurant_closures_weekday_rules.js',
      '024_closure_labels.js',
      '025_ordering_fulfillment.js',
      '026_payments_upgrade.js',
      '027_analytics_phase7.js',
      '028_outlets.js',
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
    expect(status).toHaveLength(28);
  });

  it('adds menu_items.vat_rate via migration 009', async () => {
    const columns = await sequelize.getQueryInterface().describeTable('menu_items');
    expect(columns).toHaveProperty('vat_rate');
    // Defaults to the BD food rate (5%), NOT NULL.
    // SQLite reports defaults as strings; PG as numbers.
    expect(Number(columns.vat_rate.defaultValue)).toBe(5);
    expect(columns.vat_rate.allowNull).toBe(false);
  });

  it('rolls back only the most recent migration, then re-applies', { timeout: 30000 }, async () => {
    const qi = sequelize.getQueryInterface();

    // Down 028: drops outlet tables + all outlet_id FK columns (Phase 8 multi-outlet).
    expect(await migrateDown(sequelize)).toBe(1);
    expect(await qi.tableExists('outlets')).toBe(false);
    expect(await qi.tableExists('outlet_memberships')).toBe(false);
    expect(await qi.tableExists('outlet_menu_overrides')).toBe(false);
    expect((await qi.describeTable('orders')).outlet_id).toBeUndefined();

    // Down 027: drops analytics_events + the orders channel/session columns
    // (Phase 7 analytics).
    expect(await migrateDown(sequelize)).toBe(1);
    expect(await qi.tableExists('analytics_events')).toBe(false);
    expect((await qi.describeTable('orders')).channel).toBeUndefined();
    expect((await qi.describeTable('orders')).analytics_session).toBeUndefined();

    // Down 026: drops the payments-upgrade tables + columns (refund ledger,
    // settlements, tip amount, gateway verification).
    expect(await migrateDown(sequelize)).toBe(1);
    expect(await qi.tableExists('payment_refunds')).toBe(false);
    expect(await qi.tableExists('settlements')).toBe(false);
    expect((await qi.describeTable('orders')).tip_amount).toBeUndefined();
    expect((await qi.describeTable('payments')).gateway).toBeUndefined();
    expect((await qi.describeTable('payments')).verification_metadata).toBeUndefined();

    // Down 025: drops the ordering/fulfillment tables + columns (edit
    // requests, delivery zones, rider coverage, cancel reason, KDS timers).
    expect(await migrateDown(sequelize)).toBe(1);
    expect(await qi.tableExists('order_edit_requests')).toBe(false);
    expect(await qi.tableExists('delivery_zones')).toBe(false);
    expect((await qi.describeTable('orders')).cancel_reason).toBeUndefined();
    expect((await qi.describeTable('orders')).delivery_zone).toBeUndefined();
    expect((await qi.describeTable('orders')).prep_started_at).toBeUndefined();
    expect((await qi.describeTable('orders')).bumped_at).toBeUndefined();
    expect((await qi.describeTable('user_tenants')).delivery_zones).toBeUndefined();

    // Down 024: removes the closure label column (holiday names).
    expect(await migrateDown(sequelize)).toBe(1);
    expect((await qi.describeTable('tenant_closure_dates')).label).toBeUndefined();

    // Down 023: drops the closure/rule tables (restaurant-wide closures +
    // recurring weekday rules).
    expect(await migrateDown(sequelize)).toBe(1);
    expect(await qi.tableExists('tenant_closure_dates')).toBe(false);
    expect(await qi.tableExists('availability_weekday_rules')).toBe(false);

    // Down 022: drops the availability_overrides table (per-day overrides).
    expect(await migrateDown(sequelize)).toBe(1);
    expect(await qi.tableExists('availability_overrides')).toBe(false);

    // Down 021: removes the variant low-stock threshold column.
    expect(await migrateDown(sequelize)).toBe(1);
    expect((await qi.describeTable('item_variants')).low_stock_at).toBeUndefined();

    // Down 020: removes the menu/media columns (availability schedule,
    // tags, sort order, variant stock).
    expect(await migrateDown(sequelize)).toBe(1);
    expect((await qi.describeTable('menu_items')).available_from).toBeUndefined();
    expect((await qi.describeTable('menu_items')).available_to).toBeUndefined();
    expect((await qi.describeTable('menu_items')).tags).toBeUndefined();
    expect((await qi.describeTable('menu_items')).sort_order).toBeUndefined();
    expect((await qi.describeTable('item_variants')).stock).toBeUndefined();

    // Down 019: drops saml_sp_config + the idp_slo_url column.
    expect(await migrateDown(sequelize)).toBe(1);
    expect(await qi.tableExists('saml_sp_config')).toBe(false);
    expect((await qi.describeTable('tenant_saml_configs')).idp_slo_url).toBeUndefined();

    // Down 018: drops tenant_saml_configs.
    expect(await migrateDown(sequelize)).toBe(1);
    expect(await qi.tableExists('tenant_saml_configs')).toBe(false);

    // Down 017: drops tenant_invites + the plan quota columns.
    expect(await migrateDown(sequelize)).toBe(1);
    expect(await qi.tableExists('tenant_invites')).toBe(false);
    expect((await qi.describeTable('plans')).max_products).toBeUndefined();
    expect((await qi.describeTable('plans')).max_orders_per_day).toBeUndefined();
    expect((await qi.describeTable('plans')).max_members).toBeUndefined();
    expect((await qi.describeTable('plans')).storage_mb).toBeUndefined();

    // Down 016: removes the auth-hardening columns (lockout / force-change /
    // per-user permission flags).
    expect(await migrateDown(sequelize)).toBe(1);
    expect((await qi.describeTable('users')).failed_login_attempts).toBeUndefined();
    expect((await qi.describeTable('users')).locked_until).toBeUndefined();
    expect((await qi.describeTable('users')).must_change_password).toBeUndefined();
    expect((await qi.describeTable('user_tenants')).permissions).toBeUndefined();

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

    // Re-applying restores all twenty-two rolled-back (including 028–021).
    expect(await migrateUp(sequelize)).toBe(22);
    expect(await qi.tableExists('tenant_invites')).toBe(true);
    expect((await qi.describeTable('plans')).max_products).toBeDefined();
    expect((await qi.describeTable('plans')).storage_mb).toBeDefined();
    expect(await qi.tableExists('order_split_items')).toBe(true);
    expect((await qi.describeTable('payments')).split_method).toBeDefined();
    expect((await qi.describeTable('menu_items')).vat_rate).toBeDefined();
    expect(await qi.tableExists('payments')).toBe(true);
    expect(await qi.tableExists('daily_stats')).toBe(true);
    expect(await qi.tableExists('idempotency_keys')).toBe(true);
    // 016 restored: auth-hardening columns back.
    expect((await qi.describeTable('users')).failed_login_attempts).toBeDefined();
    expect((await qi.describeTable('users')).locked_until).toBeDefined();
    expect((await qi.describeTable('users')).must_change_password).toBeDefined();
    expect((await qi.describeTable('user_tenants')).permissions).toBeDefined();
    expect((await qi.describeTable('payments')).refunded_amount).toBeDefined();
    expect((await qi.describeTable('orders')).payment_method).toBeDefined();
    expect((await qi.describeTable('orders')).table_no).toBeDefined();
    expect((await qi.describeTable('orders')).rejected_reason).toBeDefined();
    expect((await qi.describeTable('orders')).customer_email).toBeDefined();
    const reorderIndexes = await qi.showIndex('orders', {});
    const repayIndexes = await qi.showIndex('payments', {});
    expect(reorderIndexes.some((i) => i.name === 'ix_orders_tenant_created_at')).toBe(true);
    expect(repayIndexes.some((i) => i.name === 'ix_payments_tenant_created_at')).toBe(true);
    // 020 restored: availability schedule, tags, sort order, variant stock.
    expect((await qi.describeTable('menu_items')).available_from).toBeDefined();
    expect((await qi.describeTable('menu_items')).tags).toBeDefined();
    expect((await qi.describeTable('menu_items')).sort_order).toBeDefined();
    expect((await qi.describeTable('item_variants')).stock).toBeDefined();
    // 021 restored: variant low-stock threshold.
    expect((await qi.describeTable('item_variants')).low_stock_at).toBeDefined();
    // 022 restored: per-day availability overrides.
    expect(await qi.tableExists('availability_overrides')).toBe(true);
    // 023 restored: restaurant-wide closures + recurring weekday rules.
    expect(await qi.tableExists('tenant_closure_dates')).toBe(true);
    expect(await qi.tableExists('availability_weekday_rules')).toBe(true);
    // 024 restored: closure labels.
    expect((await qi.describeTable('tenant_closure_dates')).label).toBeDefined();
    // 026 restored: refund ledger, settlements, tip, gateway verification.
    expect(await qi.tableExists('payment_refunds')).toBe(true);
    expect(await qi.tableExists('settlements')).toBe(true);
    expect((await qi.describeTable('orders')).tip_amount).toBeDefined();
    expect((await qi.describeTable('payments')).gateway).toBeDefined();
    expect((await qi.describeTable('payments')).verification_metadata).toBeDefined();
    // 027 restored: analytics_events + orders channel/session columns.
    expect(await qi.tableExists('analytics_events')).toBe(true);
    expect((await qi.describeTable('orders')).channel).toBeDefined();
    expect((await qi.describeTable('orders')).analytics_session).toBeDefined();
    // 028 restored: outlet tables + outlet_id FK columns.
    expect(await qi.tableExists('outlets')).toBe(true);
    expect(await qi.tableExists('outlet_memberships')).toBe(true);
    expect(await qi.tableExists('outlet_menu_overrides')).toBe(true);
    expect((await qi.describeTable('orders')).outlet_id).toBeDefined();
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
