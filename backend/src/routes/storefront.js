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
import { assertMethodEnabled, createPaymentForOrder } from '../services/paymentsService.js';
import { createOnlinePayment } from '../services/paymentGateway.js';
import { RECONCILIATION_TTL_MS } from '../services/paymentReconciliation.js';
import { withIdempotency } from '../services/idempotency.js';
import { sendOrderAlert } from '../services/whatsappService.js';
import { publishOrderEvent } from '../services/realtime.js';

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

  // 3. Payment method — validated fail-closed against the workspace config.
  const method = assertMethodEnabled(tenant, payload.payment_method);

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
      customer_address: payload.customer_address || null,
      type: payload.order_type,
      scheduled_at: scheduledAt,
      delivery_fee: deliveryFee,
      payment_method: method,
      payment_status: method === 'cash' ? 'paid' : 'pending',
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

  // 5. Payment record — cash paid on the spot, wallets pending, online → gateway.
  const payment = await createPaymentForOrder(tenant, order, {
    method,
    reference: payload.payment_reference || null,
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
