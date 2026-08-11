import { DataTypes } from 'sequelize';

/**
 * 012 — Delivery orders, schedule, assignment, kitchen reject + idempotency
 * (Phase 5 completion: storefront checkout / delivery / realtime / retry-safe
 * order creation).
 *
 * The v1-era `orders` schema (migration 004) carried delivery-ready columns
 * (`scheduled_for`, `delivery_fee`, `assigned_to`) — but legacy dev databases
 * that were `sync()`-shaped before the migration era may lack them entirely.
 * This migration therefore ADDS them if missing (existence-guarded), widens
 * `type` for 'scheduled_delivery' on PostgreSQL, adds kitchen reject audit
 * fields + indexes, and creates the idempotency_keys table.
 *
 * Why guards: SQLite DDL is not transactional (ALTER TABLE auto-commits), so
 * a mid-migration failure can leave partial state that a re-run must survive.
 * Every operation below checks first — safe on fresh DBs, migrations-built
 * DBs (columns already present from 004) and legacy/partially-migrated DBs.
 */
export const up = async (qi, transaction) => {
  const t = { transaction };
  const dialect = qi.sequelize.getDialect();

  // SQLite does not enforce VARCHAR length, so the widen is a no-op there and
  // changeColumn would trigger a locked table rebuild inside the transaction.
  if (dialect !== 'sqlite') {
    await qi.changeColumn(
      'orders',
      'type',
      { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'pickup' },
      t
    );
  }

  // IMPORTANT: introspection must run INSIDE the migration transaction.
  // PostgreSQL: changeColumn above took an AccessExclusiveLock on `orders`,
  // held until commit — a describeTable on a SECOND pooled connection would
  // need AccessShareLock on the same table and block forever (self-deadlock:
  // the transaction can't commit until up() resolves). Passing the
  // transaction pins these queries to the same connection/lock holder.
  const orderCols = await qi.describeTable('orders', t);
  const addCol = async (name, def) => {
    if (!(name in orderCols)) await qi.addColumn('orders', name, def, t);
  };
  await addCol('scheduled_for', { type: DataTypes.DATE, allowNull: true });
  await addCol('delivery_fee', {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0,
  });
  await addCol('assigned_to', { type: DataTypes.INTEGER, allowNull: true });
  await addCol('rejected_reason', { type: DataTypes.STRING(255), allowNull: true });
  await addCol('rejected_by', { type: DataTypes.INTEGER, allowNull: true });

  // Same transaction-pinning rule as describeTable above.
  const existingIndexes = await qi.showIndex('orders', t);
  const hasIndex = (name) => existingIndexes.some((i) => i.name === name);
  if (!hasIndex('orders_assigned_to')) {
    await qi.addIndex('orders', ['assigned_to'], { name: 'orders_assigned_to', ...t });
  }
  if (!hasIndex('orders_scheduled_for')) {
    await qi.addIndex('orders', ['scheduled_for'], { name: 'orders_scheduled_for', ...t });
  }

  if (!(await qi.tableExists('idempotency_keys', t))) {
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
  }
  const idemIndexes = await qi.showIndex('idempotency_keys', t);
  if (!idemIndexes.some((i) => i.name === 'idempotency_keys_scope_key')) {
    await qi.addIndex('idempotency_keys', ['tenant_id', 'user_id', 'key'], {
      name: 'idempotency_keys_scope_key',
      unique: true,
      ...t,
    });
  }
  if (!idemIndexes.some((i) => i.name === 'idempotency_keys_expires')) {
    await qi.addIndex('idempotency_keys', ['expires_at'], {
      name: 'idempotency_keys_expires',
      ...t,
    });
  }
};

export const down = async (qi, transaction) => {
  const t = { transaction };
  if (await qi.tableExists('idempotency_keys', t)) {
    await qi.dropTable('idempotency_keys', t);
  }
  // Transaction-pinned introspection — see the note in up().
  const existingIndexes = await qi.showIndex('orders', t);
  if (existingIndexes.some((i) => i.name === 'orders_scheduled_for')) {
    await qi.removeIndex('orders', 'orders_scheduled_for', t);
  }
  if (existingIndexes.some((i) => i.name === 'orders_assigned_to')) {
    await qi.removeIndex('orders', 'orders_assigned_to', t);
  }
  // Only columns this migration always owns are removed. scheduled_for /
  // delivery_fee / assigned_to belong to migration 004 on migrations-built
  // databases (and were merely backfilled by 012 on legacy dev databases —
  // leaving them is harmless there and keeps the app functional after rollback).
  const orderCols = await qi.describeTable('orders', t);
  for (const col of ['rejected_by', 'rejected_reason']) {
    if (col in orderCols) await qi.removeColumn('orders', col, t);
  }
  if (qi.sequelize.getDialect() !== 'sqlite') {
    await qi.changeColumn(
      'orders',
      'type',
      { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pickup' },
      t
    );
  }
};
