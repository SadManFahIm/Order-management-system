import { DataTypes } from 'sequelize';

/**
 * 010 — Split payments + refund fields + reconciliation (Phase 6).
 *
 * The `payments` table already allows multiple rows per order (no unique
 * order_id), so split payment is purely additive at the schema level: a
 * merchant can take e.g. bKash ৳300 + Cash ৳200 against one order, and the
 * closeout's by-method breakdown counts each row. This migration adds the
 * columns the split/refund/reconciliation lifecycle needs:
 *
 *   - refunded_amount / refunded_at / refund_reason / refunded_by — full or
 *     partial refund audit trail (who, when, how much, why).
 *   - intent_ref / expires_at — the gateway's payment-intent reference and
 *     the expiry window the reconciliation job uses to auto-expire stale
 *     pending payments (online sessions that were never completed).
 *
 * No data is rewritten or dropped — purely additive columns.
 */
const t = (transaction) => ({ transaction });

export const up = async (qi, transaction) => {
  await qi.addColumn(
    'payments',
    'refunded_amount',
    {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      comment: 'Amount refunded (full = amount, partial = < amount)',
    },
    t(transaction)
  );
  await qi.addColumn(
    'payments',
    'refunded_at',
    {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'When the refund was recorded',
    },
    t(transaction)
  );
  await qi.addColumn(
    'payments',
    'refund_reason',
    {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Why the payment was refunded (merchant-entered)',
    },
    t(transaction)
  );
  await qi.addColumn(
    'payments',
    'refunded_by',
    {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'User id that recorded the refund',
    },
    t(transaction)
  );
  await qi.addColumn(
    'payments',
    'intent_ref',
    {
      type: DataTypes.STRING(120),
      allowNull: true,
      comment: 'Gateway payment-intent reference (reconciliation)',
    },
    t(transaction)
  );
  await qi.addColumn(
    'payments',
    'expires_at',
    {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Stale-payment expiry window (reconciliation auto-expire)',
    },
    t(transaction)
  );
  await qi.addIndex('payments', ['tenant_id', 'status', 'expires_at'], {
    name: 'payments_tenant_status_expires',
    ...t(transaction),
  });
};

export const down = async (qi, transaction) => {
  await qi.removeIndex('payments', 'payments_tenant_status_expires', t(transaction));
  for (const col of ['refunded_amount', 'refunded_at', 'refund_reason', 'refunded_by', 'intent_ref', 'expires_at']) {
    await qi.removeColumn('payments', col, t(transaction));
  }
};
