import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import Tenant from '../models/Tenant.js';
import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import Payment from '../models/Payment.js';
import Product from '../models/Product.js';
import { checkoutSchema } from '../validators/checkout.js';
import { priceCart, validateSchedule, deliveryConfig, DELIVERY_TYPES } from '../services/checkoutService.js';
import {
  assertMethodEnabled,
  createPaymentForOrder,
  validateSplits,
} from '../services/paymentsService.js';
import { createOnlinePayment } from '../services/paymentGateway.js';
import { RECONCILIATION_TTL_MS } from '../services/paymentReconciliation.js';
import { withIdempotency } from '../services/idempotency.js';
import { sendOrderAlert } from '../services/whatsappService.js';
import { sendOrderConfirmationEmail } from '../services/notifications/orderConfirmation.js';
import { publishOrderEvent } from '../services/realtime.js';
import { assertQuota, incrementUsage, notifyQuotaIfCrossed } from '../services/planService.js';
import { decrementVariantStock } from '../services/menuService.js';

/**
 * Public storefront checkout (Phase 5) — the customer journey's final step.
 *
 * NO authentication by design: guests order with a name + phone (the same
 * phone-based identity the public tracking API uses). Prices are resolved
 * server-side; an `Idempotency-Key` header makes retries safe (double-click,
 * network retry, payment callback retry) without duplicating orders.
 */
const router = express.Router();

const VISIBLE_TENANT_STATUS = ['active', 'trial'];

const findPublicTenant = async (slug) => {
  const tenant = await Tenant.findOne({ where: { slug } });
  if (!tenant || !VISIBLE_TENANT_STATUS.includes(tenant.status)) {
    throw new AppError(404, 'NOT_FOUND', 'Restaurant not found');
  }
  return tenant;
};

/** POST /api/public/restaurants/:slug/checkout — place a guest order. */
router.post(
  '/restaurants/:slug/checkout',
  asyncHandler(async (req, res) => {
    const tenant = await findPublicTenant(req.params.slug);
    const payload = checkoutSchema.parse(req.body);

    const idempotencyKey = req.headers['idempotency-key'];
    const result = await withIdempotency({
      tenantId: tenant.id,
      userId: 0, // guest
      key: idempotencyKey,
      body: req.body,
      handler: async () => {
        const order = await placeCheckoutOrder(tenant, payload);
        return { statusCode: 201, body: order };
      },
    });

    if (result.replayed) {
      return res.status(result.statusCode).json(result.body);
    }
    return res.status(201).json(result.body);
  })
);

