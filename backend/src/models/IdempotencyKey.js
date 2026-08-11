import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * Idempotency record (migration 012) — DB-level retry guard for order
 * creation. The unique (tenant_id, user_id, key) index is the guarantee:
 * two concurrent requests carrying the same key can never both insert, so
 * exactly one order is created even across application instances.
 *
 * Guests (public storefront checkout) use user_id = 0. `response` holds the
 * serialized { statusCode, body } that is replayed for repeated keys.
 */
const IdempotencyKey = sequelize.define(
  'IdempotencyKey',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tenant_id: { type: DataTypes.INTEGER, allowNull: false },
    user_id: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    key: { type: DataTypes.STRING(128), allowNull: false },
    request_hash: { type: DataTypes.STRING(64), allowNull: false },
    status_code: { type: DataTypes.INTEGER, allowNull: true },
    response: { type: DataTypes.JSONB, allowNull: true },
    expires_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    tableName: 'idempotency_keys',
    underscored: true,
    // Matches migration 012's unique index — the DB-level guarantee that two
    // concurrent same-key requests cannot both create an order. Declared on
    // the model so sync()-shaped test databases enforce it too.
    indexes: [{ unique: true, fields: ['tenant_id', 'user_id', 'key'] }],
  }
);

export default IdempotencyKey;
