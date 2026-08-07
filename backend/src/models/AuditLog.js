import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import User from './User.js';

/**
 * Append-only audit trail for security-relevant events: logins, failed
 * logins, logouts, refresh reuse, password resets, email verification, and
 * 2FA changes. Table `audit_logs` (migration 001) — declares its own
 * `created_at` and has no `updated_at`, so automatic timestamps are off.
 */
const AuditLog = sequelize.define(
  'AuditLog',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    actor_id: { type: DataTypes.INTEGER, allowNull: true },
    tenant_id: { type: DataTypes.INTEGER, allowNull: true },
    action: { type: DataTypes.STRING(64), allowNull: false, index: true },
    entity_type: { type: DataTypes.STRING(64), allowNull: true },
    entity_id: { type: DataTypes.STRING(64), allowNull: true },
    // JSONB NOT NULL DEFAULT '{}' in migration 001 — mirror it so writes never
    // violate the constraint (the service maps null → {}).
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    ip: { type: DataTypes.STRING(64), allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    tableName: 'audit_logs',
    timestamps: false,
  }
);

AuditLog.belongsTo(User, { foreignKey: 'actor_id', as: 'actor' });

export default AuditLog;
