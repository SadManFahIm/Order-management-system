import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import Payment from '../models/Payment.js';
import Order from '../models/Order.js';
import { applyPaymentStatus } from './paymentsService.js';

/**
 * Online payment gateways (Phase 5/6) — SSLCommerz + Stripe + bKash hosted
 * checkout behind one provider interface.
 *
 * Zero-dependency: all three gateways are plain REST APIs, so the integration
 * uses `fetch` + `node:crypto` — no SDKs. An order placed with
 * `payment_method: 'online'` gets a gateway redirect URL (SSLCommerz
 * GatewayPageURL, Stripe Checkout Session, or bKash bkashURL), and the
 * gateway confirms the payment — a signed server webhook for
 * SSLCommerz/Stripe, a browser callback + `execute` for bKash — flipping the
 * pending payment to paid.
 *
 * Sandbox-first: `PAYMENT_GATEWAY=sslcommerz|stripe|bkash` with sandbox
 * credentials. Missing credentials produce a clear configuration error at
 * order time, never a silent fallback.
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
  if (env.PAYMENT_GATEWAY === 'bkash') {
    const missing = [
      ['BKASH_APP_KEY', env.BKASH_APP_KEY],
      ['BKASH_APP_SECRET', env.BKASH_APP_SECRET],
      ['BKASH_USER_NAME', env.BKASH_USER_NAME],
      ['BKASH_PASSWORD', env.BKASH_PASSWORD],
    ].filter(([, v]) => !v);
    if (missing.length > 0) {
      throw new AppError(
        500,
        'GATEWAY_NOT_CONFIGURED',
        `PAYMENT_GATEWAY=bkash requires ${missing.map(([k]) => k).join(', ')}`
      );
    }
    return { active: true, name: 'bkash', sandbox: env.BKASH_SANDBOX !== false };
  }
  return { active: false, name: null, sandbox: false };
}

/**
 * Creates a hosted checkout for an order's pending payment. Returns
 * `{ gateway, paymentUrl, sessionId }` and stamps `payment.reference` with
 * the gateway's transaction identifier (tran_id / session id / paymentID) so
 * the confirmation path can find it.
 */
export async function createOnlinePayment({ tenant, order, payment }) {
  const gateway = gatewayStatus();
  if (!gateway.active) {
    throw new AppError(400, 'PAYMENT_GATEWAY_NOT_CONFIGURED', 'Online payments are not enabled on this platform');
  }
  const provider = providers[gateway.name];
  return provider.createSession(tenant, order, payment);
}

/** Provider registry — one object per gateway, same `createSession` shape. */
const providers = {
  sslcommerz: { name: 'sslcommerz', createSession: createSslcommerzSession },
  stripe: { name: 'stripe', createSession: createStripeSession },
  bkash: { name: 'bkash', createSession: createBkashSession },
};

