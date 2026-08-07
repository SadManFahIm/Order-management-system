import { DataTypes } from 'sequelize';

/**
 * 005 — v1 field bridge.
 *
 * Migrations 001–004 model the V2 schema, but the aligned Sequelize models
 * still carry a few v1-era fields the V2 DDL omitted (they were never part of
 * the schema doc's target columns). Rather than force the models to drop
 * real business data, this migration adds those columns so the model set and
 * the migration schema agree exactly:
 *
 *   menu_items.weight_gm            — v1 Product.weight_gm (required)
 *   orders.customer_name/phone/addr — v1 Order customer fields
 *   order_items.weight_per_unit_gm  — v1 OrderItem weights (required)
 *   order_items.total_weight_gm
 *
 * All are additive; defaults only exist to satisfy NOT NULL on existing rows.
 */
const t = (transaction) => ({ transaction });

export const up = async (qi, transaction) => {
  await qi.addColumn(
    'menu_items',
    'weight_gm',
    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    t(transaction)
  );
  await qi.addColumn(
    'orders',
    'customer_name',
    { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
    t(transaction)
  );
  await qi.addColumn(
    'orders',
    'customer_phone',
    { type: DataTypes.STRING(30), allowNull: true },
    t(transaction)
  );
  await qi.addColumn(
    'orders',
    'customer_address',
    { type: DataTypes.TEXT, allowNull: true },
    t(transaction)
  );
  await qi.addColumn(
    'order_items',
    'weight_per_unit_gm',
    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    t(transaction)
  );
  await qi.addColumn(
    'order_items',
    'total_weight_gm',
    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    t(transaction)
  );
};

export const down = async (qi, transaction) => {
  const cols = [
    ['order_items', 'total_weight_gm'],
    ['order_items', 'weight_per_unit_gm'],
    ['orders', 'customer_address'],
    ['orders', 'customer_phone'],
    ['orders', 'customer_name'],
    ['menu_items', 'weight_gm'],
  ];
  for (const [table, column] of cols) {
    await qi.removeColumn(table, column, t(transaction));
  }
};
