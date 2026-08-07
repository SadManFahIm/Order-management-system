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
  },
  {
    tableName: 'plans',
    createdAt: 'created_at',
    updatedAt: false,
  }
);

export default Plan;
