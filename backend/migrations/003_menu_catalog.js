import { DataTypes } from 'sequelize';

/**
 * 003 — Menu & catalog (schema doc §4.3): menu_categories (self-ref), menu_items,
 * item_variants, item_addons, allergens + item_allergens join, inventory_items.
 *
 * Money is DECIMAL(12,2); every business table is tenant-scoped.
 */
const t = (transaction) => ({ transaction });

export const up = async (qi, transaction) => {
  await qi.createTable(
    'menu_categories',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      parent_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'menu_categories', key: 'id' },
        onDelete: 'SET NULL',
      },
      name: { type: DataTypes.STRING(120), allowNull: false },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
      created_by: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
    },
    { ...t(transaction), indexes: [{ fields: ['tenant_id', 'sort_order'] }, { fields: ['tenant_id', 'parent_id'] }] }
  );

  await qi.createTable(
    'menu_items',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      category_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'menu_categories', key: 'id' },
        onDelete: 'SET NULL',
      },
      name: { type: DataTypes.STRING(200), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      image_url: { type: DataTypes.STRING(500), allowNull: true },
      base_price: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      // INTEGER (not SMALLINT) — matches the v1 Product model and avoids
      // PG's refusal to bind int4 parameters into smallint columns.
      prep_minutes: { type: DataTypes.INTEGER, allowNull: true },
      nutrition: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      ingredients: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      is_available: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      availability: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      // Optimistic lock for kitchen/merchant concurrent edits.
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
      created_by: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
    },
    { ...t(transaction), indexes: [{ fields: ['tenant_id', 'category_id'] }, { fields: ['tenant_id'] }] }
  );

  await qi.createTable(
    'item_variants',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      menu_item_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'menu_items', key: 'id' },
        onDelete: 'CASCADE',
      },
      name: { type: DataTypes.STRING(120), allowNull: false },
      price_adjustment: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      is_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { ...t(transaction), indexes: [{ fields: ['menu_item_id'] }] }
  );

  await qi.createTable(
    'item_addons',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      menu_item_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'menu_items', key: 'id' },
        onDelete: 'CASCADE',
      },
      group_name: { type: DataTypes.STRING(120), allowNull: false },
      option_name: { type: DataTypes.STRING(120), allowNull: false },
      price: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      max_qty: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { ...t(transaction), indexes: [{ fields: ['menu_item_id'] }] }
  );

  await qi.createTable(
    'allergens',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      code: { type: DataTypes.STRING(32), allowNull: false, unique: true },
      label: { type: DataTypes.STRING(120), allowNull: false },
    },
    t(transaction)
  );

  // Composite primary key (both attributes marked primaryKey → joined).
  await qi.createTable(
    'item_allergens',
    {
      menu_item_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        primaryKey: true,
        references: { model: 'menu_items', key: 'id' },
        onDelete: 'CASCADE',
      },
      allergen_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        primaryKey: true,
        references: { model: 'allergens', key: 'id' },
        onDelete: 'CASCADE',
      },
    },
    t(transaction)
  );

  await qi.createTable(
    'inventory_items',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      menu_item_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'menu_items', key: 'id' },
        onDelete: 'SET NULL',
      },
      name: { type: DataTypes.STRING(200), allowNull: false },
      stock_qty: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      low_stock_at: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      unit: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pcs' },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { ...t(transaction), indexes: [{ fields: ['tenant_id', 'menu_item_id'], unique: true }] }
  );
};

export const down = async (qi, transaction) => {
  for (const table of [
    'inventory_items',
    'item_allergens',
    'allergens',
    'item_addons',
    'item_variants',
    'menu_items',
    'menu_categories',
  ]) {
    await qi.dropTable(table, { transaction });
  }
};
