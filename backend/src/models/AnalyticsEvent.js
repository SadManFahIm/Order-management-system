import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * AnalyticsEvent. Table `analytics_events` (migration 027) — the minimal
 * funnel event stream for the storefront journey:
 *
 *   menu_view      → Browse stage
 *   add_to_cart    → Cart stage
 *   checkout_start → Checkout stage
 *
 * The Paid stage comes from orders (payment_status='paid') tied back to a
 * journey via `orders.analytics_session`. The funnel counts DISTINCT
 * sessions per stage, so repeated events from one session never
 * double-count. Append-only: rows are written by the public ingestion
 * endpoint and read by the analytics service — nothing updates them.
 */
const AnalyticsEvent = sequelize.define(
  'AnalyticsEvent',
  {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      index: true,
    },
    // Anonymous browser session id (client-minted, per restaurant).
    session_id: { type: DataTypes.STRING(64), allowNull: false },
    // menu_view | add_to_cart | checkout_start
    event_type: { type: DataTypes.STRING(24), allowNull: false },
    product_id: { type: DataTypes.INTEGER, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    tableName: 'analytics_events',
    underscored: true,
    timestamps: false,
    updatedAt: false,
  }
);

export default AnalyticsEvent;
