import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Product from './Product.js';

/**
 * Recurring availability rule (Phase 4 follow-up). Table
 * `availability_weekday_rules` (migration 023): a per-item window that
 * replaces the item's base schedule on a given weekday (0=Sunday …
 * 6=Saturday), or — when menu_item_id is NULL — a restaurant-wide weekday
 * closure ("closed every Friday", both bounds NULL, enforced by the API).
 *
 * Resolution order: tenant closure date → per-item weekday rule → per-day
 * override → base window.
 */
const AvailabilityWeekdayRule = sequelize.define(
  'AvailabilityWeekdayRule',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tenant_id: { type: DataTypes.INTEGER, allowNull: false, index: true },
    menu_item_id: { type: DataTypes.INTEGER, allowNull: true },
    weekday: { type: DataTypes.INTEGER, allowNull: false },
    available_from: { type: DataTypes.STRING(5), allowNull: true },
    available_to: { type: DataTypes.STRING(5), allowNull: true },
  },
  {
    tableName: 'availability_weekday_rules',
    underscored: true,
    indexes: [{ fields: ['tenant_id', 'weekday'] }],
  }
);

Product.hasMany(AvailabilityWeekdayRule, { foreignKey: 'menu_item_id', as: 'weekdayRules' });
AvailabilityWeekdayRule.belongsTo(Product, { foreignKey: 'menu_item_id', as: 'product' });

export default AvailabilityWeekdayRule;