/** Shared order-placement logic (also used for retry replay construction). */
async function placeCheckoutOrder(tenant, payload) {
  // 1. Order-type constraints first (fail fast, clear errors): delivery
  //    availability + address, and the schedule window.
  const isDelivery = DELIVERY_TYPES.includes(payload.order_type);
  const delivery = deliveryConfig(tenant);
  if (isDelivery && !delivery.enabled) {
    throw new AppError(400, 'DELIVERY_UNAVAILABLE', 'This restaurant does not accept delivery orders');
  }
  if (isDelivery && !payload.customer_address?.trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Delivery address is required for delivery orders');
  }
  const scheduledAt = validateSchedule(payload.scheduled_at, payload.order_type);

  // 2. Server-side pricing + availability (never trust the client).
  const { items: pricedItems, subtotal, totalDiscount } = await priceCart(tenant, payload.items);

  const deliveryFee = isDelivery ? delivery.fee : 0;
  const grandTotal = Math.round((subtotal - totalDiscount + deliveryFee) * 100) / 100;

  // 3. Payment — single method (fail-closed against the workspace config)
  //    or split parts (each validated + summed to the exact grand total).
  const useSplit = Array.isArray(payload.payments) && payload.payments.length > 0;
  let method = useSplit ? 'split' : assertMethodEnabled(tenant, payload.payment_method);
  let resolvedSplits = null;
  let initialPaymentStatus = method === 'cash' ? 'paid' : 'pending';
  if (useSplit) {
    resolvedSplits = validateSplits(tenant, payload.payments, grandTotal);
    const allCash = resolvedSplits.every((s) => s.method === 'cash');
    const anyCash = resolvedSplits.some((s) => s.method === 'cash');
    initialPaymentStatus = allCash ? 'paid' : anyCash ? 'partial' : 'pending';
  }

  // 3.5 Plan quota gate (Phase 3) — daily order volume is limited per plan.
  //    Checked before the order row exists so a rejected order costs nothing.
  await assertQuota(tenant.id, 'orders_daily');

  // 4. Create the order + line items (single transaction: a payment failure
  //    must never leave a half-created order behind).
  const order = await Order.create(
    {
      tenant_id: tenant.id,
      order_no: `ORD-${tenant.id}-${Date.now().toString(36).toUpperCase()}-${Math.floor(
        Math.random() * 1e4
      )}`,
      customer_name: payload.customer_name,
      customer_phone: payload.customer_phone,
      customer_email: payload.customer_email || null,
      customer_address: payload.customer_address || null,
      type: payload.order_type,
      scheduled_at: scheduledAt,
      delivery_fee: deliveryFee,
      payment_method: method,
      payment_status: initialPaymentStatus,
      subtotal,
      total_discount: totalDiscount,
      grand_total: grandTotal,
      items: pricedItems.map((i) => ({
        tenant_id: tenant.id,
        product_id: i.product.id,
        item_name: i.itemName,
        quantity: i.quantity,
        unit_price: i.unitPrice,
        weight_per_unit_gm: i.product.weight_gm || 0,
        total_weight_gm: i.totalWeightGm,
        discount: i.discount,
        line_total: i.lineTotal,
      })),
    },
    { include: [{ model: OrderItem, as: 'items' }] }
  );

  // 4.5 Plan usage accounting (Phase 3): this order counts toward the plan's
  //    daily order quota (idempotent replays short-circuit above).
  await incrementUsage(tenant.id, 'orders_daily');
  // Quota alerting (Phase 3): fire-and-forget threshold nudges.
  void notifyQuotaIfCrossed(tenant.id);

  // 4.6 Variant stock (Phase 4): tracked variants drop by the ordered
  //    quantity. Best-effort — a stale variant never fails the order.
  await decrementVariantStock(pricedItems);

  // 5. Payment record(s) — cash paid on the spot, wallets pending, online
  //    → gateway; split orders create one row per part (never the gateway:
  //    validateSplits rejects online parts).
  const payment = await createPaymentForOrder(tenant, order, {
    method,
    reference: payload.payment_reference || null,
    splits: resolvedSplits,
  });

  let paymentUrl = null;
  let gateway = null;
  if (method === 'online') {
    payment.expires_at = new Date(Date.now() + RECONCILIATION_TTL_MS);
    await payment.save();
    const session = await createOnlinePayment({ tenant, order, payment });
    paymentUrl = session.paymentUrl;
    gateway = session.gateway;
  }

  const fullOrder = await Order.findByPk(order.id, {
    include: [
      { model: OrderItem, as: 'items', include: [{ model: Product }] },
      { model: Payment, as: 'payments' },
    ],
  });

  // Real-time kitchen/delivery queue (Phase 5): a customer order lands live.
  publishOrderEvent(tenant.id, 'order.created', fullOrder);

  // WhatsApp order alert (fire-and-forget — never blocks order creation).
  if (tenant) void sendOrderAlert(tenant, fullOrder, fullOrder.items || []);

  // Ticket-styled confirmation email (fire-and-forget) — only when the
  // customer left an email at checkout; the stub mailer logs it in dev.
  if (fullOrder.customer_email && tenant) {
    void sendOrderConfirmationEmail({
      tenant,
      order: fullOrder,
      items: fullOrder.items || [],
      trackUrl: `/track?orderNo=${encodeURIComponent(
        order.order_no
      )}&phone=${encodeURIComponent(payload.customer_phone)}`,
    });
  }

  const body = fullOrder.toJSON();
  if (paymentUrl) {
    body.paymentUrl = paymentUrl;
    body.gateway = gateway;
  }
  body.trackUrl = `/track?orderNo=${encodeURIComponent(order.order_no)}&phone=${encodeURIComponent(
    payload.customer_phone
  )}`;
  return body;
}

export default router;
