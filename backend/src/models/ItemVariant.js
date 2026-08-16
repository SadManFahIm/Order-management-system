import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Product from './Product.js';

/**
 * Item variant (Phase 4) — e.g. "Small / Regular / Large" with a price
 * adjustment on top of the base product price. Table `item_variants`
 * (migration 003): `product_id` maps to the `menu_item_id` column.
 */
const ItemVariant = sequelize.define(
  'ItemVariant',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      index: true,
    },
    product_id: { type: DataTypes.INTEGER, allowNull: false, index: true, field: 'menu_item_id' },
    name: { type: DataTypes.STRING(80), allowNull: false },
    price_adjustment: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    // Per-variant stock (migration 020) — quantity on hand; NULL means
    // unlimited / inherits the product-level inventory.
    stock: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    tableName: 'item_variants',
    createdAt: 'created_at',
    updatedAt: false,
  }
);

Product.hasMany(ItemVariant, { foreignKey: 'product_id', as: 'variants' });
ItemVariant.belongsTo(Product, { foreignKey: 'product_id' });

export default ItemVariant;
