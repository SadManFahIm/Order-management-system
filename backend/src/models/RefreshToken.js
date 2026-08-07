import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import User from './User.js';

/**
 * Refresh tokens are stored as SHA-256 hashes so a database leak does not
 * expose usable tokens. Tokens belong to a "family": rotating issues a new
 * token in the same family; reusing a revoked token is treated as theft and
 * revokes the entire family. Table `refresh_tokens` (migration 001) — has
 * `created_at` but no `updated_at`; `family_id` is a UUID column on PG.
 */
const RefreshToken = sequelize.define(
  'RefreshToken',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    token_hash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    family_id: { type: DataTypes.STRING(36), allowNull: false, index: true },
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    revoked_at: { type: DataTypes.DATE, allowNull: true },
    replaced_by_token_id: { type: DataTypes.INTEGER, allowNull: true },
    created_by_ip: { type: DataTypes.STRING(64), allowNull: true },
    user_agent: { type: DataTypes.STRING(255), allowNull: true },
  },
  {
    tableName: 'refresh_tokens',
    createdAt: 'created_at',
    updatedAt: false,
  }
);

RefreshToken.belongsTo(User, { foreignKey: 'user_id' });

export default RefreshToken;
