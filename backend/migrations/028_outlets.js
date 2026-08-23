import { DataTypes } from 'sequelize';

/**
 * 028 — Multi-outlet & franchise management (Phase 8).
 *
 * New tables:
 *   outlets               — physical locations (branches) within a tenant
 *   outlet_memberships    — which users can access which outlets
 *   outlet_menu_overrides — per-outlet price / availability / visibility overrides
 *
 * Altered tables (outlet_id FK added):
 *   orders, inventory_items, tables, tenant_closure_dates,
 *   availability_overrides, availability_weekday_rules,
 *   delivery_zones, daily_stats, analytics_events, audit_logs
 *
 * Unique indexes on tenant_id are updated to include outlet_id where the
 * business constraint is per-location (inventory, tables, closures, stats).
 *
 * A default "Main Branch" outlet is seeded for every existing tenant so all
 * legacy data remains accessible after backfill.
 */
export const up = async (qi, transaction) => {
  const t = { transaction };

  // ──────────────────────────────────────────────
  // 1. outlets
  // ──────────────────────────────────────────────
  await qi.createTable(
    'outlets',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      name: { type: DataTypes.STRING(120), allowNull: false },
      code: { type: DataTypes.STRING(32), allowNull: false },
      slug: { type: DataTypes.STRING(120), allowNull: false },
      address: { type: DataTypes.TEXT, allowNull: true },
      phone: { type: DataTypes.STRING(30), allowNull: true },
      email: { type: DataTypes.STRING(200), allowNull: true },
      timezone: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'Asia/Dhaka' },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'active' },
      opening_hours: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: qi.sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: qi.sequelize.literal('CURRENT_TIMESTAMP'),
      },
    },
    {
      ...t,
      indexes: [
        { fields: ['tenant_id'] },
        { fields: ['tenant_id', 'code'], unique: true },
        { fields: ['tenant_id', 'slug'], unique: true },
        { fields: ['status'] },
      ],
    }
  );

  // ──────────────────────────────────────────────
  // 2. outlet_memberships
  // ──────────────────────────────────────────────
  await qi.createTable(
    'outlet_memberships',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      user_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      outlet_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'outlets', key: 'id' },
        onDelete: 'CASCADE',
      },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      role: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'staff',
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: qi.sequelize.literal('CURRENT_TIMESTAMP'),
      },
    },
    {
      ...t,
      indexes: [
        { fields: ['user_id'] },
        { fields: ['outlet_id'] },
        { fields: ['tenant_id'] },
        { fields: ['user_id', 'outlet_id'], unique: true },
        { fields: ['tenant_id', 'user_id'] },
      ],
    }
  );

  // ──────────────────────────────────────────────
  // 3. outlet_menu_overrides
  // ──────────────────────────────────────────────
  await qi.createTable(
    'outlet_menu_overrides',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      outlet_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'outlets', key: 'id' },
        onDelete: 'CASCADE',
      },
      menu_item_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'menu_items', key: 'id' },
        onDelete: 'CASCADE',
      },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      price_override: { type: DataTypes.NUMERIC(12, 2), allowNull: true },
      is_available: { type: DataTypes.BOOLEAN, allowNull: true },
      stock_override: { type: DataTypes.NUMERIC(10, 2), allowNull: true },
      visible: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: qi.sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: qi.sequelize.literal('CURRENT_TIMESTAMP'),
      },
    },
    {
      ...t,
      indexes: [
        { fields: ['outlet_id'] },
        { fields: ['outlet_id', 'menu_item_id'], unique: true },
        { fields: ['tenant_id'] },
        { fields: ['menu_item_id'] },
      ],
    }
  );

  // ──────────────────────────────────────────────
  // 4. Add outlet_id FK columns to existing tables
  // ──────────────────────────────────────────────
  const fkColumns = [
    'orders',
    'inventory_items',
    'tables',
    'tenant_closure_dates',
    'availability_overrides',
    'availability_weekday_rules',
    'delivery_zones',
    'daily_stats',
    'analytics_events',
    'audit_logs',
  ];

  for (const table of fkColumns) {
    await qi.addColumn(table, 'outlet_id', {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: { model: 'outlets', key: 'id' },
      onDelete: 'SET NULL',
    }, t);
  }

  // ──────────────────────────────────────────────
  // 5. Indexes on outlet_id for each affected table
  // ──────────────────────────────────────────────
  await qi.addIndex('orders', ['outlet_id'], { ...t, name: 'idx_orders_outlet' });
  await qi.addIndex('orders', ['outlet_id', 'created_at'], { ...t, name: 'idx_orders_outlet_date' });
  await qi.addIndex('inventory_items', ['outlet_id'], { ...t, name: 'idx_inventory_outlet' });
  await qi.addIndex('inventory_items', ['outlet_id', 'menu_item_id'], { ...t, name: 'idx_inventory_outlet_item' });
  await qi.addIndex('tables', ['outlet_id'], { ...t, name: 'idx_tables_outlet' });
  await qi.addIndex('tenant_closure_dates', ['outlet_id'], { ...t, name: 'idx_closure_outlet' });
  await qi.addIndex('availability_overrides', ['outlet_id'], { ...t, name: 'idx_avoidoverride_outlet' });
  await qi.addIndex('availability_weekday_rules', ['outlet_id'], { ...t, name: 'idx_avoidrule_outlet' });
  await qi.addIndex('delivery_zones', ['outlet_id'], { ...t, name: 'idx_deliveryzone_outlet' });
  await qi.addIndex('daily_stats', ['outlet_id'], { ...t, name: 'idx_dailystats_outlet' });
  await qi.addIndex('analytics_events', ['outlet_id'], { ...t, name: 'idx_analyticsevent_outlet' });
  await qi.addIndex('audit_logs', ['outlet_id'], { ...t, name: 'idx_auditlog_outlet' });

  // ──────────────────────────────────────────────
  // 6. Recreate unique indexes that need outlet_id
  // ──────────────────────────────────────────────
  // inventory_items: old unique(tenant_id, menu_item_id) → new unique(tenant_id, outlet_id, menu_item_id)
  await qi.removeIndex('inventory_items', 'inventory_items_tenant_id_menu_item_id_key').catch(() => {
    // SQLite: removeIndex by name may fail — try drop+recreate
  });
  // Drop the old index by exact SQL (SQLite safe)
  await qi.sequelize
    .query('DROP INDEX IF EXISTS "inventory_items_tenant_id_menu_item_id_key"', { transaction })
    .catch(() => {});
  await qi.addIndex(
    'inventory_items',
    ['tenant_id', 'outlet_id', 'menu_item_id'],
    { ...t, unique: true, name: 'inventory_items_tenant_outlet_item_key' }
  );

  // tenant_closure_dates: old unique(tenant_id, date) → new unique(tenant_id, outlet_id, date)
  await qi.sequelize
    .query('DROP INDEX IF EXISTS "tenant_closure_dates_tenant_id_date_key"', { transaction })
    .catch(() => {});
  await qi.addIndex(
    'tenant_closure_dates',
    ['tenant_id', 'outlet_id', 'date'],
    { ...t, unique: true, name: 'tenant_closure_dates_tenant_outlet_date_key' }
  );

  // tables: old unique(tenant_id, table_no) → new unique(tenant_id, outlet_id, table_no)
  await qi.sequelize
    .query('DROP INDEX IF EXISTS "tables_tenant_id_table_no_key"', { transaction })
    .catch(() => {});
  await qi.addIndex(
    'tables',
    ['tenant_id', 'outlet_id', 'table_no'],
    { ...t, unique: true, name: 'tables_tenant_outlet_no_key' }
  );

  // daily_stats: old unique(tenant_id, stat_date) → new unique(tenant_id, outlet_id, stat_date)
  await qi.sequelize
    .query('DROP INDEX IF EXISTS "daily_stats_tenant_id_stat_date_key"', { transaction })
    .catch(() => {});
  await qi.addIndex(
    'daily_stats',
    ['tenant_id', 'outlet_id', 'stat_date'],
    { ...t, unique: true, name: 'daily_stats_tenant_outlet_date_key' }
  );

  // availability_overrides: old unique(tenant_id, menu_item_id, date) → new unique(tenant_id, outlet_id, menu_item_id, date)
  await qi.sequelize
    .query(
      'DROP INDEX IF EXISTS "availability_overrides_tenant_id_menu_item_id_date_key"',
      { transaction }
    )
    .catch(() => {});
  await qi.addIndex(
    'availability_overrides',
    ['tenant_id', 'outlet_id', 'menu_item_id', 'date'],
    { ...t, unique: true, name: 'availability_overrides_tenant_outlet_item_date_key' }
  );

  // ──────────────────────────────────────────────
  // 7. Seed default "Main Branch" outlet for every existing tenant
  // ──────────────────────────────────────────────
  const [tenants] = await qi.sequelize.query(
    'SELECT id FROM tenants ORDER BY id ASC',
    { transaction }
  );

  for (const { id: tenantId } of tenants) {
    await qi.bulkInsert(
      'outlets',
      [
        {
          tenant_id: tenantId,
          name: 'Main Branch',
          code: 'MAIN',
          slug: 'main',
          status: 'active',
          timezone: 'Asia/Dhaka',
          opening_hours: {},
          settings: {},
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
      { transaction }
    );

    // Fetch the inserted outlet id
    const [[outlet]] = await qi.sequelize.query(
      'SELECT id FROM outlets WHERE tenant_id = ? AND code = ?',
      { replacements: [tenantId, 'MAIN'], transaction }
    );

    // Backfill outlet_id on every operational table for this tenant
    const backfillTables = [
      { table: 'orders', outletId: outlet.id },
      { table: 'inventory_items', outletId: outlet.id },
      { table: 'tables', outletId: outlet.id },
      { table: 'tenant_closure_dates', outletId: outlet.id },
      { table: 'availability_overrides', outletId: outlet.id },
      { table: 'availability_weekday_rules', outletId: outlet.id },
      { table: 'delivery_zones', outletId: outlet.id },
      { table: 'daily_stats', outletId: outlet.id },
      { table: 'analytics_events', outletId: outlet.id },
      { table: 'audit_logs', outletId: outlet.id },
    ];

    for (const { table, outletId } of backfillTables) {
      await qi.sequelize.query(
        `UPDATE ${table} SET outlet_id = ? WHERE tenant_id = ? AND outlet_id IS NULL`,
        { replacements: [outletId, tenantId], transaction }
      );
    }
  }

  // ──────────────────────────────────────────────
  // 8. Assign every owner to the default outlet
  // ──────────────────────────────────────────────
  // Find owners and their default outlets, then bulk-insert memberships
  const [ownerRows] = await qi.sequelize.query(
    `SELECT ut.user_id, ut.tenant_id, o.id AS outlet_id
     FROM user_tenants ut
     JOIN outlets o ON o.tenant_id = ut.tenant_id AND o.code = 'MAIN'
     WHERE ut.role = 'owner'`,
    { transaction }
  );

  if (ownerRows.length > 0) {
    const now = new Date();
    await qi.bulkInsert(
      'outlet_memberships',
      ownerRows.map((r) => ({
        user_id: r.user_id,
        outlet_id: r.outlet_id,
        tenant_id: r.tenant_id,
        role: 'outlet_manager',
        created_at: now,
      })),
      { transaction }
    );
  }
};

// ──────────────────────────────────────────────
// down: reverse everything
// ──────────────────────────────────────────────
export const down = async (qi, transaction) => {
  const t = { transaction };

  // Restore original unique indexes before dropping outlet_id
  await qi.sequelize
    .query('DROP INDEX IF EXISTS "availability_overrides_tenant_outlet_item_date_key"', { transaction })
    .catch(() => {});
  await qi.addIndex(
    'availability_overrides',
    ['tenant_id', 'menu_item_id', 'date'],
    { ...t, unique: true, name: 'availability_overrides_tenant_id_menu_item_id_date_key' }
  );

  await qi.sequelize
    .query('DROP INDEX IF EXISTS "daily_stats_tenant_outlet_date_key"', { transaction })
    .catch(() => {});
  await qi.addIndex(
    'daily_stats',
    ['tenant_id', 'stat_date'],
    { ...t, unique: true, name: 'daily_stats_tenant_id_stat_date_key' }
  );

  await qi.sequelize
    .query('DROP INDEX IF EXISTS "tables_tenant_outlet_no_key"', { transaction })
    .catch(() => {});
  await qi.addIndex(
    'tables',
    ['tenant_id', 'table_no'],
    { ...t, unique: true, name: 'tables_tenant_id_table_no_key' }
  );

  await qi.sequelize
    .query('DROP INDEX IF EXISTS "tenant_closure_dates_tenant_outlet_date_key"', { transaction })
    .catch(() => {});
  await qi.addIndex(
    'tenant_closure_dates',
    ['tenant_id', 'date'],
    { ...t, unique: true, name: 'tenant_closure_dates_tenant_id_date_key' }
  );

  await qi.sequelize
    .query('DROP INDEX IF EXISTS "inventory_items_tenant_outlet_item_key"', { transaction })
    .catch(() => {});
  await qi.addIndex(
    'inventory_items',
    ['tenant_id', 'menu_item_id'],
    { ...t, unique: true, name: 'inventory_items_tenant_id_menu_item_id_key' }
  );

  // Drop outlet_id FK columns
  const fkColumns = [
    'audit_logs',
    'analytics_events',
    'daily_stats',
    'delivery_zones',
    'availability_weekday_rules',
    'availability_overrides',
    'tenant_closure_dates',
    'tables',
    'inventory_items',
    'orders',
  ];
  for (const table of fkColumns) {
    await qi.removeColumn(table, 'outlet_id', t);
  }

  // Drop tables (memberships first due to FK)
  await qi.dropTable('outlet_menu_overrides', t);
  await qi.dropTable('outlet_memberships', t);
  await qi.dropTable('outlets', t);
};
