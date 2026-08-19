import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * Delivery zone (migration 025) — a per-tenant zone catalogue used by
 * delivery auto-assignment. Each delivery member's coverage lives on
 * `user_tenants.delivery_zones` (JSON array of names); an order's zone on
 * `orders.delivery_zone`. Auto-assign picks a least-loaded rider whose zones
 * include the order's zone (or any rider when the order has no zone).
 */
const DeliveryZone = sequelize.define(
  'DeliveryZone',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      index: true,
    },
    name: { type: DataTypes.STRING(64), allowNull: false },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  {
    tableName: 'delivery_zones',
    underscored: true,
  }
);

export default DeliveryZone;