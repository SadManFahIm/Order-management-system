import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * A tenant is a restaurant workspace. Table `tenants` (migration 001 + 002
 * plan_id). `settings` is JSONB NOT NULL DEFAULT '{}' in the migration —
 * the model mirrors that so app-created tenants always carry a valid value.
 */
const Tenant = sequelize.define(
  'Tenant',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    slug: { type: DataTypes.STRING(120), allowNull: false, unique: true },
    logo_url: { type: DataTypes.STRING(500), allowNull: true },
    // active | trial | suspended | archived
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'active' },
    plan_id: { type: DataTypes.INTEGER, allowNull: true },
    settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  },
  {
    tableName: 'tenants',
    underscored: true,
  }
);

export default Tenant;
