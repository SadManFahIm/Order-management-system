/**
 * CLI demo seeder — Phase 6 payment features (split + refund) so a fresh
 * install can SEE the new lifecycle in the Orders/Reports UI immediately:
 *
 *   - "Split Demo" order: bKash 50% + Cash 50% (one pending part, one paid)
 *   - "Split Bill Demo" order: 3 diners split BY ITEM with per-diner parts
 *     + allocation rows (cashier split panel + per-diner receipts + the
 *     dashboard's split-method analytics chart are live immediately)
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
import { Tenant, Product, Order, OrderItem, Payment, OrderSplitItem, Table } from '../src/models/index.js';
import { applyPromotionsToCart } from '../src/utils/promotionEngine.js';
import { computeSplitParts } from '../src/services/splitService.js';

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

  const hasSplitBilling = await Order.count({
    where: { tenant_id: tenant.id, customer_name: 'Split Bill Demo' },
  });

  if (hasSplitBilling === 0) {
    // Per-diner split billing (migration 013) — a dine-in order split across
    // three diners by ITEM with per-diner receipts, so the cashier split
    // panel + diner receipt + split-method analytics chart are live on a
    // fresh install. Parts: 2 diners pay cash on the spot, 1 pays bKash
    // (pending until confirmed at the counter).
    const [p1, p2, p3] = products;
    if (p1 && p2 && p3) {
      const table = await Table.findOne({
        where: { tenant_id: tenant.id, is_active: true },
      });
      const { items, subtotal, totalDiscount, grandTotal } = priceItems([
        { product: p1, quantity: 2 },
        { product: p2, quantity: 1 },
        { product: p3, quantity: 1 },
      ]);

      const order = await Order.create(
        {
          tenant_id: tenant.id,
          order_no: orderNo(tenant.id, 'SPLITBILL'),
          customer_name: 'Split Bill Demo',
          customer_phone: '01700000003',
          table_no: table ? table.table_no : 1,
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

      // Diner 1: first item (2 units), Diner 2: second item, Diner 3:
      // third item — server-side allocation math (splitService).
      const orderWithItems = await Order.findByPk(order.id, {
        include: [{ model: OrderItem, as: 'items' }],
      });
      const [line1, line2, line3] = orderWithItems.items;
      const parts = computeSplitParts({
        order: orderWithItems,
        mode: 'item',
        tenant,
        diners: [
          { label: 'Rahim', method: 'cash' },
          { label: 'Karim', method: 'cash' },
          { label: 'Sadia', method: 'bkash' },
        ],
        allocations: [
          { orderItemId: line1.id, quantity: 2, dinerIndex: 0 },
          { orderItemId: line2.id, quantity: 1, dinerIndex: 1 },
          { orderItemId: line3.id, quantity: 1, dinerIndex: 2 },
        ],
      });

      const now = new Date();
      const payments = await Payment.bulkCreate(
        parts.map((p, i) => ({
          tenant_id: tenant.id,
          order_id: order.id,
          method: p.method,
          amount: p.amount,
          status: p.method === 'cash' ? 'paid' : 'pending',
          reference: p.reference || (p.method === 'bkash' ? 'SPLITBILL-BK' : null),
          notes: p.note,
          paid_at: p.method === 'cash' ? now : null,
          split_method: 'item',
          diner_index: i + 1,
        }))
      );
      const splitItems = [];
      parts.forEach((p, i) => {
        (p.items || []).forEach((it) => {
          splitItems.push({
            tenant_id: tenant.id,
            order_id: order.id,
            payment_id: payments[i].id,
            menu_item_id: it.menu_item_id ?? null,
            item_name: it.item_name,
            quantity: it.quantity,
            unit_amount: it.unit_amount,
            discount_amount: it.discount_amount,
            line_amount: it.line_amount,
            vat_rate: it.vat_rate,
          });
        });
      });
      if (splitItems.length) await OrderSplitItem.bulkCreate(splitItems);
      made.push(
        `Split Bill Demo #${order.id} (৳${grandTotal}: ${parts
          .map((p) => `${p.note} ${p.method} ${p.amount}`)
          .join(' + ')})`
      );
    }
  }

  if (hasSplit === 0) {
    const a = products[0];
    const b = products[1] || products[0];
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

  // Locked Split Demo — a dine-in split whose bKash part has been COLLECTED
  // at the counter, so the re-split guard is live (🔒 banner, Apply disabled)
  // on a fresh install. Only seeded when the workspace accepts bKash — the
  // demo must look real to the merchant.
  const hasLocked = await Order.count({
    where: { tenant_id: tenant.id, customer_name: 'Locked Split Demo' },
  });
  const bkashEnabled = tenant.settings?.paymentMethods?.bkash?.enabled;
  if (hasLocked === 0 && bkashEnabled) {
    const p = products[0];
    const table = await Table.findOne({
      where: { tenant_id: tenant.id, is_active: true },
    });
    const { items, subtotal, totalDiscount, grandTotal } = priceItems([
      { product: p, quantity: 2 },
    ]);
    const order = await Order.create(
      {
        tenant_id: tenant.id,
        order_no: orderNo(tenant.id, 'LOCKED'),
        customer_name: 'Locked Split Demo',
        customer_phone: '01700000004',
        table_no: table ? table.table_no : 1,
        subtotal,
        total_discount: totalDiscount,
        grand_total: grandTotal,
        status: 'placed',
        type: 'pickup',
        payment_method: 'split',
        payment_status: 'paid',
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
    const orderWithItems = await Order.findByPk(order.id, {
      include: [{ model: OrderItem, as: 'items' }],
    });
    const parts = computeSplitParts({
      order: orderWithItems,
      mode: 'equal',
      tenant,
      diners: [
        { label: 'Sadia', method: 'bkash' },
        { label: 'Karim', method: 'cash' },
      ],
    });
    const now = new Date();
    await Payment.bulkCreate(
      parts.map((pt, i) => ({
        tenant_id: tenant.id,
        order_id: order.id,
        method: pt.method,
        amount: pt.amount,
        // Both collected at the counter — the bKash part is what LOCKS it.
        status: 'paid',
        reference: pt.method === 'bkash' ? 'LOCKED-BK-1' : null,
        notes: pt.note,
        paid_at: now,
        split_method: 'equal',
        diner_index: i + 1,
      }))
    );
    made.push(
      `Locked Split Demo #${order.id} (৳${grandTotal}: bKash collected → re-split locked)`
    );
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
