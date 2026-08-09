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
import Table from '../models/Table.js';
import Tenant from '../models/Tenant.js';
import { applyPromotionsToCart } from '../utils/promotionEngine.js';
import { parsePagination } from '../utils/pagination.js';
import { createOrderSchema } from '../validators/order.js';
import { sendOrderAlert } from '../services/whatsappService.js';

const router = express.Router();
router.use(authMiddleware, attachPermissionCheck, resolveTenant, requireTenant);

const VALID_STATUSES = ['placed', 'preparing', 'ready', 'delivered', 'canceled'];

// `sort=open` surfaces active fulfillment orders (placed → preparing → ready)
// before finished ones — the default kitchen/delivery view.
const OPEN_FIRST_ORDER = [
  [
    sequelize.literal(
      "CASE status WHEN 'placed' THEN 0 WHEN 'preparing' THEN 1 WHEN 'ready' THEN 2 WHEN 'delivered' THEN 3 WHEN 'canceled' THEN 4 ELSE 5 END"
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
      ],
    });

    res.set('X-Total-Count', String(count));
    res.json(rows);
  })
);

/** Fulfillment lifecycle (Phase 5 foundation). */
const ORDER_STATUS_FLOW = ['placed', 'preparing', 'ready', 'delivered'];
const CANCELABLE_STATUSES = ['placed', 'preparing'];

// Status transitions are gated by role-appropriate permissions:
//   kitchen  → fulfill:orders (preparing/ready)
//   delivery → deliver:orders (delivered)
//   owner/manager → manage:orders (any transition incl. cancel)
const canAdvance = (req) =>
  req.userHas('manage:orders') || req.userHas('fulfill:orders');
const canDeliver = (req) =>
  req.userHas('manage:orders') || req.userHas('deliver:orders');

/** PATCH /api/orders/:id/status — advance/cancel an order's fulfillment state. */
router.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found');

    const { status } = req.body;
    if (!status || typeof status !== 'string') {
      throw new AppError(400, 'VALIDATION_ERROR', 'status is required');
    }

    if (status === 'canceled') {
      if (!req.userHas('manage:orders')) {
        throw new AppError(403, 'FORBIDDEN', 'Only managers can cancel orders');
      }
      if (!CANCELABLE_STATUSES.includes(order.status)) {
        throw new AppError(
          409,
          'INVALID_STATUS_TRANSITION',
          `Order in "${order.status}" cannot be canceled`
        );
      }
    } else {
      const currentIndex = ORDER_STATUS_FLOW.indexOf(order.status);
      const nextIndex = ORDER_STATUS_FLOW.indexOf(status);
      if (currentIndex === -1 || nextIndex === -1 || nextIndex !== currentIndex + 1) {
        throw new AppError(
          400,
          'INVALID_STATUS_TRANSITION',
          `Cannot move order from "${order.status}" to "${status}"`
        );
      }
      const permitted =
        status === 'delivered' ? canDeliver(req) : canAdvance(req);
      if (!permitted) {
        throw new AppError(
          403,
          'FORBIDDEN',
          `Your role cannot move orders to "${status}"`
        );
      }
    }

    order.status = status;
    await order.save();
    res.json({ id: order.id, status: order.status });
  })
);

/** POST /api/orders — create an order with server-side pricing and promotions. */
router.post(
  '/',
  requirePermission('place:orders'),
  asyncHandler(async (req, res) => {
    const { customer_name, customer_phone, customer_address, table_no, items } =
      createOrderSchema.parse(req.body);

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
        subtotal,
        total_discount: totalDiscount,
        grand_total: grandTotal,
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

    const fullOrder = await Order.findByPk(order.id, {
      include: [
        { model: OrderItem, as: 'items', include: [{ model: Product }] },
      ],
    });

    // WhatsApp order alert (Phase 5): fire-and-forget, never blocks/delays
    // order creation — the service swallows every failure internally.
    if (req.tenant?.id) {
      const tenant = await Tenant.findByPk(req.tenant.id);
      if (tenant) void sendOrderAlert(tenant, fullOrder, fullOrder.items || []);
    }

    res.status(201).json(fullOrder);
  })
);

export default router;
