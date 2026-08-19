import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * Gateway → bank settlement / withdrawal record. Table `settlements`
 * (migration 026).
 *
 * A settlement is movement of money FROM the merchant's gateway wallet TO
 * their bank account — it is NEVER revenue. Keeping it a first-class record
 * lets the admin see: customer payments → gateway wallet balance → settlement
 * → bank, without double-counting settlements as sales.
 */
const Settlement = sequelize.define(
  'Settlement',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    // Multi-tenant scoping (Phase 3).
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      index: true,
    },
    // sslcommerz | stripe | bkash | other
    gateway: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'other',
    },
    // Gateway/bank settlement identifier (when known).
    settlement_id: { type: DataTypes.STRING(120), allowNull: true },
    requested_amount: { type: DataTypes.FLOAT, allowNull: false },
    settled_amount: { type: DataTypes.FLOAT, allowNull: true },
    fees: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    net_amount: { type: DataTypes.FLOAT, allowNull: true },
    currency: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'BDT' },
    // pending | processing | completed | failed | reversed
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'pending',
    },
    bank_ref: { type: DataTypes.STRING(120), allowNull: true },
    requested_at: { type: DataTypes.DATE, allowNull: false },
    processed_at: { type: DataTypes.DATE, allowNull: true },
    created_by: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    tableName: 'settlements',
    underscored: true,
  }
);

export default Settlement;