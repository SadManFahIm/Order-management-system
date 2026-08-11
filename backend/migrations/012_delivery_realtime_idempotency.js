import { DataTypes } from 'sequelize';

/**
 * 012 — Delivery orders, schedule, assignment, kitchen reject + idempotency
 * (Phase 5 completion: storefront checkout / delivery / realtime / retry-safe
 * order creation).
 *
 * The v1-era `orders` schema (migration 004) already carried delivery-ready
 * columns that the app never exposed: `scheduled_for`, `delivery_fee`,
 * `assigned_to`, `delivery_address` (+ lat/lng). This migration activates
 * that surface instead of duplicating it:
 *
 *   - `type` widened 16 → 24 to fit 'scheduled_delivery' (existing rows keep
 *     their value; existing behavior is untouched).
 *   - indexes on `assigned_to` (delivery queue lookups) and `scheduled_for`
 *     (scheduled-order scans) — no column duplicates.
 *   - `rejected_reason` / `rejected_by` — kitchen reject audit trail.
 *
 * idempotency_keys:
 *   DB-level retry guard for order creation — the unique
 *   (tenant_id, user_id, key) constraint guarantees that two concurrent
 *   requests with the same key cannot both create an order, even across
 *   application instances. Guests use user_id = 0.
 */
export const up = async (qi, transaction) => {
  const t = { transaction };

  // SQLite does not enforce VARCHAR length, so the widen is a no-op there and
  // changeColumn would trigger a locked table rebuild inside the transaction.
  // PostgreSQL (production) genuinely needs the column widened for the
  // 'scheduled_delivery' literal (18 chars > 16).
  if (qi.sequelize.getDialect() !== 'sqlite') {
    await qi.changeColumn(
      'orders',
      'type',
      { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'pickup' },
      t
    );
  }
  await qi.addColumn('orders', 'rejected_reason', {
    type: DataTypes.STRING(255),
    allowNull: true,
    ...t,
  });
  await qi.addColumn('orders', 'rejected_by', {
    type: DataTypes.INTEGER,
    allowNull: true,
    ...t,
  });
  await qi.addIndex('orders', ['assigned_to'], {
    name: 'orders_assigned_to',
    ...t,
  });
  await qi.addIndex('orders', ['scheduled_for'], {
    name: 'orders_scheduled_for',
    ...t,
  });

  await qi.createTable(
    'idempotency_keys',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      tenant_id: { type: DataTypes.INTEGER, allowNull: false },
      // 0 = anonymous guest checkout; authenticated users carry their id.
      user_id: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      key: { type: DataTypes.STRING(128), allowNull: false },
      request_hash: { type: DataTypes.STRING(64), allowNull: false },
      // Stored response (statusCode + body) replayed for repeated keys.
      status_code: { type: DataTypes.INTEGER, allowNull: true },
      response: { type: DataTypes.JSONB, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    },
    t
  );
  await qi.addIndex('idempotency_keys', ['tenant_id', 'user_id', 'key'], {
    name: 'idempotency_keys_scope_key',
    unique: true,
    ...t,
  });
  await qi.addIndex('idempotency_keys', ['expires_at'], {
    name: 'idempotency_keys_expires',
    ...t,
  });
};

export const down = async (qi, transaction) => {
  const t = { transaction };
  await qi.dropTable('idempotency_keys', t);
  await qi.removeIndex('orders', 'orders_scheduled_for', t);
  await qi.removeIndex('orders', 'orders_assigned_to', t);
  await qi.removeColumn('orders', 'rejected_by', t);
  await qi.removeColumn('orders', 'rejected_reason', t);
  if (qi.sequelize.getDialect() !== 'sqlite') {
    await qi.changeColumn(
      'orders',
      'type',
      { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pickup' },
      t
    );
  }
};