async function createSslcommerzSession(tenant, order, payment) {
  const tranId = `TXN-${order.tenant_id}-${Date.now().toString(36).toUpperCase()}-${String(randomInt(1e4)).padStart(4, '0')}`;
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

// ── bKash Tokenized Checkout adapter ──────────────────────────────────────
// Flow: grant an id_token (cached until expiry) → create a payment (bkashURL)
// → the customer pays on bKash's page → the browser is redirected to
// BKASH_CALLBACK_URL with the paymentID → the backend EXECUTES the payment
// (the actual verification — an unsigned callback is never trusted) and marks
// it paid with the returned trxID. No server-to-server webhook exists, so the
// callback + execute round-trip is the confirmation.

/** bKash API base (sandbox default). `BKASH_API_URL` overrides for local mocks. */
function bkashBase() {
  return (
    env.BKASH_API_URL ||
    (env.BKASH_SANDBOX !== false
      ? 'https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized'
      : 'https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized')
  );
}

let bkashTokenCache = null;

/** Grants (and caches) a bKash id_token; refreshes near/after expiry. */
async function bkashToken() {
  if (bkashTokenCache && bkashTokenCache.expiresAt > Date.now() + 30_000) {
    return bkashTokenCache.token;
  }
  const res = await fetch(`${bkashBase()}/checkout/token/grant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // Basic auth: base64(username:password), per bKash docs.
      Authorization: `Basic ${Buffer.from(`${env.BKASH_USER_NAME}:${env.BKASH_PASSWORD}`).toString('base64')}`,
    },
    body: JSON.stringify({ app_key: env.BKASH_APP_KEY, app_secret: env.BKASH_APP_SECRET }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== 200 || !data.id_token) {
    throw new AppError(502, 'GATEWAY_ERROR', `bKash token grant failed: ${data.statusMessage || res.status}`);
  }
  bkashTokenCache = {
    token: data.id_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  return bkashTokenCache.token;
}

async function createBkashSession(tenant, order, payment) {
  const token = await bkashToken();
  const amount = Number(order.grand_total ?? order.total_amount ?? 0);
  const body = {
    mode: '0011',
    payerReference: order.customer_phone || '01700000000',
    callbackURL: env.BKASH_CALLBACK_URL,
    amount: amount.toFixed(2),
    currency: 'BDT',
    intent: 'sale',
    // Unique alphanumeric invoice reference (bKash constraint ~20 chars) —
    // the payment.id makes it unique per transaction.
    merchantInvoiceNumber: `INV${payment.id}`,
  };
  const res = await fetch(`${bkashBase()}/checkout/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      authorization: token,
      'x-app-key': env.BKASH_APP_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== 200 || !data.paymentID || !data.bkashURL) {
    throw new AppError(502, 'GATEWAY_ERROR', `bKash create failed: ${data.statusMessage || res.status}`);
  }

  payment.reference = data.paymentID; // the callback/execute looks it up by this
  await payment.save();
  return { gateway: 'bkash', paymentUrl: data.bkashURL, sessionId: data.paymentID };
}

/**
 * Executes a bKash payment (callback verification): the real transaction
 * state comes from this call, not from the unsigned browser callback. Returns
 * the raw gateway response `{ paymentID, trxID, transactionStatus, amount }`.
 */
export async function executeBkashPayment(paymentID) {
  const token = await bkashToken();
  const res = await fetch(`${bkashBase()}/checkout/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      authorization: token,
      'x-app-key': env.BKASH_APP_KEY,
    },
    body: JSON.stringify({ paymentID }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== 200 || !data.trxID) {
    throw new AppError(502, 'GATEWAY_ERROR', `bKash execute failed: ${data.statusMessage || res.status}`);
  }
  return data;
}

/**
 * Applies a gateway confirmation: finds the pending online payment by its
 * gateway transaction reference and marks it paid (keeps the order's
 * payment_status in sync).
 *
 * Server-side verification (Phase 6):
 *   - `expectedAmount` (the gateway-reported amount) is compared to the
 *     payment's own amount; a mismatch throws — the payment is NOT marked
 *     paid. This is the fraud guard for unsigned callbacks and replayed
 *     webhooks: a tampered amount can never confirm a payment for less (or
 *     more) than what was charged.
 *   - `verification` (an object like
 *     { gateway, transactionStatus, trxID, amount, currency, verifiedAt,
 *       method }) is persisted to `payment.verification_metadata` so every
 *     paid online payment carries a provable gateway record. Never secrets.
 *   - `payment.gateway` records which gateway confirmed it.
 *
 * Returns the updated payment, or null if nothing matched (idempotent —
 * replayed webhooks are safe).
 */
export async function applyGatewayConfirmation({
  gateway,
  reference,
  gatewayReference,
  expectedAmount,
  verification,
}) {
  const payment = await Payment.findOne({
    where: { method: 'online', status: 'pending', reference },
  });
  if (!payment) return null;
  const order = await Order.findByPk(payment.order_id);
  if (!order) return null;

  if (expectedAmount != null) {
    const charged = Number(payment.amount || 0);
    if (Math.abs(Number(expectedAmount) - charged) > 0.01) {
      throw new AppError(
        400,
        'AMOUNT_MISMATCH',
        `Gateway confirmed amount (${Number(expectedAmount).toFixed(2)}) does not match the charged amount (${charged.toFixed(2)})`
      );
    }
  }

  // Persist the server-side verification record so the payment is auditable.
  payment.gateway = gateway;
  if (verification && typeof verification === 'object') {
    payment.verification_metadata = {
      ...verification,
      verifiedAt: verification.verifiedAt || new Date().toISOString(),
    };
  }
  await payment.save();

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

/**
 * Queries bKash for the real transaction state of a paymentID — the
 * server-side source of truth used for manual verification / reconciliation
 * (Phase 6). Returns `{ paymentID, trxID, transactionStatus, amount,
 * currency }` or throws on a gateway error.
 */
export async function queryBkashPayment(paymentID) {
  const token = await bkashToken();
  const res = await fetch(`${bkashBase()}/checkout/payment/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      authorization: token,
      'x-app-key': env.BKASH_APP_KEY,
    },
    body: JSON.stringify({ paymentID }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== 200 || !data.paymentID) {
    throw new AppError(502, 'GATEWAY_ERROR', `bKash query failed: ${data.statusMessage || res.status}`);
  }
  return data;
}
