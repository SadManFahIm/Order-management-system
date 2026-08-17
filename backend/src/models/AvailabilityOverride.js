import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Product from './Product.js';

/**
 * Per-day availability override (Phase 4 follow-up). Table
 * `availability_overrides` (migration 022): one row per tenant + item + date
 * that replaces the item's repeating availability window
 * (menu_items.available_from / to) for that single calendar day.
 *
 * Both bounds NULL = explicitly closed all day; otherwise the bounds follow
 * the same 'HH:MM' semantics as the base schedule (one-sided and overnight
 * windows included). Enforced on the storefront (hidden when the override
 * makes the item unavailable) and at checkout (AVAILABILITY_WINDOW).
 */
const AvailabilityOverride = sequelize.define(
  'AvailabilityOverride',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      index: true,
    },
    menu_item_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      index: true,
    },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    available_from: { type: DataTypes.STRING(5), allowNull: true },
    available_to: { type: DataTypes.STRING(5), allowNull: true },
  },
  {
    tableName: 'availability_overrides',
    underscored: true,
    indexes: [
      { fields: ['tenant_id', 'menu_item_id', 'date'], unique: true },
      { fields: ['tenant_id', 'date'] },
    ],
  }
);

Product.hasMany(AvailabilityOverride, { foreignKey: 'menu_item_id', as: 'overrides' });
AvailabilityOverride.belongsTo(Product, { foreignKey: 'menu_item_id', as: 'product' });

export default AvailabilityOverride;
