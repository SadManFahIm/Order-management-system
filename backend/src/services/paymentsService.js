import { AppError } from '../middleware/errorHandler.js';
import Payment from '../models/Payment.js';

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
export async function recomputeOrderPaymentStatus(order) {
  const all = await Payment.findAll({ where: { order_id: order.id } });
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
  await order.save();
  return order;
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
    if (payment.status !== 'paid' && payment.status !== 'refunded') {
      throw new AppError(400, 'REFUND_NOT_ALLOWED', 'Only collected payments can be refunded');
    }
    const refundAmount = amount === undefined ? Number(payment.amount) : Number(amount);
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Refund amount must be a positive number');
    }
    if (refundAmount > Number(payment.amount)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Refund cannot exceed the payment amount');
    }
    payment.status = 'refunded';
    payment.refunded_amount = refundAmount;
    payment.refunded_at = new Date();
    payment.refund_reason = reason || null;
    payment.refunded_by = actorId || null;
  } else {
    payment.status = status;
    if (reference !== undefined) payment.reference = reference || null;
    if (notes !== undefined) payment.notes = notes || null;
    if (status === 'paid') payment.paid_at = payment.paid_at || new Date();
  }
  await payment.save();

  await recomputeOrderPaymentStatus(order);
  return { payment, order };
}
