/**
 * 015 — Hot-query indexes (dashboard / closeout / reports).
 *
 * The analytics paths (dashboard trend, daily closeout, VAT report, rollup)
 * filter orders and payments by `tenant_id` + a Dhaka-day `created_at`
 * range. `orders` already carries an index on (tenant_id, payment_method)
 * and `payments` on (tenant_id, method)/(tenant_id, status), but the
 * day-range scans were unindexed — on a busy workspace each closeout re-scan
 * the tenant's whole history. These two composite indexes cover the range
 * filter directly. Purely additive: no columns, no behavior change.
 */
export const up = async (qi, transaction) => {
  const t = { transaction };
  await qi.addIndex('orders', ['tenant_id', 'created_at'], {
    ...t,
    name: 'ix_orders_tenant_created_at',
  });
  await qi.addIndex('payments', ['tenant_id', 'created_at'], {
    ...t,
    name: 'ix_payments_tenant_created_at',
  });
};

export const down = async (qi, transaction) => {
  const t = { transaction };
  await qi.removeIndex('orders', 'ix_orders_tenant_created_at', t);
  await qi.removeIndex('payments', 'ix_payments_tenant_created_at', t);
};
