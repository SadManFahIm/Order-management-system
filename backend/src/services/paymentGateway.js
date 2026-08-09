import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import Payment from '../models/Payment.js';
import Order from '../models/Order.js';
import { applyPaymentStatus } from './paymentsService.js';

/**
 * Online payment gateways (Phase 5) — SSLCommerz + Stripe hosted checkout.
 *
 * Zero-dependency: both gateways are plain REST APIs, so the integration uses
 * `fetch` + `node:crypto` — no SDKs. An order placed with `payment_method:
 * 'online'` gets a gateway redirect URL (SSLCommerz GatewayPageURL or Stripe
 * Checkout Session), and the gateway's server-side webhook flips the pending
 * payment to paid.
 *
 * Sandbox-first: `PAYMENT_GATEWAY=sslcommerz|stripe` with sandbox credentials
 * (SSLCommerz sandbox store / Stripe test keys). Missing credentials produce
 * a clear configuration error at order time, never a silent fallback.
 */

/** Which gateway (if any) is active, and whether it is sandbox mode. */
export function gatewayStatus() {
  if (env.PAYMENT_GATEWAY === 'sslcommerz') {
    if (!env.SSLCOMMERZ_STORE_ID || !env.SSLCOMMERZ_STORE_PASSWORD) {
      throw new AppError(
        500,
        'GATEWAY_NOT_CONFIGURED',
        'PAYMENT_GATEWAY=sslcommerz requires SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD'
      );
    }
    return { active: true, name: 'sslcommerz', sandbox: env.SSLCOMMERZ_SANDBOX !== false };
  }
  if (env.PAYMENT_GATEWAY === 'stripe') {
    if (!env.STRIPE_SECRET_KEY) {
      throw new AppError(
        500,
        'GATEWAY_NOT_CONFIGURED',
        'PAYMENT_GATEWAY=stripe requires STRIPE_SECRET_KEY'
      );
    }
    return { active: true, name: 'stripe', sandbox: true };
  }
  return { active: false, name: null, sandbox: false };
}

/**
 * Creates a hosted checkout for an order's pending payment. Returns
 * `{ gateway, paymentUrl, sessionId }` and stamps `payment.reference` with
 * the gateway's transaction identifier (tran_id / session id) so the webhook
 * can find it.
 */
export async function createOnlinePayment({ tenant, order, payment }) {
  const gateway = gatewayStatus();
  if (!gateway.active) {
    throw new AppError(400, 'PAYMENT_GATEWAY_NOT_CONFIGURED', 'Online payments are not enabled on this platform');
  }
  if (gateway.name === 'sslcommerz') return createSslcommerzSession(tenant, order, payment);
  return createStripeSession(tenant, order, payment);
}

async function createSslcommerzSession(tenant, order, payment) {
  const tranId = `TXN-${order.tenant_id}-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1e4)}`;
  const sandbox = env.SSLCOMMERZ_SANDBOX !== false;
  const endpoint =
    env.SSLCOMMERZ_API_URL ||
    (sandbox
      ? 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php'
      : 'https://securepay.sslcommerz.com/gwprocess/v4/api.php');

  const params = new URLSearchParams({
    store_id: env.SSLCOMMERZ_STORE_ID,
    store_passwd: env.SSLCOMMERZ_STORE_PASSWORD,
    total_amount: Number(order.grand_total ?? order.total_amount ?? 0).toFixed(2),
    currency: 'BDT',
    tran_id: tranId,
    success_url: env.SSLCOMMERZ_SUCCESS_URL,
    fail_url: env.SSLCOMMERZ_FAIL_URL,
    cancel_url: env.SSLCOMMERZ_CANCEL_URL,
    cus_name: order.customer_name || 'Customer',
    cus_phone: order.customer_phone || '01700000000',
    product_name: `Order ${order.order_no || order.id}`,
    product_category: 'food',
    num_of_item: '1',
    ship_name: order.customer_name || 'Customer',
    ship_city: 'Dhaka',
    ship_country: 'Bangladesh',
    emi_option: '0',
  });

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== 200 || data.status !== 'SUCCESS' || !data.GatewayPageURL) {
    throw new AppError(
      502,
      'GATEWAY_ERROR',
      `SSLCommerz session failed: ${data.status || res.status} ${data.failedreason || ''}`
    );
  }

  payment.reference = tranId;
  await payment.save();
  return { gateway: 'sslcommerz', paymentUrl: data.GatewayPageURL, sessionId: tranId };
}

async function createStripeSession(tenant, order, payment) {
  const endpoint = `${env.STRIPE_API_URL}/v1/checkout/sessions`;
  const params = new URLSearchParams({
    mode: 'payment',
    success_url: env.SSLCOMMERZ_SUCCESS_URL,
    cancel_url: env.SSLCOMMERZ_CANCEL_URL,
    client_reference_id: order.order_no || String(order.id),
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'bdt',
    'line_items[0][price_data][unit_amount]': String(
      Math.round(Number(order.grand_total ?? order.total_amount ?? 0) * 100)
    ),
    'line_items[0][price_data][product_data][name]': `Order ${order.order_no || order.id}`,
    'metadata[order_id]': String(order.id),
    'metadata[payment_id]': String(payment.id),
  });
  if (order.customer_phone) params.set('metadata[customer_phone]', String(order.customer_phone));

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== 200 || !data.id || !data.url) {
    throw new AppError(502, 'GATEWAY_ERROR', `Stripe session failed: ${data.error?.message || res.status}`);
  }

  payment.reference = data.id; // session id — the webhook looks it up by this
  await payment.save();
  return { gateway: 'stripe', paymentUrl: data.url, sessionId: data.id };
}

/**
 * SSLCommerz signature: md5(store_passwd + store_id + tran_id + amount +
 * currency + status) — the documented way to trust a webhook/return call
 * without a round-trip to the validator API.
 */
export function verifySslcommerzSignature(params) {
  const { store_passwd, store_id, tran_id, amount, currency, status, verify_sign } = params;
  if (![store_passwd, store_id, tran_id, amount, currency, status, verify_sign].every(Boolean)) {
    return false;
  }
  const expected = createHash('md5')
    .update(`${store_passwd}${store_id}${tran_id}${amount}${currency}${status}`)
    .digest('hex');
  return safeEqual(expected, String(verify_sign));
}

/** Stripe webhook signature: HMAC-SHA256 over `${t}.${rawBody}`. */
export function verifyStripeSignature(rawBody, signatureHeader) {
  if (!env.STRIPE_WEBHOOK_SECRET || !signatureHeader) return false;
  const parts = String(signatureHeader).split(',').map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2);
  const expected = parts.find((p) => p.startsWith('v1='))?.slice(3);
  if (!timestamp || !expected) return false;
  const signed = createHmac('sha256', env.STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  return safeEqual(signed, expected);
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Applies a gateway confirmation: finds the pending online payment by its
 * gateway transaction reference and marks it paid (keeps the order's
 * payment_status in sync). Returns the updated payment, or null if nothing
 * matched (idempotent — replayed webhooks are safe).
 */
export async function applyGatewayConfirmation({ gateway, reference, gatewayReference }) {
  const payment = await Payment.findOne({
    where: { method: 'online', status: 'pending', reference },
  });
  if (!payment) return null;
  const order = await Order.findByPk(payment.order_id);
  if (!order) return null;

  const { payment: updated } = await applyPaymentStatus(
    payment,
    {
      status: 'paid',
      reference: gatewayReference || reference,
      notes: `Confirmed via ${gateway}`,
    },
    order
  );
  return updated;
}
