import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/** SaaS subscription plans (Phase 3). Table `plans` (migration 002). */
const Plan = sequelize.define(
  'Plan',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(80), allowNull: false },
    code: { type: DataTypes.STRING(32), allowNull: false, unique: true },
    price_mo: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    // SaaS quota limits (migration 017) — enforced by planService.
    max_products: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 20 },
    max_orders_per_day: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 50 },
    max_members: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 2 },
    storage_mb: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
  },
  {
    tableName: 'plans',
    createdAt: 'created_at',
    updatedAt: false,
  }
);

export default Plan;
