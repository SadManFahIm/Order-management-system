import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * Menu category (Phase 4). Tenant-scoped, supports one level of
 * subcategories via the self-referencing parent_id (roadmap allows deeper
 * nesting later — the schema supports it).
 */
const MenuCategory = sequelize.define(
  'MenuCategory',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      index: true,
    },
    name: { type: DataTypes.STRING(120), allowNull: false },
    parent_id: { type: DataTypes.INTEGER, allowNull: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  {
    indexes: [{ fields: ['tenant_id', 'parent_id'] }],
  }
);

MenuCategory.belongsTo(MenuCategory, { foreignKey: 'parent_id', as: 'parent' });
MenuCategory.hasMany(MenuCategory, { foreignKey: 'parent_id', as: 'children' });

export default MenuCategory;
