import { DataTypes } from 'sequelize';

/**
 * 026 — Payments upgrade (Phase 6).
 *
 * Gateway verification + refund ledger + settlement tracking + tips.
 *
 *   orders.tip_amount            — optional tip on delivery orders; kept
 *     separate from item subtotal / VAT / discount / delivery fee so it never
 *     becomes food revenue. Included in grand_total (the amount charged).
 *
 *   payments.gateway             — which online gateway confirmed the payment
 *     (sslcommerz | stripe | bkash), recorded on auto-confirmation.
 *   payments.verification_metadata — gateway verification record as JSON:
 *     { gateway, transactionStatus, trxID, amount, currency, verifiedAt,
 *       method } — proves the callback/execute round-trip and amount match.
 *
 *   payment_refunds             — refund ledger. A refund is a row here, not
 *     just a flag on the payment, so multiple partial refunds are auditable
 *     and concurrent refunds cannot over-refund (amounts checked inside a
 *     transaction against the running total).
 *
 *   settlements                 — gateway → bank settlement/withdrawal
 *     tracking. A settlement is movement of money from the gateway wallet to
 *     the merchant's bank account — NEVER revenue. Each row carries the
 *     gateway settlement id, requested/settled/fees/net amounts, currency,
 *     status (pending|processing|completed|failed|reversed), and optional
 *     bank reference.
 */
export const up = async (qi, transaction) => {
  const t = { transaction };

  // --- addColumn BEFORE createTable (SQLite SQLITE_BUSY avoidance) ---
  await qi.addColumn('orders', 'tip_amount', {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
    ...t,
  });

  await qi.addColumn('payments', 'gateway', {
    type: DataTypes.STRING(16),
    allowNull: true,
    ...t,
  });
  await qi.addColumn('payments', 'verification_metadata', {
    type: DataTypes.JSONB,
    allowNull: true,
    ...t,
  });

  // --- Refund ledger ---
  await qi.createTable(
    'payment_refunds',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      payment_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'payments', key: 'id' },
        onDelete: 'CASCADE',
      },
      order_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'orders', key: 'id' },
        onDelete: 'CASCADE',
      },
      amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      reason: { type: DataTypes.STRING(255), allowNull: true },
      // processed | failed — a ledger row is written optimistically and only
      // ever marked failed if the surrounding transaction rolls back.
      status: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'processed',
      },
      created_by: { type: DataTypes.INTEGER, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: qi.sequelize.literal('CURRENT_TIMESTAMP') },
      processed_at: { type: DataTypes.DATE, allowNull: true },
    },
    { ...t, indexes: [{ fields: ['tenant_id', 'payment_id'] }, { fields: ['order_id'] }] }
  );

  // --- Settlement / withdrawal tracking ---
  await qi.createTable(
    'settlements',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      tenant_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'tenants', key: 'id' },
        onDelete: 'CASCADE',
      },
      // sslcommerz | stripe | bkash | other
      gateway: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'other' },
      // Gateway/bank settlement identifier (unique per tenant when known).
      settlement_id: { type: DataTypes.STRING(120), allowNull: true },
      requested_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      settled_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      fees: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      net_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      currency: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'BDT' },
      // pending | processing | completed | failed | reversed
      status: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'pending',
      },
      bank_ref: { type: DataTypes.STRING(120), allowNull: true },
      requested_at: { type: DataTypes.DATE, allowNull: false, defaultValue: qi.sequelize.literal('CURRENT_TIMESTAMP') },
      processed_at: { type: DataTypes.DATE, allowNull: true },
      created_by: { type: DataTypes.INTEGER, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: qi.sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: qi.sequelize.literal('CURRENT_TIMESTAMP') },
    },
    {
      ...t,
      indexes: [
        { fields: ['tenant_id'] },
        { fields: ['tenant_id', 'status'] },
        { fields: ['tenant_id', 'settlement_id'] },
      ],
    }
  );
};

export const down = async (qi, transaction) => {
  const t = { transaction };
  await qi.dropTable('settlements', t);
  await qi.dropTable('payment_refunds', t);
  await qi.removeColumn('payments', 'verification_metadata', t);
  await qi.removeColumn('payments', 'gateway', t);
  await qi.removeColumn('orders', 'tip_amount', t);
};