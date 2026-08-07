import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Product from './Product.js';

/**
 * Item add-on (Phase 4) — optional upsells attached to an item, e.g.
 * "Extra cheese +৳50", "Add fries +৳90". Table `item_addons` (migration
 * 003): `product_id` → `menu_item_id`, `name` → `option_name`.
 */
const ItemAddon = sequelize.define(
  'ItemAddon',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      index: true,
    },
    product_id: { type: DataTypes.INTEGER, allowNull: false, index: true, field: 'menu_item_id' },
    // group_name is NOT NULL in migration 003 (no DB default) — flat v1-style
    // add-ons belong to a default option group.
    group_name: { type: DataTypes.STRING(120), allowNull: false, defaultValue: 'Add-ons' },
    name: { type: DataTypes.STRING(120), allowNull: false, field: 'option_name' },
    price: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  {
    tableName: 'item_addons',
    createdAt: 'created_at',
    updatedAt: false,
  }
);

Product.hasMany(ItemAddon, { foreignKey: 'product_id', as: 'addons' });
ItemAddon.belongsTo(Product, { foreignKey: 'product_id' });

export default ItemAddon;
