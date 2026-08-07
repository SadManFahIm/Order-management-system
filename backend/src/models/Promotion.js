import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * Promotion. Table `promotions` (migration 004): v1 `enabled` maps to the
 * `is_enabled` column; `type` is a STRING(16) in the migration (the v1 ENUM
 * is kept as a plain string so the migration schema needs no enum type).
 */
const Promotion = sequelize.define(
  'Promotion',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    // Multi-tenant scoping (Phase 3).
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      index: true,
    },
    title: { type: DataTypes.STRING(200), allowNull: false },
    type: {
      type: DataTypes.STRING(16),
      allowNull: false,
    },
    percentage_value: { type: DataTypes.FLOAT },
    fixed_value: { type: DataTypes.FLOAT },
    start_date: { type: DataTypes.DATEONLY, allowNull: false },
    end_date: { type: DataTypes.DATEONLY, allowNull: false },
    enabled: { type: DataTypes.BOOLEAN, defaultValue: true, field: 'is_enabled' },
  },
  {
    tableName: 'promotions',
    underscored: true,
  }
);

export default Promotion;
