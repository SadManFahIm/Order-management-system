import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Product from './Product.js';

/**
 * Item add-on (Phase 4) — optional upsells attached to an item, e.g.
 * "Extra cheese +৳50", "Add fries +৳90".
 */
const ItemAddon = sequelize.define('ItemAddon', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  tenant_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    index: true,
  },
  product_id: { type: DataTypes.INTEGER, allowNull: false, index: true },
  name: { type: DataTypes.STRING(120), allowNull: false },
  price: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
});

Product.hasMany(ItemAddon, { foreignKey: 'product_id', as: 'addons' });
ItemAddon.belongsTo(Product, { foreignKey: 'product_id' });

export default ItemAddon;
