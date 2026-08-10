/**
 * CLI demo seeder for the Phase 7 analytics — makes the new dashboard
 * sections (peak-hours heatmap, category mix, retention, fulfillment time,
 * live panel, alerts) render live data on a fresh install.
 *
 *   npm run seed:analytics
 *   npm run seed:analytics -- --slug kfc-dhaka   # a single restaurant
 *
 * Idempotent per tenant via `settings.analyticsSeeded` — re-running skips
 * workspaces already enriched, so it never duplicates history. Adds:
 *   - ~14 days × 5 orders with a realistic Dhaka hour rhythm (lunch/dinner
 *     peaks) → the heatmap has real density;
 *   - a small pool of repeat customer phones → retention numbers are alive;
 *   - delivered orders with realistic fulfillment gaps (updatedAt later) →
 *     fulfillment-time stats;
 *   - payment records (cash/bKash/Nagad mix) → method mix stays consistent;
 *   - low-stock inventory rows on a couple of items → the LOW_STOCK alert
 *     fires on the dashboard.
 */
import { parseArgs } from 'node:util';
import sequelize from '../src/config/db.js';
import { ensureBootstrapData } from '../src/config/schemaSync.js';
import '../src/models/index.js';
import { Tenant, Product, Order, OrderItem, Payment, InventoryItem } from '../src/models/index.js';

const { values } = parseArgs({ options: { slug: { type: 'string' } } });

const DAYS = Number(process.env.ANALYTICS_DAYS || 14);
const ORDERS_PER_DAY = Number(process.env.ANALYTICS_ORDERS || 5);

const CUSTOMERS = [
  { name: 'Rahim Ahmed', phone: '01711112222' },
  { name: 'Karim Hossain', phone: '01822223333' },
  { name: 'Fatema Begum', phone: '01933334444' },
  { name: 'Rahim Ahmed', phone: '01711112222' }, // repeater
  { name: 'Nusrat Jahan', phone: '01644445555' },
  { name: 'Rahim Ahmed', phone: '01711112222' }, // repeater
  { name: 'Karim Hossain', phone: '01822223333' }, // repeater
  { name: 'Sharmin Akter', phone: '01366667777' },
];

const METHODS = ['cash', 'cash', 'cash', 'bkash', 'bkash', 'nagad'];
const TRX_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
const trx = () =>
  Array.from({ length: 10 }, () => TRX_CHARS[Math.floor(Math.random() * TRX_CHARS.length)]).join('');
