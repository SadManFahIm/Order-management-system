import { AppError } from '../middleware/errorHandler.js';
import Payment from '../models/Payment.js';
import PaymentRefund from '../models/PaymentRefund.js';
import sequelize from '../config/db.js';

/**
 * Payment records (Phase 5) — bKash/Nagad/cash lifecycle.
 *
 * Tenant payment methods live in `tenant.settings.paymentMethods`:
 *   { cash: {enabled}, bkash: {enabled, number}, nagad: {enabled, number}, card: {enabled} }
 * Cash is always on by default (a restaurant that never configured anything
 * still takes cash); mobile wallets show their receiving number on the
 * storefront/order screen.
 */

export const PAYMENT_METHODS = ['cash', 'bkash', 'nagad', 'card', 'online'];

export const METHOD_LABELS = {
  cash: 'Cash',
  bkash: 'bKash',
  nagad: 'Nagad',
  card: 'Card',
  online: 'Online',
  other: 'Other',
};

/** Default config — cash on, mobile wallets + online off until enabled. */
const DEFAULT_METHODS = {
  cash: { enabled: true },
  bkash: { enabled: false, number: '' },
  nagad: { enabled: false, number: '' },
  card: { enabled: false },
  online: { enabled: false },
};

/** Reads the tenant's payment-method config from settings (never throws). */
export function paymentMethodsConfig(tenant) {
  const settings =
    tenant?.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
  const raw =
    settings.paymentMethods && typeof settings.paymentMethods === 'object'
      ? settings.paymentMethods
      : {};
  const out = {};
  for (const key of PAYMENT_METHODS) {
    const entry = raw[key] && typeof raw[key] === 'object' ? raw[key] : {};
    out[key] = { ...DEFAULT_METHODS[key], ...entry };
  }
  return out;
}

/** Array of enabled method keys, e.g. ['cash', 'bkash']. */
export function enabledPaymentMethods(tenant) {
  const config = paymentMethodsConfig(tenant);
  return PAYMENT_METHODS.filter((key) => config[key]?.enabled);
}

/** Validates a requested method against the tenant's config (fail-closed). */
export function assertMethodEnabled(tenant, method) {
  if (!method) return 'cash';
  if (!PAYMENT_METHODS.includes(method)) {
    throw new AppError(400, 'INVALID_PAYMENT_METHOD', `Unknown payment method: ${method}`);
  }
  if (!enabledPaymentMethods(tenant).includes(method)) {
    throw new AppError(
      400,
      'INVALID_PAYMENT_METHOD',
      `Payment method "${method}" is not enabled for this workspace`
    );
  }
  return method;
}

/** True when the workspace accepts online payments (hosted gateway). */
export function onlineEnabled(tenant) {
  return enabledPaymentMethods(tenant).includes('online');
}

/**
 * Validates a split-payment request against the tenant's enabled methods.
 * Each part must be an enabled non-online method with a positive amount, and
 * the parts must sum (within rounding) to the order's grand total. Throws a
 * precise AppError per violation; returns the normalized parts on success.
 */
export function validateSplits(tenant, splits, grandTotal) {
  if (!Array.isArray(splits) || splits.length < 2) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Split payments need at least two parts');
  }
  let total = 0;
  for (const part of splits) {
    if (part.method === 'online') {
      throw new AppError(400, 'SPLIT_NOT_SUPPORTED', 'Online payments cannot be split');
    }
    assertMethodEnabled(tenant, part.method);
    const amount = Number(part.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Each split amount must be a positive number');
    }
    total += amount;
  }
  const expected = Number(grandTotal);
  if (Math.abs(total - expected) > 0.01) {
    throw new AppError(
      400,
      'SPLIT_MISMATCH',
      `Split parts (৳${total.toFixed(2)}) must sum to the order total (৳${expected.toFixed(2)})`
    );
  }
  return splits.map((s) => ({
    method: s.method,
    amount: Number(s.amount),
    reference: s.reference || null,
    // Diner/table bill split (Phase 6): who this part belongs to — e.g.
    // "Rahim" when a QR table order is split across diners. Stored on the
    // payment row's `notes` so the cashier can see it in the closeout.
    note: typeof s.note === 'string' && s.note.trim() ? s.note.trim().slice(0, 80) : null,
  }));
}

/**
 * Creates the payment record(s) for a freshly placed order.
 *
 * Single payment (default): cash → paid immediately; bkash/nagad/card →
 * pending until a cashier confirms the transaction.
 *
 * Split (`splits`): one row per part (validated via validateSplits) — cash
 * parts paid on the spot, wallet parts pending. Returns an array for splits,
 * a single Payment otherwise (the online-gateway path needs the single row).
 */
export async function createPaymentForOrder(tenant, order, { method, reference, splits } = {}) {
  if (splits && splits.length > 0) {
    return Payment.bulkCreate(
      splits.map((s) => ({
        tenant_id: order.tenant_id ?? tenant.id,
        order_id: order.id,
        method: s.method,
        amount: Number(s.amount),
        status: s.method === 'cash' ? 'paid' : 'pending',
        reference: s.reference || null,
        // Diner/table bill-split label (QR table menu) — visible to cashiers.
        notes: s.note || null,
        paid_at: s.method === 'cash' ? new Date() : null,
      }))
    );
  }
  const resolved = assertMethodEnabled(tenant, method);
  const isCash = resolved === 'cash';
  return Payment.create({
    tenant_id: order.tenant_id ?? tenant.id,
    order_id: order.id,
    method: resolved,
    amount: Number(order.grand_total ?? order.total_amount ?? 0),
    status: isCash ? 'paid' : 'pending',
    reference: reference || null,
    paid_at: isCash ? new Date() : null,
  });
}

