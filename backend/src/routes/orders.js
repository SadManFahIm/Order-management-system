import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { resolveTenant, requireTenant } from '../middleware/tenant.js';
import Product from '../models/Product.js';
import Promotion from '../models/Promotion.js';
import PromotionSlab from '../models/PromotionSlab.js';
import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import { applyPromotionsToCart } from '../utils/promotionEngine.js';
import { parsePagination } from '../utils/pagination.js';
import { createOrderSchema } from '../validators/order.js';

const router = express.Router();
router.use(authMiddleware, resolveTenant, requireTenant);

/** GET /api/orders?limit=&offset= — paginated list (backward-compatible: returns an array). */
router.get(
  '/',
  requirePermission('view:orders'),
  asyncHandler(async (req, res) => {
    const { limit, offset } = parsePagination(req.query);

    const { rows, count } = await Order.findAndCountAll({
      where: { tenant_id: req.tenant.id },
      order: [['id', 'DESC']],
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

/** POST /api/orders — create an order with server-side pricing and promotions. */
router.post(
  '/',
  requirePermission('place:orders'),
  asyncHandler(async (req, res) => {
    const { customer_name, customer_phone, customer_address, items } =
      createOrderSchema.parse(req.body);

    // Fetch products and promotions concurrently — independent reads.
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

    res.status(201).json(fullOrder);
  })
);

export default router;
