/**
 * CLI demo-order seeder — backfills a realistic 7-day order history for the
 * seeded Dhaka restaurants so the dashboard analytics charts (Phase 4 R3)
 * render live data instead of empty axes.
 *
 * Usage:
 *   npm run seed:orders
 *   npm run seed:orders -- --slug kfc-dhaka   # a single restaurant
 *
 * Idempotent: a tenant that already has orders is skipped (seed-once
 * semantics), so re-running never duplicates history. Orders are built
 * through the SAME server-side pricing path the API uses
 * (applyPromotionsToCart), so line totals and order totals always
 * reconcile. Timestamps are spread across the previous 7 days with a
 * realistic daily rhythm (busy lunch/dinner hours).
 */
import { parseArgs } from 'node:util';
import sequelize from '../src/config/db.js';
import { ensureBootstrapData } from '../src/config/schemaSync.js';
import '../src/models/index.js';
import { Tenant, Product, Order, OrderItem, Payment } from '../src/models/index.js';
import { applyPromotionsToCart } from '../src/utils/promotionEngine.js';

const { values } = parseArgs({ options: { slug: { type: 'string' } } });

const ORDERS_PER_TENANT = 12;

const CUSTOMERS = [
  { name: 'Rahim Ahmed', phone: '01711112222' },
  { name: 'Karim Hossain', phone: '01822223333' },
  { name: 'Fatema Begum', phone: '01933334444' },
  { name: 'Nusrat Jahan', phone: '01644445555' },
  { name: 'Tanvir Islam', phone: '01555556666' },
  { name: 'Sharmin Akter', phone: '01366667777' },
  { name: 'Mehedi Hasan', phone: '01777778888' },
  { name: 'Sadia Rahman', phone: '01888889999' },
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rint = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Weighted toward completed orders so the "fulfilment lifecycle" chart reads
// like a real day: mostly delivered, some in flight, a few canceled.
const STATUSES = ['delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'ready', 'preparing', 'placed', 'placed', 'canceled'];

// Payment mix — cash + mobile wallets (Dhaka reality) so the dashboard's
// revenue-by-method chart is alive.
const METHODS = ['cash', 'cash', 'cash', 'cash', 'bkash', 'bkash', 'bkash', 'nagad', 'nagad', 'card'];
const TRX_PREFIX = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
const trxRef = () =>
  Array.from({ length: 10 }, () => TRX_PREFIX[Math.floor(Math.random() * TRX_PREFIX.length)]).join('');

const orderNo = (tenantId, i) =>
  `ORD-${tenantId}-${Date.now().toString(36).toUpperCase()}-${i}${rint(100, 999)}`;

/** Spreads the 12 orders over 7 days with a busier recent past. */
const daysAgoFor = (i) => {
  if (i < 4) return 0; // today — the stat cards light up
  if (i < 7) return 1;
  if (i < 9) return 2;
  if (i < 10) return 3;
  return rint(4, 6);
};

/**
 * Backfills payment records for orders seeded before payments existed
 * (migration 008) — keeps the dashboard's revenue-by-method chart alive
 * without wiping any data. Idempotent: orders with payments are skipped.
 */
async function backfillPayments(tenant) {
  const orders = await Order.findAll({
    where: { tenant_id: tenant.id },
    include: [{ model: Payment, as: 'payments' }],
  });
  let added = 0;
  for (const order of orders) {
    if (order.payments && order.payments.length > 0) continue;
    const method =
      order.payment_method && METHODS.includes(order.payment_method)
        ? order.payment_method
        : pick(METHODS);
    const paid = order.payment_status === 'paid';
    await Payment.create({
      tenant_id: tenant.id,
      order_id: order.id,
      method,
      amount: order.grand_total,
      status: paid ? 'paid' : 'pending',
      reference: paid && method !== 'cash' ? trxRef() : null,
      paid_at: paid ? order.createdAt : null,
      createdAt: order.createdAt,
      updatedAt: order.createdAt,
    });
    added += 1;
  }
  return added;
}

async function seedTenant(tenant) {
  const products = await Product.findAll({
    where: { tenant_id: tenant.id, enabled: true },
  });
  if (products.length === 0) return 'no menu items';

  const existing = await Order.count({ where: { tenant_id: tenant.id } });
  if (existing > 0) {
    await backfillPayments(tenant);
    return `already has ${existing} orders (payments backfilled)`;
  }

  let created = 0;
  for (let i = 0; i < ORDERS_PER_TENANT; i += 1) {
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - daysAgoFor(i));
    createdAt.setHours(rint(9, 22), rint(0, 59), 0, 0);

    const count = rint(1, 3);
    const chosen = [...products].sort(() => Math.random() - 0.5).slice(0, count);
    const cartItems = chosen.map((p) => ({ product: p, quantity: rint(1, 3) }));
    const { items, subtotal, totalDiscount, grandTotal } = applyPromotionsToCart(cartItems, []);

    const status = pick(STATUSES);
    // Dine-in (pickup) orders get a physical table (QR table menu, 1–12);
    // deliveries don't. Keeps the Orders table looking like a real day.
    const isDelivery = Math.random() > 0.4;
    const paid = status !== 'canceled' && Math.random() > 0.2;
    const method = pick(METHODS);
    const order = await Order.create(
      {
        tenant_id: tenant.id,
        order_no: orderNo(tenant.id, i),
        customer_name: pick(CUSTOMERS).name,
        customer_phone: pick(CUSTOMERS).phone,
        customer_address: isDelivery ? 'Dhaka, Bangladesh' : null,
        table_no: isDelivery ? null : rint(1, 12),
        subtotal,
        total_discount: totalDiscount,
        grand_total: grandTotal,
        status,
        type: isDelivery ? 'delivery' : 'pickup',
        payment_method: method,
        payment_status: paid ? 'paid' : 'unpaid',
        createdAt,
        updatedAt: createdAt,
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

    // Payment record mirroring the order — cash is paid on the spot, mobile
    // wallets carry a trxID once confirmed (paid orders here are confirmed).
    await Payment.create({
      tenant_id: tenant.id,
      order_id: order.id,
      method,
      amount: grandTotal,
      status: paid ? 'paid' : 'pending',
      reference: paid && method !== 'cash' ? trxRef() : null,
      paid_at: paid ? createdAt : null,
      createdAt,
      updatedAt: createdAt,
    });
    created += 1;
  }
  return `created ${created} orders`;
}

try {
  await sequelize.sync();
  await ensureBootstrapData();

  const where = values.slug ? { slug: values.slug } : {};
  const tenants = await Tenant.findAll({ where, order: [['id', 'ASC']] });
  if (tenants.length === 0) {
    console.error('No tenants found to seed — run npm run seed:restaurants first.');
    process.exit(1);
  }

  let createdTotal = 0;
  let skipped = 0;
  for (const tenant of tenants) {
    const result = await seedTenant(tenant);
    if (result.startsWith('created')) createdTotal += 1;
    else skipped += 1;
    console.log(`  • ${tenant.slug}: ${result}`);
  }

  console.log(`✅ Demo orders: ${createdTotal}/${tenants.length} tenants seeded, ${skipped} skipped`);
  await sequelize.close();
} catch (err) {
  console.error('Failed to seed orders:', err.message);
  if (process.env.SEED_DEBUG) console.error(err);
  await sequelize.close().catch(() => {});
  process.exit(1);
}
