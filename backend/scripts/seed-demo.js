/**
 * CLI demo-data seeder — idempotent, data-driven.
 *
 * Recreates the legacy demo state the pre-cutover dev database carried (a
 * couple of promotions + orders on the default workspace) so the Orders and
 * Promotions pages exercise real data. Orders are built through the SAME
 * server-side pricing path the API uses (applyPromotionsToCart), so line
 * totals always reconcile. Safe to re-run; nothing is duplicated.
 *
 * Usage: npm run seed:demo
 */
import sequelize from '../src/config/db.js';
import { ensureBootstrapData } from '../src/config/schemaSync.js';
import '../src/models/index.js';
import { Tenant, Product, Promotion, Order, OrderItem } from '../src/models/index.js';
import { applyPromotionsToCart } from '../src/utils/promotionEngine.js';
import { RESTAURANT_SEEDS } from './data/restaurants.js';

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const orderNo = () =>
  `DEMO-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;

const DEMO_PROMOTIONS = [
  { title: 'Weekend 10% off', type: 'percentage', percentage_value: 10, start_date: '2026-01-01', end_date: '2026-12-31', enabled: true },
  { title: 'Fixed ৳50 off', type: 'fixed', fixed_value: 50, start_date: '2026-01-01', end_date: '2026-12-31', enabled: true },
];

const DEMO_ORDERS = [
  { customer_name: 'Walk-in Demo', customer_phone: '01711112222', customer_address: 'Gulshan, Dhaka', itemNames: [] },
  { customer_name: 'Phone Order', customer_phone: '01733334444', customer_address: null, itemNames: [] },
];

try {
  await ensureBootstrapData(); // plans + default tenant

  const tenant = await Tenant.findOne({ where: { slug: 'default-restaurant' } });
  if (!tenant) throw new Error('Default tenant not found — run npm run seed:admin first');

  // 1. Promotions (only when the workspace has none).
  const promoCount = await Promotion.count({ where: { tenant_id: tenant.id } });
  let promos = [];
  if (promoCount === 0) {
    for (const p of DEMO_PROMOTIONS) {
      promos.push(await Promotion.create({ tenant_id: tenant.id, ...p }));
    }
    console.log(`✅ Demo promotions created (${promos.length})`);
  } else {
    promos = await Promotion.findAll({ where: { tenant_id: tenant.id } });
    console.log(`ℹ️  Promotions already present (${promoCount}) — skipping`);
  }

  // 2. Menu items for the default workspace (only when empty) — pulled from
  // the shared data-driven restaurant seed, never hard-coded.
  let products = await Product.findAll({
    where: { tenant_id: tenant.id, enabled: true },
    order: [['id', 'ASC']],
    limit: 4,
  });
  if (products.length === 0) {
    const sourceItems = RESTAURANT_SEEDS.flatMap((r) => r.items).slice(0, 4);
    for (const item of sourceItems) {
      products.push(
        await Product.create({
          tenant_id: tenant.id,
          name: item.name,
          description: item.description ?? null,
          price: item.price,
          weight_gm: item.weight_gm,
          enabled: true,
          prep_minutes: item.prep_minutes ?? null,
        })
      );
    }
    console.log(`✅ Default-workspace demo menu items created (${products.length})`);
  }

  // 3. Orders (only when the workspace has none).
  const orderCount = await Order.count({ where: { tenant_id: tenant.id } });
  if (orderCount === 0) {
    if (products.length < 1) {
      console.log('ℹ️  No products to build demo orders from — skipping orders');
    } else {
      for (const [i, demo] of DEMO_ORDERS.entries()) {
        const picks = products.slice(0, i + 1);
        const cartItems = picks.map((p, j) => ({ product: p, quantity: j === 0 ? 2 : 1 }));
        const { items, subtotal, totalDiscount, grandTotal } = applyPromotionsToCart(cartItems, promos);

        await Order.create(
          {
            tenant_id: tenant.id,
            order_no: orderNo(),
            customer_name: demo.customer_name,
            customer_phone: demo.customer_phone,
            customer_address: demo.customer_address,
            subtotal,
            total_discount: totalDiscount,
            grand_total: grandTotal,
            items: items.map((i) => ({
              tenant_id: tenant.id,
              product_id: i.product.id,
              item_name: i.product.name,
              quantity: i.quantity,
              unit_price: i.product.price,
              weight_per_unit_gm: i.product.weight_gm,
              total_weight_gm: i.totalWeightGm,
              discount: round2(i.discount),
              line_total: round2(i.lineTotal),
            })),
          },
          { include: [{ model: OrderItem, as: 'items' }] }
        );
      }
      console.log(`✅ Demo orders created (${DEMO_ORDERS.length}) via the real pricing path`);
    }
  } else {
    console.log(`ℹ️  Orders already present (${orderCount}) — skipping`);
  }

  await sequelize.close();
  console.log('✅ seed:demo done');
} catch (error) {
  console.error('seed:demo failed:', error.message);
  await sequelize.close().catch(() => {});
  process.exit(1);
}
