import { DataTypes } from 'sequelize';

/**
 * 025 — Ordering & fulfillment (Phase 5 follow-up round).
 *
 * Order editing (approval flow), delivery auto-assignment (zone + load),
 * KDS (bump bar / prep timer / overdue), and cancellation reasons.
 *
 *   orders.cancel_reason      — required reason when a manager cancels an
 *     order (mirrors the existing rejected_reason pattern).
 *   orders.canceled_by        — actor id for the cancellation.
 *   orders.delivery_zone      — optional zone name a delivery order belongs
 *     to; used by auto-assignment to pick an in-zone rider.
 *   orders.prep_started_at    — set when the kitchen moves an order to
 *     `preparing`; drives the KDS prep timer + overdue highlight.
 *   orders.bumped_at          — set when the kitchen "bumps" a ready order
 *     into the pickup bar.
 *
 *   order_edit_requests       — pending edit requests on placed orders
 *     (customer/staff add/remove items) that a manager approves/rejects.
 *     The live order stays immutable until approval.
 *
 *   delivery_zones            — per-tenant zone catalogue for auto-assign.
 *   user_tenants.delivery_zones — which zones a delivery member covers
 *     (JSON array of names; NULL/empty = covers all zones).
 */
export const up = async (qi, transaction) => {
  const t = { transaction };

  // --- Order columns (fulfillment + cancellation + KDS) ---
  await qi.addColumn('orders', 'cancel_reason', {
    type: DataTypes.STRING(255),
    allowNull: true,
    ...t,
  });
  await qi.addColumn('orders', 'canceled_by', {
    type: DataTypes.INTEGER,
    allowNull: true,
    ...t,
  });
  await qi.addColumn('orders', 'delivery_zone', {
    type: DataTypes.STRING(64),
    allowNull: true,
    ...t,
  });
  await qi.addColumn('orders', 'prep_started_at', {
    type: DataTypes.DATE,
    allowNull: true,
    ...t,
  });
  await qi.addColumn('orders', 'bumped_at', {
    type: DataTypes.DATE,
    allowNull: true,
    ...t,
  });

  // --- Rider zone coverage ---
  await qi.addColumn('user_tenants', 'delivery_zones', {
    type: DataTypes.JSONB,
    allowNull: true,
    ...t,
  });

  // --- Delivery zone catalogue ---
  await qi.createTable(
    'delivery_zones',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      name: { type: DataTypes.STRING(64), allowNull: false },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { ...t, indexes: [{ fields: ['tenant_id'] }] }
  );

  // --- Order edit requests ---
  await qi.createTable(
    'order_edit_requests',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      order_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'orders', key: 'id' },
        onDelete: 'CASCADE',
      },
      // Staff actor (NULL for a customer-initiated request).
      requested_by: { type: DataTypes.INTEGER, allowNull: true },
      // Customer identity for the public edit-request path (order-no + phone).
      customer_phone: { type: DataTypes.STRING(30), allowNull: true },
      // pending | approved | rejected
      status: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'pending',
      },
      reason: { type: DataTypes.STRING(255), allowNull: true },
      // Requested line items as JSON: [{ product_id, quantity }]. The live
      // order is untouched until a manager approves.
      requested_items: { type: DataTypes.JSON, allowNull: false },
      decided_by: { type: DataTypes.INTEGER, allowNull: true },
      decision_note: { type: DataTypes.STRING(255), allowNull: true },
      decided_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { ...t, indexes: [{ fields: ['tenant_id', 'order_id'] }] }
  );
};

export const down = async (qi, transaction) => {
  const t = { transaction };
  await qi.dropTable('order_edit_requests', t);
  await qi.removeColumn('user_tenants', 'delivery_zones', t);
  await qi.dropTable('delivery_zones', t);
  await qi.removeColumn('orders', 'bumped_at', t);
  await qi.removeColumn('orders', 'prep_started_at', t);
  await qi.removeColumn('orders', 'delivery_zone', t);
  await qi.removeColumn('orders', 'canceled_by', t);
  await qi.removeColumn('orders', 'cancel_reason', t);
};
