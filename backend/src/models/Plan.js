import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/** SaaS subscription plans (Phase 3). */
const Plan = sequelize.define('Plan', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(80), allowNull: false },
  code: { type: DataTypes.STRING(32), allowNull: false, unique: true },
  price_mo: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
});

export default Plan;
