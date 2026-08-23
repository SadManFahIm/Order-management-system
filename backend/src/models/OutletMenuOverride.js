import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * OutletMenuOverride (migration 028) — per-outlet overrides for a menu item.
 * NULL fields mean "use the central catalog value"; non-null values override
 * the brand-wide defaults for that specific outlet.
 */
const OutletMenuOverride = sequelize.define(
  'OutletMenuOverride',
  {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    outlet_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      index: true,
    },
    menu_item_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      index: true,
    },
    tenant_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      index: true,
    },
    price_override: { type: DataTypes.NUMERIC(12, 2), allowNull: true },
    is_available: { type: DataTypes.BOOLEAN, allowNull: true },
    stock_override: { type: DataTypes.NUMERIC(10, 2), allowNull: true },
    visible: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  {
    tableName: 'outlet_menu_overrides',
    underscored: true,
    indexes: [
      { fields: ['outlet_id', 'menu_item_id'], unique: true },
      { fields: ['tenant_id'] },
    ],
  }
);

export default OutletMenuOverride;
