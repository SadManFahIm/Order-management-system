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

export const PAYMENT_METHODS = ['cash', 'bkash', 'nagad', 'card'];

export const METHOD_LABELS = {
  cash: 'Cash',
  bkash: 'bKash',
  nagad: 'Nagad',
  card: 'Card',
  other: 'Other',
};

/** Default config — cash on, mobile wallets off until enabled. */
const DEFAULT_METHODS = {
  cash: { enabled: true },
  bkash: { enabled: false, number: '' },
  nagad: { enabled: false, number: '' },
  card: { enabled: false },
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

/**
 * Creates the payment record for a freshly placed order.
 * cash → paid immediately; bkash/nagad/card → pending until a cashier
 * confirms the transaction.
 */
export async function createPaymentForOrder(tenant, order, { method, reference } = {}) {
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
 * Confirms / refunds / fails a payment and keeps the order's payment_status
 * in sync. Returns the updated { payment, order }.
 */
export async function applyPaymentStatus(payment, { status, reference, notes }, order) {
  if (!['paid', 'refunded', 'failed', 'pending'].includes(status)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid payment status');
  }

  payment.status = status;
  if (reference !== undefined) payment.reference = reference || null;
  if (notes !== undefined) payment.notes = notes || null;
  if (status === 'paid') payment.paid_at = payment.paid_at || new Date();
  await payment.save();

  // Keep the denormalised order-level flag in sync.
  order.payment_status =
    status === 'paid' ? 'paid' : status === 'refunded' ? 'refunded' : status === 'failed' ? 'unpaid' : order.payment_status;
  await order.save();

  return { payment, order };
}
