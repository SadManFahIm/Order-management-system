import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * Daily analytics rollup (Phase 7). Table `daily_stats` (migration 011):
 * one pre-aggregated row per tenant + Dhaka day so the dashboard trend can
 * be served from a bounded read. Fields mirror the migration DDL exactly —
 * the drift test guards the mapping.
 */
const DailyStat = sequelize.define(
  'DailyStat',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tenant_id: { type: DataTypes.INTEGER, allowNull: false },
    stat_date: { type: DataTypes.DATEONLY, allowNull: false },
    revenue: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    orders: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    method_mix: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    peak_hours: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    category_mix: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  },
  {
    tableName: 'daily_stats',
    underscored: true,
    indexes: [{ fields: ['tenant_id', 'stat_date'], unique: true }],
  }
);

export default DailyStat;
