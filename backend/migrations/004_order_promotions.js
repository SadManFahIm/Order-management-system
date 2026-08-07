import { DataTypes } from 'sequelize';

/**
 * 004 — Orders & promotions (schema doc §4.5 / §4.6).
 *
 * Shipped ahead of the roadmap timeline (doc lists these under 005/006) because
 * the v1 → v2 data migration (`scripts/migrate-v1-to-v2.js`) needs the target
 * tables to exist. `customer_id` and `reviews` arrive with the customers table
 * in a later migration. Portable scaffold DDL — PG refinements per
 * docs/03-database-schema.md §4 (authoritative).
 */
const t = (transaction) => ({ transaction });

export const up = async (qi, transaction) => {
  await qi.createTable(
    'promotions',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      title: { type: DataTypes.STRING(200), allowNull: false },
      type: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'percentage' },
      percentage_value: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      fixed_value: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      start_date: { type: DataTypes.DATEONLY, allowNull: false },
      end_date: { type: DataTypes.DATEONLY, allowNull: false },
      is_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      max_discount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
      created_by: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
    },
    { ...t(transaction), indexes: [{ fields: ['tenant_id', 'start_date', 'end_date'] }] }
  );

  await qi.createTable(
    'promotion_slabs',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      promotion_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'promotions', key: 'id' },
        onDelete: 'CASCADE',
      },
      min_weight_gm: { type: DataTypes.INTEGER, allowNull: false },
      max_weight_gm: { type: DataTypes.INTEGER, allowNull: false },
      discount_per_500gm: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    },
    { ...t(transaction), indexes: [{ fields: ['promotion_id'] }] }
  );

  await qi.createTable(
    'orders',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      order_no: { type: DataTypes.STRING(40), allowNull: false },
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'placed' },
      type: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pickup' },
      scheduled_for: { type: DataTypes.DATE, allowNull: true },
      delivery_address: { type: DataTypes.TEXT, allowNull: true },
      delivery_lat: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
      delivery_lng: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
      delivery_fee: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      subtotal_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      discount_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      tax_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      total_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'BDT' },
      payment_status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'unpaid' },
      notes: { type: DataTypes.TEXT, allowNull: true },
      assigned_to: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
      created_by: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
    },
    {
      ...t(transaction),
      indexes: [
        { fields: ['tenant_id', 'created_at'] },
        { fields: ['tenant_id', 'status'] },
        { fields: ['tenant_id', 'order_no'], unique: true },
      ],
    }
  );

  await qi.createTable(
    'order_items',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      order_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'orders', key: 'id' },
        onDelete: 'CASCADE',
      },
      menu_item_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'menu_items', key: 'id' },
        onDelete: 'SET NULL',
      },
      item_name: { type: DataTypes.STRING(255), allowNull: false },
      // INTEGER (not SMALLINT) — matches the v1 OrderItem model and avoids
      // PG's refusal to bind int4 parameters into smallint columns.
      quantity: { type: DataTypes.INTEGER, allowNull: false },
      unit_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      discount_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      line_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    },
    { ...t(transaction), indexes: [{ fields: ['order_id'] }] }
  );
};

export const down = async (qi, transaction) => {
  for (const table of ['order_items', 'orders', 'promotion_slabs', 'promotions']) {
    await qi.dropTable(table, { transaction });
  }
};
