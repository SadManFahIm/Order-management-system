import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, unique: true, allowNull: false },
  password: { type: DataTypes.STRING, allowNull: false },
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
});

export default User;
