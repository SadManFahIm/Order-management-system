import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const Product = sequelize.define(
  'Product',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    // Multi-tenant scoping (Phase 3): every product belongs to a workspace.
    // Legacy rows are backfilled to the default tenant by schemaSync.
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      index: true,
    },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT },
    price: { type: DataTypes.FLOAT, allowNull: false },
    weight_gm: { type: DataTypes.INTEGER, allowNull: false },
    enabled: { type: DataTypes.BOOLEAN, defaultValue: true },
    // Rich menu (Phase 4): category, prep time, photo URL.
    category_id: { type: DataTypes.INTEGER, allowNull: true },
    prep_minutes: { type: DataTypes.INTEGER, allowNull: true },
    image_url: { type: DataTypes.STRING(500), allowNull: true }
  },
  {
    indexes: [{ fields: ['tenant_id', 'enabled'] }, { fields: ['tenant_id', 'category_id'] }],
  }
);

// Category association is wired in MenuCategory.js (import order matters for
// Sequelize; both sides defined here keep it explicit).
import MenuCategory from './MenuCategory.js';
Product.belongsTo(MenuCategory, { foreignKey: 'category_id', as: 'category' });
MenuCategory.hasMany(Product, { foreignKey: 'category_id', as: 'products' });

export default Product;
