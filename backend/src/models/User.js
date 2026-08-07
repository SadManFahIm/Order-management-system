import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * Platform user. Table `users` (migration 001) — column `password_hash`
 * maps to the v1 attribute `password` so app code keeps its public name.
 * Note: the migration creates `id BIGINT`; the model declares INTEGER, which
 * PostgreSQL casts transparently (int4 params bind into int8 columns) and
 * SQLite treats identically. Keeping INTEGER avoids bigint-as-string parsing
 * surprises on the pg driver.
 */
const User = sequelize.define(
  'User',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    email: { type: DataTypes.STRING(255), unique: true, allowNull: false },
    // v1 column was `password`; migrations rename it to `password_hash`.
    password: { type: DataTypes.STRING(255), allowNull: false, field: 'password_hash' },
    // Platform-level role: platform_admin | member | customer
    // (per-restaurant roles live in the UserTenants join table)
    platform_role: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'member',
    },
    email_verified_at: { type: DataTypes.DATE, allowNull: true },
    // TOTP two-factor authentication (RFC 6238)
    two_factor_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    two_factor_secret: { type: DataTypes.STRING(255), allowNull: true },
  },
  {
    tableName: 'users',
    // created_at / updated_at (migration 001). deleted_at is created by the
    // migration but unused by the model (no paranoid delete in v1-era flows).
    underscored: true,
  }
);

export default User;
