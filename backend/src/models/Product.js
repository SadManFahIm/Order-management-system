import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * Menu item. Table `menu_items` (migration 003) — the v1-era attribute names
 * are preserved while the columns follow the V2 schema:
 *   price   → base_price
 *   enabled → is_available
 * weight_gm is added by migration 005 (v1 field bridge).
 * Money stays FLOAT at the attribute level (the pg driver returns DECIMAL as
 * strings; float8 params cast cleanly into numeric columns, and reads parse
 * back through the FLOAT type).
 */
const Product = sequelize.define(
  'Product',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    // Multi-tenant scoping (Phase 3): every product belongs to a workspace.
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      index: true,
    },
    name: { type: DataTypes.STRING(200), allowNull: false },
    description: { type: DataTypes.TEXT },
    price: { type: DataTypes.FLOAT, allowNull: false, field: 'base_price' },
    weight_gm: { type: DataTypes.INTEGER, allowNull: false },
    enabled: { type: DataTypes.BOOLEAN, defaultValue: true, field: 'is_available' },
    // Rich menu (Phase 4): category, prep time, photo URL.
    category_id: { type: DataTypes.INTEGER, allowNull: true },
    prep_minutes: { type: DataTypes.INTEGER, allowNull: true },
    image_url: { type: DataTypes.STRING(500), allowNull: true },
    // Optimistic lock (migration 003) — bumped on every update; clients send
    // the version they based their edit on and get 409 on a stale write.
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    // VAT rate percent (migration 009) — VAT-inclusive pricing, NBR-ready.
    vat_rate: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 5 },
  },
  {
    tableName: 'menu_items',
    // Index fields are physical column names (field-mapped), not attributes.
    indexes: [{ fields: ['tenant_id', 'is_available'] }, { fields: ['tenant_id', 'category_id'] }],
    underscored: true,
    // Soft delete (Phase 4 completion): DELETE /api/products/:id sets
    // deleted_at instead of removing the row — order history keeps its FK,
    // and the migration's deleted_at column matches the paranoid attribute.
    paranoid: true,
  }
);

// Category association is wired in MenuCategory.js (import order matters for
// Sequelize; both sides defined here keep it explicit).
import MenuCategory from './MenuCategory.js';
Product.belongsTo(MenuCategory, { foreignKey: 'category_id', as: 'category' });
MenuCategory.hasMany(Product, { foreignKey: 'category_id', as: 'products' });

export default Product;
