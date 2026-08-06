import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Order from './Order.js';
import Product from './Product.js';

const OrderItem = sequelize.define('OrderItem', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  // Multi-tenant scoping (Phase 3).
  tenant_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  quantity: { type: DataTypes.INTEGER, allowNull: false },
  unit_price: { type: DataTypes.FLOAT, allowNull: false },
  weight_per_unit_gm: { type: DataTypes.INTEGER, allowNull: false },
  total_weight_gm: { type: DataTypes.INTEGER, allowNull: false },
  discount: { type: DataTypes.FLOAT, allowNull: false },
  line_total: { type: DataTypes.FLOAT, allowNull: false }
});

Order.hasMany(OrderItem, { foreignKey: 'order_id', as: 'items' });
OrderItem.belongsTo(Order, { foreignKey: 'order_id' });

Product.hasMany(OrderItem, { foreignKey: 'product_id' });
OrderItem.belongsTo(Product, { foreignKey: 'product_id' });

export default OrderItem;
