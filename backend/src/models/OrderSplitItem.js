import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Order from './Order.js';
import Payment from './Payment.js';

/**
 * Per-diner split allocation. Table `order_split_items` (migration 013).
 *
 * Records WHICH items each diner part (a `payments` row) is responsible
 * for when an order is split by item — a denormalised snapshot exactly
 * like `order_items` (item_name, unit/discount/line amounts + the product's
 * vat_rate), so per-diner receipts stay stable even if the menu changes or
 * a product is soft-deleted afterwards. Equal/custom splits have no rows
 * here — their parts are pure amount allocations.
 */
const OrderSplitItem = sequelize.define(
  'OrderSplitItem',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    // Multi-tenant scoping (Phase 3).
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      index: true,
    },
    order_id: { type: DataTypes.INTEGER, allowNull: false, index: true },
    // The payment row this diner part maps to (cash → paid on the spot,
    // wallets → pending until the cashier confirms the trxID).
    payment_id: { type: DataTypes.INTEGER, allowNull: false, index: true },
    // Snapshot fields — see the migration comment.
    menu_item_id: { type: DataTypes.INTEGER, allowNull: true },
    item_name: { type: DataTypes.STRING(255), allowNull: false },
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    unit_amount: { type: DataTypes.FLOAT, allowNull: false },
    discount_amount: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    line_amount: { type: DataTypes.FLOAT, allowNull: false },
    vat_rate: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    created_by: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    tableName: 'order_split_items',
    underscored: true,
  }
);

Order.hasMany(OrderSplitItem, { foreignKey: 'order_id', as: 'splitItems' });
OrderSplitItem.belongsTo(Order, { foreignKey: 'order_id' });

Payment.hasMany(OrderSplitItem, { foreignKey: 'payment_id', as: 'splitItems' });
OrderSplitItem.belongsTo(Payment, { foreignKey: 'payment_id' });

export default OrderSplitItem;
