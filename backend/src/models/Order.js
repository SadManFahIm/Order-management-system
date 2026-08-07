import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * Order. Table `orders` (migration 004) with v1-era money columns mapped to
 * the V2 names:
 *   subtotal       → subtotal_amount
 *   total_discount → discount_amount
 *   grand_total    → total_amount
 * customer_name/phone/address are bridged by migration 005 (the migration
 * orders table also carries order_no/status/type/payment_status which the
 * route populates or the DB defaults provide).
 */
const Order = sequelize.define(
  'Order',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    // Multi-tenant scoping (Phase 3).
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      index: true,
    },
    // order_no is NOT NULL with no DB default in migration 004 — the route
    // generates it, and the attribute MUST be declared or Sequelize silently
    // drops it from the INSERT (and the DB rejects the row).
    order_no: { type: DataTypes.STRING(40), allowNull: false },
    customer_name: { type: DataTypes.STRING(255), allowNull: false },
    customer_phone: { type: DataTypes.STRING(30) },
    customer_address: { type: DataTypes.TEXT },
    subtotal: { type: DataTypes.FLOAT, allowNull: false, field: 'subtotal_amount' },
    total_discount: { type: DataTypes.FLOAT, allowNull: false, field: 'discount_amount' },
    grand_total: { type: DataTypes.FLOAT, allowNull: false, field: 'total_amount' },
    // Fulfillment lifecycle (Phase 5 foundation). Columns exist in migration
    // 004 with sensible defaults; the model declares them so the attributes
    // are read/written by Sequelize.
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'placed',
    },
    type: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'pickup',
    },
    payment_status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'unpaid',
    },
  },
  {
    tableName: 'orders',
    underscored: true,
  }
);

export default Order;
