import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import Product from '../models/Product.js';
import Promotion from '../models/Promotion.js';
import PromotionSlab from '../models/PromotionSlab.js';
import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import { applyPromotionsToCart } from '../utils/promotionEngine.js';

const router = express.Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  const orders = await Order.findAll({
    order: [['id', 'DESC']],
    include: [
      {
        model: OrderItem,
        as: 'items',
        include: [{ model: Product }]
      }
    ]
  });
  res.json(orders);
});

router.post('/', async (req, res) => {
  try {
    const { customer_name, customer_phone, customer_address, items } = req.body;

    const products = await Product.findAll({
      where: { id: items.map((i) => i.product_id), enabled: true }
    });

    const productMap = {};
    products.forEach((p) => (productMap[p.id] = p));

    const cartItems = items.map((i) => ({
      product: productMap[i.product_id],
      quantity: i.quantity
    }));

    const promotions = await Promotion.findAll({
      include: [{ model: PromotionSlab, as: 'slabs' }]
    });

    const { items: enriched, subtotal, totalDiscount, grandTotal } =
      applyPromotionsToCart(cartItems, promotions);

    const order = await Order.create(
      {
        customer_name,
        customer_phone,
        customer_address,
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
          line_total: i.lineTotal
        }))
      },
      { include: [{ model: OrderItem, as: 'items' }] }
    );

    const fullOrder = await Order.findByPk(order.id, {
      include: [
        { model: OrderItem, as: 'items', include: [{ model: Product }] }
      ]
    });

    res.status(201).json(fullOrder);
  } catch (e) {
    console.error(e);
    res.status(400).json({ message: e.message });
  }
});

export default router;
