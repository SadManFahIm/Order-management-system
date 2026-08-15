import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import User from './User.js';
import Tenant from './Tenant.js';

/**
 * Membership join table: which users belong to which tenants and with which
 * role (owner | manager | cashier | kitchen | delivery). Table `user_tenants`
 * (migration 001) — has `created_at` but no `updated_at`.
 */
const UserTenant = sequelize.define(
  'UserTenant',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    tenant_id: { type: DataTypes.INTEGER, allowNull: false },
    role: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'staff',
    },
    // Per-user permission flags (migration 016): JSONB array that overrides
    // the role's base matrix — e.g. ['refund:orders', '-manage:menu'].
    // A leading '-' denies a permission the role would otherwise grant.
    permissions: { type: DataTypes.JSONB, allowNull: true },
  },
  {
    tableName: 'user_tenants',
    indexes: [{ unique: true, fields: ['user_id', 'tenant_id'] }],
    createdAt: 'created_at',
    updatedAt: false,
  }
);

User.belongsToMany(Tenant, { through: UserTenant, foreignKey: 'user_id', as: 'tenants' });
Tenant.belongsToMany(User, { through: UserTenant, foreignKey: 'tenant_id', as: 'users' });
UserTenant.belongsTo(User, { foreignKey: 'user_id' });
UserTenant.belongsTo(Tenant, { foreignKey: 'tenant_id' });

export default UserTenant;
