import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Order from './Order.js';
import Product from './Product.js';

/**
 * Order line item. Table `order_items` (migration 004): the v1 FK `product_id`
 * maps to the `menu_item_id` column, and money columns follow the V2 names
 * (unit_price → unit_amount, discount → discount_amount, line_total →
 * line_amount). `item_name` is a denormalized snapshot (NOT NULL in the
 * migration) set by the orders route. weight_per_unit_gm / total_weight_gm
 * are bridged by migration 005. No timestamp columns in the migration.
 */
const OrderItem = sequelize.define(
  'OrderItem',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    // Multi-tenant scoping (Phase 3).
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    product_id: { type: DataTypes.INTEGER, allowNull: true, field: 'menu_item_id' },
    item_name: { type: DataTypes.STRING(255), allowNull: false },
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    unit_price: { type: DataTypes.FLOAT, allowNull: false, field: 'unit_amount' },
    weight_per_unit_gm: { type: DataTypes.INTEGER, allowNull: false },
    total_weight_gm: { type: DataTypes.INTEGER, allowNull: false },
    discount: { type: DataTypes.FLOAT, allowNull: false, field: 'discount_amount' },
    line_total: { type: DataTypes.FLOAT, allowNull: false, field: 'line_amount' },
  },
  {
    tableName: 'order_items',
    timestamps: false,
  }
);

Order.hasMany(OrderItem, { foreignKey: 'order_id', as: 'items' });
OrderItem.belongsTo(Order, { foreignKey: 'order_id' });

Product.hasMany(OrderItem, { foreignKey: 'product_id' });
OrderItem.belongsTo(Product, { foreignKey: 'product_id' });

export default OrderItem;