const rint = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Dhaka-local hour weighted toward lunch (13–14) and dinner (20–21). */
function weightedHour() {
  const weights = Array.from({ length: 24 }, (_, h) => {
    if (h === 13 || h === 14 || h === 20 || h === 21) return 8;
    if (h >= 11 && h <= 22) return 3.5;
    if (h >= 8 && h <= 23) return 1.5;
    return 0.3;
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let h = 0; h < 24; h += 1) {
    r -= weights[h];
    if (r <= 0) return h;
  }
  return 13;
}

const orderNo = (tenantId, i) =>
  `ANA-${tenantId}-${Date.now().toString(36).toUpperCase()}-${i}${rint(10, 99)}`;

async function seedTenant(tenant) {
  if (tenant.settings?.analyticsSeeded) return 'already seeded (analyticsSeeded)';

  const products = await Product.findAll({
    where: { tenant_id: tenant.id, enabled: true },
  });
  if (products.length === 0) return 'no menu items';

  let created = 0;
  for (let day = 0; day < DAYS; day += 1) {
    for (let n = 0; n < ORDERS_PER_DAY; n += 1) {
      // Pure UTC math — timezone-independent. We pick a Dhaka-local hour and
      // shift it back 6h to UTC, so when the dashboard adds the offset back
      // the order lands in exactly the intended heatmap cell.
      const createdAt = new Date();
      createdAt.setUTCDate(createdAt.getUTCDate() - day);
      createdAt.setUTCHours((weightedHour() + 24 - 6) % 24, rint(0, 59), 0, 0);

      const count = rint(1, 3);
      const chosen = [...products].sort(() => Math.random() - 0.5).slice(0, count);
      const lines = chosen.map((p) => ({ product: p, qty: rint(1, 3) }));
      const subtotal = lines.reduce((s, l) => s + l.product.price * l.qty, 0);
      const status = Math.random() > 0.08 ? 'delivered' : 'canceled';
      const method = pick(METHODS);
      const paid = status !== 'canceled';
      const customer = pick(CUSTOMERS);
      const isDelivery = Math.random() > 0.4;
      const minutesToDeliver = rint(18, 55);
      const deliveredAt = new Date(createdAt.getTime() + minutesToDeliver * 60 * 1000);

      const order = await Order.create(
        {
          tenant_id: tenant.id,
          order_no: orderNo(tenant.id, created + n),
          customer_name: customer.name,
          customer_phone: customer.phone,
          customer_address: isDelivery ? 'Dhaka, Bangladesh' : null,
          table_no: isDelivery ? null : rint(1, 12),
          subtotal,
          total_discount: 0,
          grand_total: subtotal,
          status,
          type: isDelivery ? 'delivery' : 'pickup',
          payment_method: method,
          payment_status: paid ? 'paid' : 'unpaid',
          createdAt,
          items: lines.map((l) => ({
            tenant_id: tenant.id,
            product_id: l.product.id,
            item_name: l.product.name,
            quantity: l.qty,
            unit_price: l.product.price,
            weight_per_unit_gm: l.product.weight_gm,
            total_weight_gm: l.product.weight_gm * l.qty,
            discount: 0,
            line_total: l.product.price * l.qty,
          })),
        },
        { include: [{ model: OrderItem, as: 'items' }] }
      );

      // Sequelize stamps updated_at at insert time even when a value is
      // provided, so backdate the fulfillment timestamp with a raw UPDATE.
      // (created_at itself IS respected on create — verified empirically.)
      await sequelize.query('UPDATE orders SET updated_at = :ua WHERE id = :id', {
        replacements: { id: order.id, ua: deliveredAt },
      });

      await Payment.create({
        tenant_id: tenant.id,
        order_id: order.id,
        method,
        amount: subtotal,
        status: paid ? 'paid' : 'pending',
        reference: paid && method !== 'cash' ? trx() : null,
        paid_at: paid ? createdAt : null,
        createdAt,
        updatedAt: createdAt,
      });
      created += 1;
    }
  }

  // Low-stock inventory on two items so the LOW_STOCK alert shows (upsert).
  const targets = [...products].sort(() => Math.random() - 0.5).slice(0, 2);
  for (const p of targets) {
    await InventoryItem.upsert({
      tenant_id: tenant.id,
      menu_item_id: p.id,
      name: p.name,
      stock_qty: rint(0, 3),
      low_stock_at: 8,
      unit: 'pcs',
    });
  }

  const settings = { ...(tenant.settings || {}), analyticsSeeded: true };
  await tenant.update({ settings });
  return `created ${created} analytics orders (${DAYS} days × ${ORDERS_PER_DAY}/day)`;
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

  let seeded = 0;
  let skipped = 0;
  for (const tenant of tenants) {
    const result = await seedTenant(tenant);
    if (result.startsWith('created')) seeded += 1;
    else skipped += 1;
    console.log(`  • ${tenant.slug}: ${result}`);
  }
  console.log(`✅ Analytics demo data: ${seeded}/${tenants.length} tenants seeded, ${skipped} skipped`);
  await sequelize.close();
} catch (err) {
  console.error('Failed to seed analytics demo data:', err.message);
  if (process.env.SEED_DEBUG) console.error(err);
  await sequelize.close().catch(() => {});
  process.exit(1);
}
