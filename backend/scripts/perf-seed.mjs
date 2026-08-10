/**
 * perf:seed — generate a large, realistic dataset for the dashboard
 * performance test (Phase 7, roadmap acceptance: <2s p95).
 *
 *   npm run perf:seed                     # 3 tenants × 180 days × 10 orders
 *   PERF_TENANTS=5 PERF_DAYS=240 npm run perf:seed
 *   PERF_DB=perf2.sqlite npm run perf:seed
 *
 * ⚠️  The target database is a SCRATCH benchmark file (perf.sqlite by
 * default) and is WIPED first — never point this at the dev/test data.
 * Follow with `npm run perf:test` (same PERF_DB) to benchmark.
 *
 * Data shape: per tenant 5 menu categories + 10 products; per day a
 * Dhaka-time weighted order spread (busier lunch/dinner hours), ~80% paid
 * with a realistic method mix, ~2 line items each.
 */
import fs from 'node:fs';
import bcrypt from 'bcryptjs';

process.env.DB_STORAGE = process.env.PERF_DB || 'perf.sqlite';
process.env.DB_DIALECT = 'sqlite';
process.env.NODE_ENV = 'test';
fs.rmSync(process.env.DB_STORAGE, { force: true });

const { default: sequelize } = await import('../src/config/db.js');
const { migrateUp } = await import('./migrate.js');
const { ensureBootstrapData } = await import('../src/config/schemaSync.js');
const {
  User,
  Tenant,
  UserTenant,
  Product,
  MenuCategory,
  Order,
  OrderItem,
  Payment,
} = await import('../src/models/index.js');

