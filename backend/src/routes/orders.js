import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import Product from '../models/Product.js';
import Promotion from '../models/Promotion.js';
import PromotionSlab from '../models/PromotionSlab.js';
import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import { applyPromotionsToCart } from '../utils/promotionEngine.js';
import { parsePagination } from '../utils/pagination.js';
import { createOrderSchema } from '../validators/order.js';

const router = express.Router();
router.use(authMiddleware);

/** GET /api/orders?limit=&offset= — paginated list (backward-compatible: returns an array). */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, offset } = parsePagination(req.query);

    const { rows, count } = await Order.findAndCountAll({
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
  asyncHandler(async (req, res) => {
    const { customer_name, customer_phone, customer_address, items } =
      createOrderSchema.parse(req.body);

    const products = await Product.findAll({
      where: { id: items.map((i) => i.product_id), enabled: true },
    });

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

    const promotions = await Promotion.findAll({
      include: [{ model: PromotionSlab, as: 'slabs' }],
    });

    const { items: enriched, subtotal, totalDiscount, grandTotal } =
      applyPromotionsToCart(cartItems, promotions);

    const order = await Order.create(
      {
        customer_name,
        customer_phone: customer_phone || null,
        customer_address: customer_address || null,
        subtotal,
        total_discount: totalDiscount,
        grand_total: grandTotal,
        items: enriched.map((i) => ({
          product_id: i.product.id,
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
