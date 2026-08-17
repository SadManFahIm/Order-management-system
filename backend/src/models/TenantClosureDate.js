import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * Restaurant-wide closure date (Phase 4 follow-up). Table
 * `tenant_closure_dates` (migration 023): one row per tenant + date that
 * closes the WHOLE storefront that day (holidays, private events) — the
 * public menu is hidden and checkout is rejected with RESTAURANT_CLOSED.
 * Scheduled orders are validated against the scheduled date, so a closure
 * blocks scheduled orders for that day too. Unique per (tenant, date).
 */
const TenantClosureDate = sequelize.define(
  'TenantClosureDate',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tenant_id: { type: DataTypes.INTEGER, allowNull: false, index: true },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    // Optional human name for the closure day (migration 024) — presentational
    // only; availability resolution never reads it.
    label: { type: DataTypes.STRING(120), allowNull: true },
  },
  {
    tableName: 'tenant_closure_dates',
    underscored: true,
    indexes: [{ fields: ['tenant_id', 'date'], unique: true }],
  }
);

export default TenantClosureDate;
