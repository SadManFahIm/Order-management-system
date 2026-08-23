import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * OutletMembership (migration 028) — which users can access which outlets.
 * An outlet_manager can manage their branch; staff can only operate within it.
 * The tenant_id is denormalized for fast queries (avoids a JOIN to outlets).
 */
const OutletMembership = sequelize.define(
  'OutletMembership',
  {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    user_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      index: true,
    },
    outlet_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      index: true,
    },
    tenant_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      index: true,
    },
    role: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'staff',
    },
  },
  {
    tableName: 'outlet_memberships',
    underscored: true,
    timestamps: false,
    indexes: [
      { fields: ['user_id', 'outlet_id'], unique: true },
      { fields: ['tenant_id', 'user_id'] },
    ],
  }
);

export default OutletMembership;
