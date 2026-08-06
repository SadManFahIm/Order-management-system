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
  // active | suspended | archived
  status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'active' },
  settings: { type: DataTypes.JSON, allowNull: true },
});

export default Tenant;