const TENANTS = Number(process.env.PERF_TENANTS || 3);
const DAYS = Number(process.env.PERF_DAYS || 180);
const ORDERS_PER_DAY = Number(process.env.PERF_ORDERS_PER_DAY || 10);

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const CATEGORY_NAMES = ['Burgers', 'Rice & Biryani', 'Kebab & Grill', 'Beverages', 'Desserts'];
const PRODUCT_NAMES = ['Zinger', 'Classic Burger', 'Chicken Biryani', 'Beef Kebab', 'Grilled Wings', 'Coke', 'Fresh Lime', 'Cold Coffee', 'Brownie', 'Ice Cream'];
const METHOD_POOL = ['cash', 'cash', 'cash', 'bkash', 'bkash', 'nagad', 'card'];
const STATUS_POOL = ['delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'ready', 'preparing', 'placed', 'canceled'];
const TRX_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
const trx = () => Array.from({ length: 10 }, () => TRX_CHARS[Math.floor(Math.random() * TRX_CHARS.length)]).join('');
const rint = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Dhaka-local hour with a realistic rhythm (busy lunch/dinner peaks). */
function weightedHour() {
  const weights = Array.from({ length: 24 }, (_, h) => {
    if (h === 13 || h === 14 || h === 21) return 9; // lunch + dinner peaks
    if (h >= 12 && h <= 22) return 4;
    if (h >= 9 && h <= 23) return 2;
    return 0.4;
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let h = 0; h < 24; h += 1) {
    r -= weights[h];
    if (r <= 0) return h;
  }
  return 13;
}

await migrateUp(sequelize);
await ensureBootstrapData();

// Auth user for perf:test (logs in as this workspace's manager).
const [user] = await User.findOrCreate({
  where: { email: 'perf@oms.dev' },
  defaults: {
    name: 'Perf Manager',
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  },
});

const tenants = [];
for (let t = 1; t <= TENANTS; t += 1) {
  const tenant = await Tenant.create({ name: `Perf Restaurant ${t}`, slug: `perf-restaurant-${t}` });
  await UserTenant.create({ user_id: user.id, tenant_id: tenant.id, role: 'manager' });

  const categories = [];
  for (const [i, name] of CATEGORY_NAMES.entries()) {
    categories.push(await MenuCategory.create({ tenant_id: tenant.id, name, sort_order: i }));
  }
  const products = [];
  for (const [i, name] of PRODUCT_NAMES.entries()) {
    products.push(
      await Product.create({
        tenant_id: tenant.id,
        name,
        price: [250, 200, 350, 300, 280, 60, 90, 180, 150, 120][i],
        weight_gm: 250,
        enabled: true,
        category_id: categories[i % categories.length].id,
      })
    );
  }

  let orderBatch = [];
  let itemBatch = [];
  let paymentBatch = [];
  let orderSeq = 0;

  const flush = async () => {
    if (orderBatch.length === 0) return;
    const orders = await Order.bulkCreate(orderBatch);
    // OrderItem / Payment need the created ids — pair them 1:1 with the batch.
    const withIds = orderBatch.map((raw, i) => ({ raw, id: orders[i].id }));
    const items = [];
    const payments = [];
    for (const { raw, id } of withIds) {
      for (const it of raw.__items) items.push({ ...it, order_id: id });
      payments.push({ ...raw.__payment, order_id: id });
    }
    await OrderItem.bulkCreate(items);
    await Payment.bulkCreate(payments);
    orderBatch = [];
    itemBatch = [];
    paymentBatch = [];
  };

  for (let day = 0; day < DAYS; day += 1) {
    for (let n = 0; n < ORDERS_PER_DAY; n += 1) {
      const createdAt = new Date(
        Date.now() - day * 24 * 60 * 60 * 1000 - rint(0, 6) * 3600 * 1000
      );
      // Force a Dhaka-local hour with the busy-rhythm weights (the UTC clock
      // shifts by 6h, but the heatmap buckets on the shifted time).
      const dh = new Date(createdAt.getTime() + DHAKA_OFFSET_MS);
      dh.setUTCHours(weightedHour(), rint(0, 59), 0, 0);
      createdAt.setTime(dh.getTime() - DHAKA_OFFSET_MS);

      const lineCount = rint(1, 3);
      const chosen = [...products].sort(() => Math.random() - 0.5).slice(0, lineCount);
      const lines = chosen.map((p) => ({ product: p, qty: rint(1, 3) }));
      const subtotal = lines.reduce((s, l) => s + l.product.price * l.qty, 0);
      const status = pick(STATUS_POOL);
      const method = pick(METHOD_POOL);
      const paid = status !== 'canceled' && Math.random() > 0.2;

      orderSeq += 1;
      const orderNo = `PERF-${t}-${orderSeq}`;
      orderBatch.push({
        tenant_id: tenant.id,
        order_no: orderNo,
        customer_name: `Customer ${rint(1, 400)}`,
        customer_phone: `01${String(rint(100000000, 199999999)).slice(0, 9)}`,
        table_no: Math.random() > 0.4 ? rint(1, 12) : null,
        subtotal,
        total_discount: 0,
        grand_total: subtotal,
        status,
        type: Math.random() > 0.4 ? 'delivery' : 'pickup',
        payment_method: method,
        payment_status: paid ? 'paid' : 'unpaid',
        createdAt,
        updatedAt: new Date(createdAt.getTime() + rint(15, 90) * 60 * 1000),
        __items: lines.map((l) => ({
          tenant_id: tenant.id,
          product_id: l.product.id,
          item_name: l.product.name,
          quantity: l.qty,
          unit_price: l.product.price,
          weight_per_unit_gm: 250,
          total_weight_gm: 250 * l.qty,
          discount: 0,
          line_total: l.product.price * l.qty,
        })),
        __payment: {
          tenant_id: tenant.id,
          method,
          amount: subtotal,
          status: paid ? 'paid' : 'pending',
          reference: paid && method !== 'cash' ? trx() : null,
          paid_at: paid ? createdAt : null,
          createdAt,
          updatedAt: createdAt,
        },
      });
      if (orderBatch.length >= 500) await flush();
    }
  }
  await flush();
  tenants.push(tenant);
  console.log(`  • ${tenant.slug}: ${DAYS} days × ${ORDERS_PER_DAY} orders`);
}

await sequelize.close();
console.log(
  `✅ Perf dataset ready in ${process.env.DB_STORAGE} — ${TENANTS} tenants × ${DAYS} days × ${ORDERS_PER_DAY} orders/day. Run npm run perf:test`
);
