import express from 'express';
import sequelize from '../config/db.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { requirePermission, attachPermissionCheck } from '../middleware/rbac.js';
import { resolveTenant, requireTenant } from '../middleware/tenant.js';
import Product from '../models/Product.js';
import Promotion from '../models/Promotion.js';
import PromotionSlab from '../models/PromotionSlab.js';
import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import Payment from '../models/Payment.js';
import OrderSplitItem from '../models/OrderSplitItem.js';
import Table from '../models/Table.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import UserTenant from '../models/UserTenant.js';
import { applyPromotionsToCart } from '../utils/promotionEngine.js';
import { parsePagination } from '../utils/pagination.js';
import { createOrderSchema } from '../validators/order.js';
import { sendOrderAlert, sendStatusNotification } from '../services/whatsappService.js';
import { withIdempotency } from '../services/idempotency.js';
import { publishOrderEvent } from '../services/realtime.js';
import { DELIVERY_TYPES, validateSchedule, deliveryConfig } from '../services/checkoutService.js';
import { assertMethodEnabled, createPaymentForOrder, validateSplits } from '../services/paymentsService.js';
import { createOnlinePayment } from '../services/paymentGateway.js';
import { RECONCILIATION_TTL_MS } from '../services/paymentReconciliation.js';
import { buildInvoice, renderInvoiceHtml } from '../services/invoiceService.js';
import { splitRequestSchema } from '../validators/split.js';
import {
  applySplit,
  clearSplit,
  buildSplitState,
  buildDinerReceipt,
  renderDinerReceiptHtml,
  tenantDefaultVat,
} from '../services/splitService.js';

const router = express.Router();
router.use(authMiddleware, attachPermissionCheck, resolveTenant, requireTenant);

const VALID_STATUSES = [
  'placed',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'rejected',
  'canceled',
];

// `sort=open` surfaces active fulfillment orders (placed → preparing → ready)
// before finished ones — the default kitchen/delivery view.
const OPEN_FIRST_ORDER = [
  [
    // Qualified: the `payments` join (migration 008) also has a `status`
    // column, so the bare column name is ambiguous in SQLite/PostgreSQL.
    sequelize.literal(
      "CASE \"Order\".\"status\" WHEN 'placed' THEN 0 WHEN 'preparing' THEN 1 WHEN 'ready' THEN 2 WHEN 'delivered' THEN 3 WHEN 'canceled' THEN 4 ELSE 5 END"
    ),
    'ASC',
  ],
  ['id', 'DESC'],
];

/** GET /api/orders?limit=&offset=&status=&table_no=&sort=open — filtered list. */
router.get(
  '/',
  requirePermission('view:orders'),
  asyncHandler(async (req, res) => {
    const { limit, offset } = parsePagination(req.query);

    const where = { tenant_id: req.tenant.id };
    if (typeof req.query.status === 'string' && VALID_STATUSES.includes(req.query.status)) {
      where.status = req.query.status;
    }
    if (req.query.table_no === 'none') {
      where.table_no = null; // delivery/takeaway orders with no table
    } else if (req.query.table_no !== undefined) {
      const tableNo = Number(req.query.table_no);
      if (Number.isInteger(tableNo) && tableNo > 0) where.table_no = tableNo;
    }

    // Delivery assignment filter — `assigned_to=me` for the delivery person's
    // own queue; a specific user id only for managers (never trust a client
    // claim of someone else's assignment).
    if (req.query.assigned_to === 'me') {
      if (!canDeliver(req)) {
        throw new AppError(403, 'FORBIDDEN', 'Only delivery/managers can filter assigned orders');
      }
      where.assigned_to = req.user.id;
    } else if (req.query.assigned_to !== undefined) {
      if (!canManage(req)) {
        throw new AppError(403, 'FORBIDDEN', 'Only managers can filter by delivery person');
      }
      const assignedTo = Number(req.query.assigned_to);
      if (Number.isInteger(assignedTo) && assignedTo > 0) where.assigned_to = assignedTo;
    }

    const { rows, count } = await Order.findAndCountAll({
      where,
      order: req.query.sort === 'open' ? OPEN_FIRST_ORDER : [['id', 'DESC']],
      limit,
      offset,
      include: [
        {
          model: OrderItem,
          as: 'items',
          include: [{ model: Product }],
        },
        { model: Payment, as: 'payments' },
      ],
    });

    res.set('X-Total-Count', String(count));
    res.json(rows);
  })
);

