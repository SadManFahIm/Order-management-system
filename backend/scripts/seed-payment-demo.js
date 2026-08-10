/**
 * CLI demo seeder — Phase 6 payment features (split + refund) so a fresh
 * install can SEE the new lifecycle in the Orders/Reports UI immediately:
 *
 *   - "Split Demo" order: bKash 50% + Cash 50% (one pending part, one paid)
 *   - "Refunded Demo" order: paid then fully refunded (audit trail visible)
 *
 * Usage:
 *   npm run seed:payment-demo
 *   npm run seed:payment-demo -- --slug kfc-dhaka   # a single restaurant
 *
 * Idempotent: a tenant that already has a Split Demo order is skipped, so
 * re-running never duplicates. Same server-side pricing path as the API
 * (applyPromotionsToCart) and the seed-orders script.
 */
import { parseArgs } from 'node:util';
import sequelize from '../src/config/db.js';
import { ensureBootstrapData } from '../src/config/schemaSync.js';
import '../src/models/index.js';
import { Tenant, Product, Order, OrderItem, Payment } from '../src/models/index.js';
import { applyPromotionsToCart } from '../src/utils/promotionEngine.js';

const { values } = parseArgs({ options: { slug: { type: 'string' } } });

const orderNo = (tenantId, tag) =>
  `ORD-${tenantId}-${tag}-${Date.now().toString(36).toUpperCase()}`;

const priceItems = (items) => {
  const { items: enriched, subtotal, totalDiscount, grandTotal } = applyPromotionsToCart(items, []);
  return {
    items: enriched,
    subtotal,
    totalDiscount,
    grandTotal,
  };
};

async function seedTenant(tenant) {
  const products = await Product.findAll({
    where: { tenant_id: tenant.id, enabled: true },
  });
  if (products.length === 0) return 'no menu items';

  const hasSplit = await Order.count({ where: { tenant_id: tenant.id, customer_name: 'Split Demo' } });
  const hasRefund = await Order.count({ where: { tenant_id: tenant.id, customer_name: 'Refunded Demo' } });
  const made = [];

  if (hasSplit === 0) {
    const a = products[0];
    const b = products[1] || products[0];
    const price = (p) => Number(p.price);
    const { items, subtotal, totalDiscount, grandTotal } = priceItems([
      { product: a, quantity: 1 },
      { product: b, quantity: 1 },
    ]);
    const half = Math.round((grandTotal / 2) * 100) / 100;
    const rest = Math.round((grandTotal - half) * 100) / 100;

    const order = await Order.create(
      {
        tenant_id: tenant.id,
        order_no: orderNo(tenant.id, 'SPLIT'),
        customer_name: 'Split Demo',
        customer_phone: '01700000001',
        table_no: 5,
        subtotal,
        total_discount: totalDiscount,
        grand_total: grandTotal,
        status: 'placed',
        type: 'pickup',
        payment_method: 'split',
        payment_status: 'partial',
        items: items.map((li) => ({
          tenant_id: tenant.id,
          product_id: li.product.id,
          item_name: li.product.name,
          quantity: li.quantity,
          unit_price: li.product.price,
          weight_per_unit_gm: li.product.weight_gm,
          total_weight_gm: li.totalWeightGm,
          discount: li.discount,
          line_total: li.lineTotal,
        })),
      },
      { include: [{ model: OrderItem, as: 'items' }] }
    );
    // bKash part pending at the counter, cash part collected on the spot.
    await Payment.create({
      tenant_id: tenant.id,
      order_id: order.id,
      method: 'bkash',
      amount: half,
      status: 'pending',
      reference: 'SPLITDEMO-BK',
      paid_at: null,
    });
    await Payment.create({
      tenant_id: tenant.id,
      order_id: order.id,
      method: 'cash',
      amount: rest,
      status: 'paid',
      paid_at: new Date(),
    });
    made.push(`Split Demo #${order.id} (৳${grandTotal}: bKash ${half} + cash ${rest})`);
  }

  if (hasRefund === 0) {
    const p = products[0];
    const { items, subtotal, totalDiscount, grandTotal } = priceItems([
      { product: p, quantity: 1 },
    ]);
    const order = await Order.create(
      {
        tenant_id: tenant.id,
        order_no: orderNo(tenant.id, 'REFUND'),
        customer_name: 'Refunded Demo',
        customer_phone: '01700000002',
        table_no: null,
        subtotal,
        total_discount: totalDiscount,
        grand_total: grandTotal,
        status: 'delivered',
        type: 'pickup',
        payment_method: 'cash',
        payment_status: 'refunded',
        items: items.map((li) => ({
          tenant_id: tenant.id,
          product_id: li.product.id,
          item_name: li.product.name,
          quantity: li.quantity,
          unit_price: li.product.price,
          weight_per_unit_gm: li.product.weight_gm,
          total_weight_gm: li.totalWeightGm,
          discount: li.discount,
          line_total: li.lineTotal,
        })),
      },
      { include: [{ model: OrderItem, as: 'items' }] }
    );
    await Payment.create({
      tenant_id: tenant.id,
      order_id: order.id,
      method: 'cash',
      amount: grandTotal,
      status: 'refunded',
      refunded_amount: grandTotal,
      refunded_at: new Date(),
      refund_reason: 'Demo: customer canceled after delivery',
      paid_at: new Date(),
    });
    made.push(`Refunded Demo #${order.id} (৳${grandTotal} refunded)`);
  }

  return made.length > 0 ? made.join(' · ') : 'already seeded';
}

try {
  await sequelize.sync();
  await ensureBootstrapData();

  const where = values.slug ? { slug: values.slug } : {};
  const tenants = await Tenant.findAll({ where, order: [['id', 'ASC']] });
  if (tenants.length === 0) {
    console.error('No tenants found — run npm run seed:restaurants first.');
    process.exit(1);
  }

  for (const tenant of tenants) {
    console.log(`  • ${tenant.slug}: ${await seedTenant(tenant)}`);
  }
  console.log(`✅ Payment demo data: ${tenants.length} workspace(s) processed`);
  await sequelize.close();
} catch (err) {
  console.error('Failed to seed payment demo:', err.message);
  if (process.env.SEED_DEBUG) console.error(err);
  await sequelize.close().catch(() => {});
  process.exit(1);
}
