import { Op } from 'sequelize';
import Payment from '../models/Payment.js';
import Order from '../models/Order.js';
import { recomputeOrderPaymentStatus } from './paymentsService.js';

/**
 * Payment reconciliation (Phase 6) — auto-expires stale online payment
 * intents so pending orders never hang forever.
 *
 * Hosted-checkout payments (SSLCommerz / Stripe / bKash) get an
 * `expires_at` window at creation (default 30 min). If the customer never
 * completes the checkout, the reconciliation tick flips those payments to
 * `expired` and re-evaluates the order's payment_status (→ unpaid, since
 * nothing was collected). Manual wallet payments (bKash/Nagad confirmed by
 * a cashier at the counter) are deliberately left alone — the cashier may
 * confirm them any time.
 */
export const RECONCILIATION_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** Expires stale online intents and re-syncs their orders. Returns count. */
export async function runPaymentReconciliation(now = new Date()) {
  const stale = await Payment.findAll({
    where: {
      method: 'online',
      status: 'pending',
      expires_at: { [Op.lt]: now },
    },
  });

  const orderIds = new Set(stale.map((p) => p.order_id));
  for (const p of stale) {
    p.status = 'expired';
    p.notes = p.notes ? `${p.notes}; Auto-expired by reconciliation` : 'Auto-expired by reconciliation';
    await p.save();
  }
  for (const id of orderIds) {
    const order = await Order.findByPk(id);
    if (order) await recomputeOrderPaymentStatus(order);
  }

  if (stale.length > 0) {
    console.log(`[reconciliation] expired ${stale.length} stale online payment(s) (${orderIds.size} order(s))`);
  }
  return stale.length;
}

/** Per-minute tick. `unref()` keeps it from holding the process open. */
export function startReconciliationScheduler({ intervalMs = 60_000 } = {}) {
  const timer = setInterval(() => {
    runPaymentReconciliation().catch((e) =>
      console.error(`[reconciliation] tick failed: ${e.message}`)
    );
  }, intervalMs);
  timer.unref?.();
  console.log(`[reconciliation] stale-payment scheduler started (every ${intervalMs}ms)`);
  return timer;
}