/** Fulfillment lifecycle (Phase 5).
 *
 * Forward flow (sequential, optional kitchen accept):
 *   placed → accepted → preparing → ready → [out_for_delivery] → delivered
 * Kitchen may also reject (placed/accepted) with a reason; managers may
 * cancel (placed/accepted/preparing). Transitions are gated by role:
 *   kitchen  → fulfill:orders (accepted/preparing/ready/rejected)
 *   delivery → deliver:orders (out_for_delivery/delivered)
 *   owner/manager → manage:orders (everything incl. cancel/assign)
 */
const STATUS_TRANSITIONS = {
  placed: ['preparing', 'accepted', 'rejected'],
  accepted: ['preparing', 'rejected'],
  preparing: ['ready'],
  ready: ['delivered', 'out_for_delivery'],
  out_for_delivery: ['delivered'],
  delivered: [],
  rejected: [],
  canceled: [],
};

// Cancel/reject windows (managers may cancel; kitchen may reject).
const CANCELABLE_STATUSES = ['placed', 'preparing', 'accepted'];
const REJECTABLE_STATUSES = ['placed', 'accepted'];

const canManage = (req) => req.userHas('manage:orders');
const canFulfill = (req) =>
  canManage(req) || req.userHas('fulfill:orders');
const canDeliver = (req) =>
  canManage(req) || req.userHas('deliver:orders');

/**
 * GET /api/orders/:id/invoice — VAT-aware invoice for an order (Phase 6):
 * per-item VAT split (NBR convention), totals, and the linked payment
 * records. `?print=1` returns the print-ready HTML (browser Save-as-PDF).
 */
router.get(
  '/:id/invoice',
  requirePermission('view:orders'),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
      include: [
        { model: OrderItem, as: 'items', include: [{ model: Product }] },
        { model: Payment, as: 'payments' },
      ],
    });
    if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found');

    const invoice = await buildInvoice(order, req.tenant);
    if (req.query.print === '1') {
      res.type('html').send(renderInvoiceHtml(invoice));
    } else {
      res.json(invoice);
    }
  })
);

/**
 * Dine-in split billing — cashier split panel + per-diner receipts.
 *
 * A split is a set of `payments` rows (one per diner) carrying the split
 * method + item allocation (order_split_items). All money math lives in
 * splitService (integer paisa, exact-sum invariant); these endpoints only
 * authenticate, tenant-scope, gate permissions and shape the response.
 */

/** GET /api/orders/:id/split — current split state for the panel. */
router.get(
  '/:id/split',
  requirePermission('view:orders'),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
      include: [
        { model: OrderItem, as: 'items', include: [{ model: Product }] },
        { model: Payment, as: 'payments', include: [{ model: OrderSplitItem, as: 'splitItems' }] },
      ],
    });
    if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found');
    res.json(buildSplitState(order, tenantDefaultVat(req.tenant)));
  })
);

/** POST /api/orders/:id/split — create or replace the split (transactional). */
router.post(
  '/:id/split',
  requirePermission('place:orders'),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found');
    const body = splitRequestSchema.parse(req.body);
    const result = await applySplit({
      tenant: req.tenant,
      order,
      mode: body.mode,
      diners: body.diners,
      allocations: body.allocations || [],
      actorId: req.user?.id,
      req,
    });
    res.status(201).json(result);
  })
);

/** DELETE /api/orders/:id/split — remove the split, restore single cash. */
router.delete(
  '/:id/split',
  requirePermission('place:orders'),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found');
    res.json(
      await clearSplit({ tenant: req.tenant, order, actorId: req.user?.id, req })
    );
  })
);

/**
 * GET /api/orders/:id/split/receipts/:paymentId — one diner's receipt
 * (JSON, or `?print=1` for the print-ready HTML). view:orders.
 */
