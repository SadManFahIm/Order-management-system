import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import User from './User.js';

/**
 * Short-lived, single-use, hashed tokens used for email verification and
 * password reset flows.
 */
const AuthToken = sequelize.define('AuthToken', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  // 'email_verification' | 'password_reset'
  type: { type: DataTypes.STRING(32), allowNull: false, index: true },
  token_hash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  expires_at: { type: DataTypes.DATE, allowNull: false },
  used_at: { type: DataTypes.DATE, allowNull: true },
});

AuthToken.belongsTo(User, { foreignKey: 'user_id' });

export default AuthToken;
