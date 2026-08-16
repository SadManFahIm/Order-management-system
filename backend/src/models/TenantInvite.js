import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Tenant from './Tenant.js';
import User from './User.js';

/**
 * Tenant membership invites (migration 017).
 *
 * An invite is a raw token (shown exactly once at creation, embedded in the
 * invite link) plus its SHA-256 hash stored here. Invites expire
 * (`expires_at`), can be revoked (`revoked_at`) and are single-use
 * (`accepted_at` set on accept). The raw token is never stored — only the
 * hash — so a DB leak cannot be replayed to join workspaces.
 */
const TenantInvite = sequelize.define(
  'TenantInvite',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tenant_id: { type: DataTypes.INTEGER, allowNull: false },
    email: { type: DataTypes.STRING(254), allowNull: false },
    role: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'cashier' },
    token_hash: { type: DataTypes.STRING(64), allowNull: false },
    invited_by: { type: DataTypes.INTEGER, allowNull: true },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    accepted_at: { type: DataTypes.DATE, allowNull: true },
    revoked_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: 'tenant_invites',
    underscored: true,
  }
);

TenantInvite.belongsTo(Tenant, { foreignKey: 'tenant_id' });
TenantInvite.belongsTo(User, { foreignKey: 'invited_by', as: 'inviter' });

export default TenantInvite;