router.get(
  '/:id/split/receipts/:paymentId',
  requirePermission('view:orders'),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
      include: [
        { model: OrderItem, as: 'items', include: [{ model: Product }] },
        { model: Payment, as: 'payments', include: [{ model: OrderSplitItem, as: 'splitItems' }] },
      ],
    });
    if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found');
    const payment = (order.payments || []).find(
      (p) => Number(p.id) === Number(req.params.paymentId)
    );
    if (!payment) throw new AppError(404, 'NOT_FOUND', 'Split part not found');
    const receipt = buildDinerReceipt({ order, tenant: req.tenant, payment });
    if (req.query.print === '1') {
      res.type('html').send(renderDinerReceiptHtml(receipt));
    } else {
      res.json(receipt);
    }
  })
);

/** PATCH /api/orders/:id/status — advance/accept/reject/cancel fulfillment.
 *
 * Preserves the legacy sequential flow exactly (placed → preparing → ready →
 * delivered, manager cancel) and adds the Phase 5 branches: kitchen accept /
 * reject (with reason), and the delivery hop (ready → out_for_delivery →
 * delivered) for delivery-type orders only.
 */
router.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found');

    const { status, reason } = req.body;
    if (!status || typeof status !== 'string') {
      throw new AppError(400, 'VALIDATION_ERROR', 'status is required');
    }
    if (!VALID_STATUSES.includes(status)) {
      throw new AppError(
        400,
        'INVALID_STATUS_TRANSITION',
        `Unknown order status "${status}"`
      );
    }

    if (status === 'canceled') {
      if (!canManage(req)) {
        throw new AppError(403, 'FORBIDDEN', 'Only managers can cancel orders');
      }
      if (!CANCELABLE_STATUSES.includes(order.status)) {
        throw new AppError(
          409,
          'INVALID_STATUS_TRANSITION',
          `Order in "${order.status}" cannot be canceled`
        );
      }
    } else if (status === 'rejected') {
      if (!canFulfill(req)) {
        throw new AppError(403, 'FORBIDDEN', 'Only kitchen/managers can reject orders');
      }
      if (!REJECTABLE_STATUSES.includes(order.status)) {
        throw new AppError(
          409,
          'INVALID_STATUS_TRANSITION',
          `Order in "${order.status}" cannot be rejected`
        );
      }
      if (!reason || typeof reason !== 'string' || !reason.trim()) {
        throw new AppError(400, 'VALIDATION_ERROR', 'A reject reason is required');
      }
      order.rejected_reason = reason.trim().slice(0, 255);
      order.rejected_by = req.user.id;
    } else {
      // Sequential forward flow — same rule as before: only one step at a time.
      const nexts = STATUS_TRANSITIONS[order.status] || [];
      if (!nexts.includes(status)) {
        throw new AppError(
          400,
          'INVALID_STATUS_TRANSITION',
          `Cannot move order from "${order.status}" to "${status}"`
        );
      }
      const permitted =
        status === 'delivered' || status === 'out_for_delivery'
          ? canDeliver(req)
          : canFulfill(req);
      if (!permitted) {
        throw new AppError(
          403,
          'FORBIDDEN',
          `Your role cannot move orders to "${status}"`
        );
      }
      if (status === 'out_for_delivery' && !DELIVERY_TYPES.includes(order.type)) {
        throw new AppError(
          400,
          'INVALID_STATUS_TRANSITION',
          'Only delivery orders can be marked out for delivery'
        );
      }
    }

    order.status = status;
    await order.save();

    // Customer status notification (Phase 5): fire-and-forget, never blocks
    // the status change — the service swallows every failure internally.
    if (req.tenant?.id) {
      const tenant = await Tenant.findByPk(req.tenant.id);
      if (tenant) void sendStatusNotification(tenant, order, status);
    }

    // Real-time kitchen/delivery queue (Phase 5): broadcast the move.
    publishOrderEvent(req.tenant.id, 'order.status_changed', order);

    res.json({
      id: order.id,
      status: order.status,
      rejected_reason: order.rejected_reason ?? null,
    });
  })
);

/** PATCH /api/orders/:id/assign — (re)assign a delivery order to a rider.
 *
 * Manager/owner only. The target must be a member of THIS workspace with the
 * delivery role (never trust an arbitrary user id); terminal orders cannot be
 * reassigned. `delivery_user_id: null` unassigns.
 */
