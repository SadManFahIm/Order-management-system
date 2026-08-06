import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * A tenant is a restaurant workspace. Phase 3 adds plans, subscriptions, and
 * tenant-scoped business data; this minimal model supports membership and
 * tenant-scoping middleware today.
 */
const Tenant = sequelize.define('Tenant', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(120), allowNull: false },
  slug: { type: DataTypes.STRING(80), allowNull: false, unique: true },
  logo_url: { type: DataTypes.STRING(500), allowNull: true },
  // active | trial | suspended | archived
  status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'active' },
  plan_id: { type: DataTypes.INTEGER, allowNull: true },
  settings: { type: DataTypes.JSON, allowNull: true },
});

export default Tenant;
