import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * Order. Table `orders` (migration 004) with v1-era money columns mapped to
 * the V2 names:
 *   subtotal       → subtotal_amount
 *   total_discount → discount_amount
 *   grand_total    → total_amount
 * customer_name/phone/address are bridged by migration 005 (the migration
 * orders table also carries order_no/status/type/payment_status which the
 * route populates or the DB defaults provide).
 */
const Order = sequelize.define(
  'Order',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    // Multi-tenant scoping (Phase 3).
    tenant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      index: true,
    },
    // order_no is NOT NULL with no DB default in migration 004 — the route
    // generates it, and the attribute MUST be declared or Sequelize silently
    // drops it from the INSERT (and the DB rejects the row).
    order_no: { type: DataTypes.STRING(40), allowNull: false },
    customer_name: { type: DataTypes.STRING(255), allowNull: false },
    customer_phone: { type: DataTypes.STRING(30) },
    // Optional email for the ticket-styled order confirmation (migration 014).
    customer_email: { type: DataTypes.STRING(255), allowNull: true },
    customer_address: { type: DataTypes.TEXT },
    subtotal: { type: DataTypes.FLOAT, allowNull: false, field: 'subtotal_amount' },
    total_discount: { type: DataTypes.FLOAT, allowNull: false, field: 'discount_amount' },
    grand_total: { type: DataTypes.FLOAT, allowNull: false, field: 'total_amount' },
    // Fulfillment lifecycle (Phase 5 foundation). Columns exist in migration
    // 004 with sensible defaults; the model declares them so the attributes
    // are read/written by Sequelize.
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'placed',
    },
    type: {
      type: DataTypes.STRING(24),
      allowNull: false,
      defaultValue: 'pickup',
    },
    // Delivery/schedule fields (storefront checkout, Phase 5) — the v1-era
    // columns from migration 004 that the app now exposes:
    //   scheduled_at → scheduled_for (requested pickup/delivery time)
    //   delivery_fee  (server-computed fee for delivery orders)
    //   assigned_to   (delivery person user id)
    scheduled_at: { type: DataTypes.DATE, allowNull: true, field: 'scheduled_for' },
    delivery_fee: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    assigned_to: { type: DataTypes.INTEGER, allowNull: true },
    // Kitchen reject audit trail (migration 012).
    rejected_reason: { type: DataTypes.STRING(255), allowNull: true },
    rejected_by: { type: DataTypes.INTEGER, allowNull: true },
    // Cancellation reason + actor (migration 025) — managers cancel with a
    // reason (no-show / customer_canceled / stock / etc.), mirroring reject.
    cancel_reason: { type: DataTypes.STRING(255), allowNull: true },
    canceled_by: { type: DataTypes.INTEGER, allowNull: true },
    // Delivery auto-assignment (migration 025): optional zone name the order
    // belongs to; auto-assign picks a least-loaded rider covering that zone.
    delivery_zone: { type: DataTypes.STRING(64), allowNull: true },
    // KDS (migration 025): prep_started_at is set on `preparing` and drives
    // the prep timer + overdue highlight; bumped_at marks a ready order that
    // the kitchen bumped into the pickup bar.
    prep_started_at: { type: DataTypes.DATE, allowNull: true },
    bumped_at: { type: DataTypes.DATE, allowNull: true },
    payment_status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'unpaid',
    },
    // Physical table for dine-in orders (QR table menu, migration 007).
    // Validated against the workspace's tables at creation, but stored
    // denormalised so history survives table renames/deletes.
    table_no: { type: DataTypes.INTEGER, allowNull: true },
    // Payment method (cash | bkash | nagad | card | other), migration 008.
    // Denormalised snapshot — a payment record lives in `payments` with its
    // own status/reference lifecycle.
    payment_method: { type: DataTypes.STRING(16), allowNull: true },
  },
  {
    tableName: 'orders',
    underscored: true,
  }
);

export default Order;