/**
 * Recomputes an order's denormalised payment_status from ALL of its payment
 * rows (single or split): fully collected → 'paid'; fully refunded with
 * nothing retained → 'refunded'; partly collected → 'partial'; any pending →
 * 'pending'; otherwise 'unpaid'. Refunds are refunded_amount-aware (a partial
 * refund keeps its retained portion counted as collected). This is what keeps
 * split AND refunded orders honest — a single PATCH re-evaluates the whole
 * picture.
 */
export async function recomputeOrderPaymentStatus(order, options = {}) {
  const all = await Payment.findAll({
    where: { order_id: order.id },
    transaction: options.transaction || null,
  });
  const total = Number(order.grand_total ?? order.total_amount ?? 0);
  let paid = 0;
  let refunded = 0;
  let hasPending = false;
  for (const p of all) {
    const amount = Number(p.amount || 0);
    if (p.status === 'paid') {
      paid += amount;
    } else if (p.status === 'refunded') {
      // Fully or partially refunded — whatever was NOT returned still counts
      // as collected; the returned portion counts as refunded.
      const returned = p.refunded_amount != null ? Number(p.refunded_amount) : amount;
      refunded += Math.min(returned, amount);
      paid += Math.max(amount - returned, 0);
    }
    if (p.status === 'pending') hasPending = true;
  }
  if (all.length === 0) {
    order.payment_status = 'unpaid';
  } else if (paid >= total - 0.01) {
    order.payment_status = 'paid';
  } else if (refunded >= total - 0.01 && paid <= 0.01) {
    order.payment_status = 'refunded';
  } else if (paid > 0.01) {
    order.payment_status = 'partial';
  } else if (hasPending) {
    order.payment_status = 'pending';
  } else {
    order.payment_status = 'unpaid';
  }
  await order.save({ transaction: options.transaction || null });
  return order;
}

/**
 * Refunds a payment — full or partial — writing a `payment_refunds` ledger
 * row and accumulating `payments.refunded_amount` (the running total). Runs
 * inside a transaction with an atomic compare-and-swap on `refunded_amount`
 * so two concurrent refunds can never over-refund: each refund's UPDATE only
 * matches the previously-read total, and a lost race throws 409.
 *
 * Supports multiple partial refunds (each adds to the ledger). Returns the
 * updated `{ payment, order }`.
 */
export async function applyRefund({ payment, order, amount, reason, actorId }) {
  const refundAmount = amount === undefined ? Number(payment.amount) : Number(amount);
  if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Refund amount must be a positive number');
  }

  return sequelize.transaction(async (transaction) => {
    // Fresh read INSIDE the transaction — the source of truth for the
    // remaining-refundable check + the CAS precondition.
    const current = await Payment.findByPk(payment.id, { transaction });
    if (!current) throw new AppError(404, 'NOT_FOUND', 'Payment not found');
    if (current.status !== 'paid' && current.status !== 'refunded') {
      throw new AppError(400, 'REFUND_NOT_ALLOWED', 'Only collected payments can be refunded');
    }

    const alreadyRefunded = Number(current.refunded_amount) || 0;
    const maxRefundable = Number(current.amount) - alreadyRefunded;
    if (refundAmount > maxRefundable + 0.001) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `Refund cannot exceed the remaining refundable amount (৳${maxRefundable.toFixed(2)})`
      );
    }
    const nextTotal = Math.round((alreadyRefunded + refundAmount) * 100) / 100;

    // Atomic compare-and-swap: only succeeds if no other refund changed
    // refunded_amount since our read. 0 affected rows = lost race → 409.
    const [affected] = await Payment.update(
      {
        status: 'refunded',
        refunded_amount: nextTotal,
        refunded_at: new Date(),
        refund_reason: reason || null,
        refunded_by: actorId || null,
      },
      {
        where: { id: current.id, refunded_amount: current.refunded_amount },
        transaction,
      }
    );
    if (affected === 0) {
      throw new AppError(409, 'REFUND_RACE', 'Another refund was processed concurrently — please retry');
    }

    await PaymentRefund.create(
      {
        tenant_id: current.tenant_id,
        payment_id: current.id,
        order_id: current.order_id,
        amount: refundAmount,
        reason: reason || null,
        status: 'processed',
        created_by: actorId || null,
        processed_at: new Date(),
      },
      { transaction }
    );

    const refreshed = await Payment.findByPk(current.id, { transaction });
    await recomputeOrderPaymentStatus(order, { transaction });
    return { payment: refreshed, order };
  });
}

/** Lists the refund ledger rows for a payment (newest first). */
export async function listPaymentRefunds(paymentId, tenantId) {
  return PaymentRefund.findAll({
    where: { payment_id: paymentId, tenant_id: tenantId },
    order: [['id', 'DESC']],
  });
}

/**
 * Confirms / refunds / fails a payment and keeps the order's payment_status
 * in sync (recomputed across ALL of the order's payments — split- and
 * refund-aware). Refunds require a previously collected (paid) payment, take
 * an optional `amount` (partial refund; default full) and `reason`, and stamp
 * the full audit fields (refunded_amount/at/reason/by). Returns the updated
 * { payment, order }.
 */
export async function applyPaymentStatus(payment, { status, reference, notes, amount, reason, actorId }, order) {
  if (!['paid', 'refunded', 'failed', 'pending'].includes(status)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid payment status');
  }

  if (status === 'refunded') {
    return applyRefund({ payment, order, amount, reason, actorId });
  }

  payment.status = status;
  if (reference !== undefined) payment.reference = reference || null;
  if (notes !== undefined) payment.notes = notes || null;
  if (status === 'paid') payment.paid_at = payment.paid_at || new Date();
  await payment.save();

  await recomputeOrderPaymentStatus(order);
  return { payment, order };
}