router.patch(
  '/:id/assign',
  asyncHandler(async (req, res) => {
    if (!canManage(req)) {
      throw new AppError(403, 'FORBIDDEN', 'Only managers can assign delivery orders');
    }
    const order = await Order.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found');
    if (!DELIVERY_TYPES.includes(order.type)) {
      throw new AppError(400, 'NOT_DELIVERY_ORDER', 'Only delivery orders can be assigned');
    }
    if (['delivered', 'canceled', 'rejected'].includes(order.status)) {
      throw new AppError(409, 'ORDER_TERMINAL', 'Finished orders cannot be reassigned');
    }

    const { delivery_user_id } = req.body;
    if (delivery_user_id != null) {
      const member = await UserTenant.findOne({
        where: { user_id: delivery_user_id, tenant_id: req.tenant.id },
      });
      const rider = member ? await User.findByPk(delivery_user_id) : null;
      if (!rider || member.role !== 'delivery') {
        throw new AppError(400, 'INVALID_DELIVERY_USER', 'Target user is not a delivery member of this workspace');
      }
    }

    order.assigned_to = delivery_user_id ?? null;
    await order.save();

    // Real-time: the rider's queue updates live.
    publishOrderEvent(req.tenant.id, 'order.assigned', order);

    res.json({ id: order.id, assigned_to: order.assigned_to });
  })
);

/** POST /api/orders — create an order with server-side pricing and promotions. */
router.post(
  '/',
  requirePermission('place:orders'),
  asyncHandler(async (req, res) => {
    const parsed = createOrderSchema.parse(req.body);
    // Retry-safe order creation (Phase 5): the same Idempotency-Key resolves
    // to the same order — double-clicks, browser/network retries and payment
    // callback retries can never create duplicates.
    const result = await withIdempotency({
      tenantId: req.tenant.id,
      userId: req.user.id,
      key: req.headers['idempotency-key'],
      body: req.body,
      handler: () => placeStaffOrder(req, parsed),
    });
    res.status(result.statusCode).json(result.body);
  })
);

