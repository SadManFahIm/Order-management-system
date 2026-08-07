import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Product from './Product.js';

/**
 * Inventory snapshot for a menu item (Phase 4 completion). Table
 * `inventory_items` (migration 003): one row per tenant + menu item
 * (unique index). `name` is denormalised from the product so stock remains
 * readable even if the item is later removed. The table has NO created_at
 * column — only updated_at — so timestamps are configured to match.
 */
const InventoryItem = sequelize.define(
  'InventoryItem',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      index: true,
    },
    menu_item_id: { type: DataTypes.INTEGER, allowNull: true },
    name: { type: DataTypes.STRING(200), allowNull: false },
    stock_qty: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    low_stock_at: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    unit: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pcs' },
  },
  {
    tableName: 'inventory_items',
    underscored: true,
    // The table only carries updated_at — no created_at.
    createdAt: false,
    updatedAt: true,
    indexes: [{ fields: ['tenant_id', 'menu_item_id'], unique: true }],
  }
);

Product.hasOne(InventoryItem, { foreignKey: 'menu_item_id', as: 'inventory' });
InventoryItem.belongsTo(Product, { foreignKey: 'menu_item_id' });

export default InventoryItem;