/** Shared staff order-placement — wrapped by withIdempotency above. */
async function placeStaffOrder(req, {
  customer_name,
  customer_phone,
  customer_address,
  table_no,
  payment_method,
  payment_reference,
  payments: splitParts,
  items,
  order_type = 'pickup',
  scheduled_at,
}) {

    // Validate the payment method against THIS workspace's enabled methods
    // (fail-closed — cash is the default when nothing is configured). Split
    // orders validate each part instead (sum must equal the grand total,
    // which is known after pricing below).
    const tenantConfig = await Tenant.findByPk(req.tenant.id);
    const useSplit = Array.isArray(splitParts) && splitParts.length > 0;
    let method = useSplit ? 'split' : assertMethodEnabled(tenantConfig, payment_method);

    // Fetch products and promotions concurrently — independent reads.
    // A dine-in order may carry a physical table (QR table menu) — it must
    // exist and be active in THIS workspace (fail-closed, never trusts the
    // client's tenant claim).
    if (table_no != null) {
      const table = await Table.findOne({
        where: { tenant_id: req.tenant.id, table_no, is_active: true },
      });
      if (!table) {
        throw new AppError(
          400,
          'INVALID_TABLE',
          `Table ${table_no} does not exist or is not active in this workspace`
        );
      }
    }

    const [products, promotions] = await Promise.all([
      Product.findAll({
        where: {
          id: items.map((i) => i.product_id),
          tenant_id: req.tenant.id,
          enabled: true,
        },
      }),
      Promotion.findAll({
        where: { tenant_id: req.tenant.id },
        include: [{ model: PromotionSlab, as: 'slabs' }],
      }),
    ]);

    const productMap = {};
    products.forEach((p) => (productMap[p.id] = p));

    // Reject if any requested product is unknown or disabled
    const missing = items.filter((i) => !productMap[i.product_id]);
    if (missing.length > 0) {
      throw new AppError(
        400,
        'PRODUCT_UNAVAILABLE',
        `Product(s) unavailable: ${missing
          .map((i) => i.product_id)
          .join(', ')}`
      );
    }

    const cartItems = items.map((i) => ({
      product: productMap[i.product_id],
      quantity: i.quantity,
    }));

    const { items: enriched, subtotal, totalDiscount, grandTotal } =
      applyPromotionsToCart(cartItems, promotions);

    // Delivery/schedule support (Phase 5): delivery-type orders carry the
    // workspace's delivery fee; scheduled_* orders validate the requested time.
    const orderType = ['pickup', 'delivery', 'scheduled_pickup', 'scheduled_delivery'].includes(order_type)
      ? order_type
      : 'pickup';
    const isDeliveryType = ['delivery', 'scheduled_delivery'].includes(orderType);
    const deliveryFee = isDeliveryType ? deliveryConfig(tenantConfig).fee : 0;
    const scheduledAt = validateSchedule(scheduled_at, orderType);

    // Split orders: validate every part against the workspace's enabled
    // methods and the exact grand total, then derive the initial order-level
    // payment status from the parts (all-cash → paid on the spot, mixed →
    // partial, wallets-only → pending).
    let resolvedSplits = null;
    let initialPaymentStatus = method === 'cash' ? 'paid' : 'pending';
    if (useSplit) {
      resolvedSplits = validateSplits(tenantConfig, splitParts, grandTotal + deliveryFee);
      const allCash = resolvedSplits.every((s) => s.method === 'cash');
      const anyCash = resolvedSplits.some((s) => s.method === 'cash');
      initialPaymentStatus = allCash ? 'paid' : anyCash ? 'partial' : 'pending';
    }

    const order = await Order.create(
      {
        tenant_id: req.tenant.id,
        // `order_no` is NOT NULL in the migration (no DB default) — the app
        // generates a human-friendly, roughly unique reference per tenant.
        order_no: `ORD-${req.tenant.id}-${Date.now().toString(36).toUpperCase()}-${Math.floor(
          Math.random() * 1e4
        )}`,
        customer_name,
        customer_phone: customer_phone || null,
        customer_address: customer_address || null,
        table_no: table_no ?? null,
        type: orderType,
        scheduled_at: scheduledAt,
        delivery_fee: deliveryFee,
        payment_method: method,
        payment_status: initialPaymentStatus,
        subtotal,
        total_discount: totalDiscount,
        grand_total: grandTotal + deliveryFee,
        items: enriched.map((i) => ({
          tenant_id: req.tenant.id,
          product_id: i.product.id,
          // `item_name` is a NOT NULL denormalized snapshot in the migration.
          item_name: i.product.name,
          quantity: i.quantity,
          unit_price: i.product.price,
          weight_per_unit_gm: i.product.weight_gm,
          total_weight_gm: i.totalWeightGm,
          discount: i.discount,
          line_total: i.lineTotal,
        })),
      },
      { include: [{ model: OrderItem, as: 'items' }] }
    );

    // Payment record(s) — cash is paid on the spot, wallets start pending;
    // split orders create one row per part.
    const payment = await createPaymentForOrder(tenantConfig, order, {
      method,
      reference: payment_reference || null,
      splits: resolvedSplits,
    });

    // Online payments (SSLCommerz/Stripe): build the hosted checkout session
    // so the cashier/customer can redirect and pay. The gateway stamps the
    // payment's reference (tran_id / session id) for webhook confirmation.
    let paymentUrl = null;
    let gateway = null;
    if (method === 'online') {
      // Stale-intent window: if the customer never completes the checkout, the
      // reconciliation job auto-expires this pending payment after the TTL.
      payment.expires_at = new Date(Date.now() + RECONCILIATION_TTL_MS);
      await payment.save();
      const session = await createOnlinePayment({ tenant: tenantConfig, order, payment });
      paymentUrl = session.paymentUrl;
      gateway = session.gateway;
    }
    // Split orders never use the hosted gateway (rejected in validateSplits),
    // so `payment` being an array here is safe — it is only consumed above.

    const fullOrder = await Order.findByPk(order.id, {
      include: [
        { model: OrderItem, as: 'items', include: [{ model: Product }] },
        { model: Payment, as: 'payments' },
      ],
    });

    // WhatsApp order alert (Phase 5): fire-and-forget, never blocks/delays
    // order creation — the service swallows every failure internally.
    if (tenantConfig) void sendOrderAlert(tenantConfig, fullOrder, fullOrder.items || []);

    const body = fullOrder.toJSON();
    if (paymentUrl) {
      body.paymentUrl = paymentUrl;
      body.gateway = gateway;
    }

    // Real-time kitchen/delivery queue (Phase 5): a new order lands live.
    publishOrderEvent(req.tenant.id, 'order.created', fullOrder);

    return { statusCode: 201, body };
}

export default router;
