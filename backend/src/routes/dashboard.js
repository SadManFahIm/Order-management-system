import express from 'express';
import { Op } from 'sequelize';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { resolveTenant, requireTenant } from '../middleware/tenant.js';
import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import Payment from '../models/Payment.js';
import Product from '../models/Product.js';
import ItemVariant from '../models/ItemVariant.js';
import MenuCategory from '../models/MenuCategory.js';
import InventoryItem from '../models/InventoryItem.js';
import DailyStat from '../models/DailyStat.js';

const SPLIT_METHODS = ['equal', 'item', 'custom'];

const router = express.Router();
router.use(authMiddleware, resolveTenant, requireTenant, requirePermission('view:orders'));

const OPEN_STATUSES = ['placed', 'preparing', 'ready'];
const ALL_STATUSES = ['placed', 'preparing', 'ready', 'delivered', 'canceled'];
const METHOD_ORDER = ['cash', 'bkash', 'nagad', 'card', 'online', 'other'];
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000; // UTC+6, no DST
// Peak-hours heatmap rows — Bangladesh work week starts Sunday (JS getDay 0).
const PEAK_DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PEAK_HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Date-only ISO key (YYYY-MM-DD) for grouping. */
const dayKey = (d) => {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy.toISOString().slice(0, 10);
};

/** Dhaka-local date-only key (matches the closeout report's day bounds). */
const dhakaDayKey = (d) =>
  new Date(new Date(d).getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);

/** Clamps the ?days= window to 7..30 (default 7). */
const parseDays = (raw) => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n)) return 7;
  return Math.min(Math.max(n, 7), 30);
};

/**
 * Forecast (Phase 6): trailing 7-day moving average per day (the smooth
 * baseline) + a 3-day linear-regression projection on the last 7 actuals,
 * blended 40/60 with the moving average to tame single-day outliers.
 */
const computeForecast = (trend) => {
  const revenues = trend.map((d) => d.revenue);
  const movingAverage = trend.map((d, i) => {
    const win = revenues.slice(Math.max(0, i - 6), i + 1);
    return {
      date: d.date,
      value: Math.round((win.reduce((s, v) => s + v, 0) / win.length) * 100) / 100,
    };
  });
  const n = Math.min(revenues.length, 7);
  const recent = revenues.slice(-n);
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  recent.forEach((v, i) => {
    sx += i;
    sy += v;
    sxy += i * v;
    sxx += i * i;
  });
  const denom = n * sxx - sx * sx;
  const slope = n > 1 && denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
  const intercept = n > 0 ? (sy - slope * sx) / n : 0;
  const avg7 = recent.reduce((s, v) => s + v, 0) / Math.max(recent.length, 1);
  const lastKey = trend[trend.length - 1]?.date;
  const projection = [];
  if (lastKey) {
    // Pure UTC date math — local Date parsing would re-introduce the Dhaka
    // offset and shift the forecast labels back a day.
    const [ky, km, kd] = lastKey.split('-').map(Number);
    const lastDateUtc = Date.UTC(ky, km - 1, kd);
    for (let k = 1; k <= 3; k += 1) {
      const date = new Date(lastDateUtc + k * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const proj = intercept + slope * (recent.length - 1 + k);
      const value = Math.max(0, Math.round((avg7 * 0.4 + proj * 0.6) * 100) / 100);
      projection.push({ date, revenue: value, forecast: true });
    }
  }
  return { movingAverage, projection };
};

/** Trend stats: totals, average, best day, and the day-over-day delta. */
const computeTrendStats = (trend, days) => {
  const paidRevenue = trend.reduce((s, d) => s + d.revenue, 0);
  const totalOrders = trend.reduce((s, d) => s + d.orders, 0);
  let bestDay = null;
  for (const d of trend) {
    if (!bestDay || d.revenue > bestDay.revenue) bestDay = { date: d.date, revenue: d.revenue };
  }
  const last = trend[trend.length - 1];
  const prev = trend[trend.length - 2];
  const delta = last.revenue - (prev?.revenue || 0);
  return {
    days,
    totalRevenue: Math.round(paidRevenue * 100) / 100,
    totalOrders,
    avgPerDay: Math.round((paidRevenue / days) * 100) / 100,
    bestDay,
    dayOverDay: {
      previous: prev ? Math.round(prev.revenue * 100) / 100 : 0,
      current: Math.round(last.revenue * 100) / 100,
      delta: Math.round(delta * 100) / 100,
      pct: prev && prev.revenue > 0 ? Math.round((delta / prev.revenue) * 1000) / 10 : null,
    },
  };
};

/**
 * GET /api/dashboard — merchant overview (Phase 4 completion + R3 analytics).
 *
 * Today's revenue/orders, open fulfillment load, menu size, top items, a
 * 7-day revenue/orders trend (for the dashboard charts) and a status
 * breakdown over the same window. Aggregations run in-app (bounded,
 * tenant-scoped) — a dedicated analytics API can move these to SQL in
 * Phase 7.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfWindow = new Date(startOfToday);
    startOfWindow.setDate(startOfWindow.getDate() - 6); // last 7 days incl. today

    // Dhaka-day window for the closeout trend (aligns with the closeout
    // report's UTC+6 day bounds, unlike the UTC-bucketed 7-day chart).
    // Anchored on Dhaka date strings so bucket labels always match the
    // orders' dhakaDayKey (no off-by-one from the UTC midnight anchor).
    const dhakaNow = new Date(Date.now() + DHAKA_OFFSET_MS);
    const windowStartDhaka = new Date(dhakaNow.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    const windowStartKey = windowStartDhaka.toISOString().slice(0, 10);
    const [y, m, d] = windowStartKey.split('-').map(Number);
    const startOfDhakaWindow = new Date(Date.UTC(y, m - 1, d) - DHAKA_OFFSET_MS);

    // Start of the previous Dhaka month — the anchor for month-over-month.
    const dhakaNowDate = new Date(Date.now() + DHAKA_OFFSET_MS);
    const currentMonthKey = dhakaNowDate.toISOString().slice(0, 7);
    const prevMonthDate = new Date(dhakaNowDate);
    prevMonthDate.setUTCDate(1);
    prevMonthDate.setUTCMonth(prevMonthDate.getUTCMonth() - 1);
    const prevMonthKey = prevMonthDate.toISOString().slice(0, 7);
    const startOfPrevMonthUtc = new Date(
      Date.UTC(prevMonthDate.getUTCFullYear(), prevMonthDate.getUTCMonth(), 1) - DHAKA_OFFSET_MS
    );

    const [todayOrders, openOrders, totalProducts, windowOrders, recentLines, paidPayments, closeoutOrders, closeoutPayments, monthOrders, windowItems, retentionOrders, fulfillmentOrders, liveOrders, inventoryRows, splitPayments] =
      await Promise.all([
        Order.findAll({
          where: { tenant_id: req.tenant.id, createdAt: { [Op.gte]: startOfToday } },
          attributes: ['grand_total'],
        }),
        Order.count({
          where: { tenant_id: req.tenant.id, status: { [Op.in]: OPEN_STATUSES } },
        }),
        Product.count({ where: { tenant_id: req.tenant.id } }),
        Order.findAll({
          where: { tenant_id: req.tenant.id, createdAt: { [Op.gte]: startOfWindow } },
          attributes: ['grand_total', 'status', 'createdAt'],
        }),
        // Latest 500 line items (any status) — plenty for a top-items snapshot.
        OrderItem.findAll({
          where: { tenant_id: req.tenant.id },
          attributes: ['item_name', 'quantity', 'line_total'],
          limit: 500,
        }),
        // Confirmed payments in the same window — revenue by method (bKash/
        // Nagad/cash/card breakdown for the dashboard).
        Payment.findAll({
          where: {
            tenant_id: req.tenant.id,
            status: 'paid',
            createdAt: { [Op.gte]: startOfWindow },
          },
          attributes: ['method', 'amount'],
        }),
        // Closeout trend window (Dhaka days) — orders + paid payments for the
        // revenue-by-day curve and per-day method mix.
        Order.findAll({
          where: { tenant_id: req.tenant.id, createdAt: { [Op.gte]: startOfDhakaWindow } },
          attributes: ['grand_total', 'payment_status', 'createdAt'],
        }),
        Payment.findAll({
          where: {
            tenant_id: req.tenant.id,
            status: 'paid',
            createdAt: { [Op.gte]: startOfDhakaWindow },
          },
          attributes: ['method', 'amount', 'createdAt'],
        }),
        // Month-over-month window: paid orders since the start of the previous
        // Dhaka month, grouped by YYYY-MM for the delta vs last month.
        Order.findAll({
          where: { tenant_id: req.tenant.id, createdAt: { [Op.gte]: startOfPrevMonthUtc } },
          attributes: ['grand_total', 'payment_status', 'createdAt'],
        }),
        // Window line items joined to their order + menu category (Phase 7):
        // category-mix revenue/qty needs the product's category, and the
        // joined order carries createdAt + payment_status (order_items have no
        // timestamps of their own). Soft-deleted products still map to their
        // category (paranoid: false) — item_name is the final fallback.
        OrderItem.findAll({
          where: { tenant_id: req.tenant.id },
          include: [
            {
              model: Order,
              as: 'Order',
              attributes: ['createdAt', 'payment_status'],
              where: { createdAt: { [Op.gte]: startOfDhakaWindow } },
            },
            {
              model: Product,
              as: 'Product',
              attributes: ['category_id'],
              required: false,
              paranoid: false,
              include: [
                {
                  model: MenuCategory,
                  as: 'category',
                  attributes: ['name'],
                  required: false,
                  paranoid: false,
                },
              ],
            },
          ],
          attributes: ['item_name', 'quantity', 'line_total'],
          limit: 5000,
        }),
        // Customer retention window (Phase 7): last 30 days, non-canceled,
        // phone-identified orders — the phone is the customer identity in
        // this system (no separate profile table yet).
        Order.findAll({
          where: {
            tenant_id: req.tenant.id,
            customer_phone: { [Op.not]: null },
            status: { [Op.ne]: 'canceled' },
            createdAt: { [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
          attributes: ['customer_phone', 'grand_total'],
        }),
        // Fulfillment-time sample (Phase 7): delivered orders. There is no
        // order_status_history table yet, so the last status write
        // (updatedAt) approximates the delivered timestamp — documented
        // approximation until a proper status-history table lands.
        Order.findAll({
          where: { tenant_id: req.tenant.id, status: 'delivered' },
          attributes: ['type', 'createdAt', 'updatedAt'],
        }),
        // Live fulfillment panel (Phase 7): open orders with their line-item
        // quantities for a glanceable queue (order no, table, minutes open).
        Order.findAll({
          where: { tenant_id: req.tenant.id, status: { [Op.in]: OPEN_STATUSES } },
          attributes: ['order_no', 'table_no', 'status', 'createdAt', 'grand_total', 'customer_name'],
          order: [['createdAt', 'DESC']],
          limit: 20,
          include: [{ model: OrderItem, as: 'items', attributes: ['quantity'] }],
        }),
        // Inventory snapshot for the low-stock alert (bounded, tenant-scoped).
        InventoryItem.findAll({
          where: { tenant_id: req.tenant.id },
          attributes: ['name', 'stock_qty', 'low_stock_at'],
          limit: 200,
        }),
        // Split-billing parts in the same Dhaka window (dine-in split
        // billing): split_method + payment method/amount/status per part,
        // for the split-method analytics chart. No join needed — the parts
        // ARE payment rows.
        Payment.findAll({
          where: {
            tenant_id: req.tenant.id,
            createdAt: { [Op.gte]: startOfDhakaWindow },
          },
          attributes: ['order_id', 'method', 'amount', 'status', 'split_method'],
        }),
      ]);

    const todayRevenue = todayOrders.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);

    // 7-day trend — zero-filled so charts render a complete, even axis.
    const byDay = new Map();
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(startOfWindow);
      d.setDate(d.getDate() + i);
      byDay.set(dayKey(d), { date: dayKey(d), revenue: 0, orders: 0 });
    }
    for (const o of windowOrders) {
      const key = dayKey(o.createdAt);
      const entry = byDay.get(key);
      if (!entry) continue; // defensive — createdAt should always be in-window
      entry.revenue = Math.round((entry.revenue + Number(o.grand_total || 0)) * 100) / 100;
      entry.orders += 1;
    }
    const trend = [...byDay.values()].map((d) => ({
      date: d.date,
      revenue: Math.round(d.revenue * 100) / 100,
      orders: d.orders,
    }));

    // Status breakdown over the same 7-day window.
    const statusBreakdown = ALL_STATUSES.map((status) => ({
      status,
      count: windowOrders.filter((o) => o.status === status).length,
    }));

    // Aggregate by denormalised item name (survives soft-deleted products).
    const byName = new Map();
    for (const line of recentLines) {
      const key = line.item_name || 'Unknown';
      const entry = byName.get(key) || { name: key, quantity: 0, revenue: 0 };
      entry.quantity += Number(line.quantity) || 0;
      entry.revenue += Number(line.line_total) || 0;
      byName.set(key, entry);
    }
    const topItems = [...byName.values()]
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5)
      .map((t) => ({ ...t, quantity: t.quantity, revenue: Math.round(t.revenue * 100) / 100 }));

    // Revenue by payment method (paid payments, same 7-day window).
    const byMethod = new Map();
    for (const p of paidPayments) {
      const method = p.method || 'other';
      const entry = byMethod.get(method) || { method, amount: 0, count: 0 };
      entry.amount += Number(p.amount || 0);
      entry.count += 1;
      byMethod.set(method, entry);
    }
    const paymentBreakdown = [...byMethod.values()]
      .sort((a, b) => b.amount - a.amount)
      .map((m) => ({
        method: m.method,
        amount: Math.round(m.amount * 100) / 100,
        count: m.count,
      }));

    // ── Closeout trend (Dhaka days, ?days=7|30) ───────────────────────────
    // Revenue/orders per Dhaka day + per-day paid method mix, zero-filled
    // so the chart axis is complete; matches the closeout report's bounds.
    const closeoutByDay = new Map();
    for (let i = 0; i < days; i += 1) {
      const key = new Date(windowStartDhaka.getTime() + i * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      closeoutByDay.set(key, {
        date: key,
        revenue: 0,
        orders: 0,
        methodMix: METHOD_ORDER.reduce((m, k) => ({ ...m, [k]: 0 }), {}),
      });
    }
    for (const o of closeoutOrders) {
      const entry = closeoutByDay.get(dhakaDayKey(o.createdAt));
      if (!entry) continue;
      entry.orders += 1;
      if (o.payment_status === 'paid') entry.revenue += Number(o.grand_total || 0);
    }
    for (const p of closeoutPayments) {
      const entry = closeoutByDay.get(dhakaDayKey(p.createdAt));
      if (!entry) continue;
      const method = METHOD_ORDER.includes(p.method) ? p.method : 'other';
      entry.methodMix[method] += Number(p.amount || 0);
    }
    const closeoutTrend = [...closeoutByDay.values()].map((d) => ({
      date: d.date,
      revenue: Math.round(d.revenue * 100) / 100,
      orders: d.orders,
      methodMix: Object.fromEntries(
        Object.entries(d.methodMix).map(([k, v]) => [k, Math.round(v * 100) / 100])
      ),
    }));

    // ── Forecast (Phase 6) ───────────────────────────────────────────────
    // Computed below (computeForecast) from the final (possibly rollup-
    // overridden) trend — see the trend-stats block near the response.

    // ── Month-over-month (Dhaka months) ──────────────────────────────────
    let thisMonthRevenue = 0;
    let prevMonthRevenue = 0;
    for (const o of monthOrders) {
      if (o.payment_status !== 'paid') continue;
      const key = dhakaDayKey(o.createdAt).slice(0, 7);
      if (key === currentMonthKey) thisMonthRevenue += Number(o.grand_total || 0);
      else if (key === prevMonthKey) prevMonthRevenue += Number(o.grand_total || 0);
    }
    const monthOverMonth = {
      currentMonth: currentMonthKey,
      previousMonth: prevMonthKey,
      currentRevenue: Math.round(thisMonthRevenue * 100) / 100,
      previousRevenue: Math.round(prevMonthRevenue * 100) / 100,
      pct:
        prevMonthRevenue > 0
          ? Math.round(((thisMonthRevenue - prevMonthRevenue) / prevMonthRevenue) * 1000) / 10
          : null,
    };

    // ── Peak-hours heatmap (Phase 7) ────────────────────────────────────
    // 7 (day-of-week, Sun-first) × 24 (Dhaka hours) grid of order volume +
    // paid revenue. Reuses the closeout window so the axis matches the trend
    // chart; Dhaka shift means cells align with the closeout day bounds.
    const peakGrid = PEAK_DAY_LABELS.map(() =>
      PEAK_HOURS.map(() => ({ orders: 0, revenue: 0 }))
    );
    let peakMaxOrders = 0;
    let peakMaxRevenue = 0;
    for (const o of closeoutOrders) {
      const dh = new Date(o.createdAt.getTime() + DHAKA_OFFSET_MS);
      const day = dh.getUTCDay();
      const hour = dh.getUTCHours();
      const cell = peakGrid[day][hour];
      cell.orders += 1;
      if (o.payment_status === 'paid') cell.revenue += Number(o.grand_total || 0);
      if (cell.orders > peakMaxOrders) peakMaxOrders = cell.orders;
      if (cell.revenue > peakMaxRevenue) peakMaxRevenue = cell.revenue;
    }
    let busiest = null;
    for (let day = 0; day < 7; day += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        const cell = peakGrid[day][hour];
        if (!cell.revenue && !cell.orders) continue;
        if (
          !busiest ||
          cell.revenue > busiest.revenue ||
          (cell.revenue === busiest.revenue && cell.orders > busiest.orders)
        ) {
          busiest = { day, hour, ...cell };
        }
      }
    }
    const peakHours = {
      days: PEAK_DAY_LABELS,
      hours: PEAK_HOURS,
      grid: peakGrid.map((row, day) =>
        row.map((cell, hour) => ({
          day,
          hour,
          orders: cell.orders,
          revenue: Math.round(cell.revenue * 100) / 100,
        }))
      ),
      maxOrders: peakMaxOrders,
      maxRevenue: Math.round(peakMaxRevenue * 100) / 100,
      busiest: busiest
        ? { ...busiest, revenue: Math.round(busiest.revenue * 100) / 100 }
        : null,
    };

    // ── Rollup override (Phase 7) ──────────────────────────────────────
    // `?source=rollup` serves the closeout trend + peak-hours grid from the
    // nightly daily_stats table (bounded read — the roadmap's query-cost
    // mitigation). Falls back to the live computation above when the window
    // has no rollup rows yet, so a fresh install never breaks.
    let finalCloseoutTrend = closeoutTrend;
    let finalPeakHours = peakHours;
    if (req.query.source === 'rollup') {
      const windowStartKey = windowStartDhaka.toISOString().slice(0, 10);
      const rollupRows = await DailyStat.findAll({
        where: {
          tenant_id: req.tenant.id,
          stat_date: { [Op.gte]: windowStartKey },
        },
        order: [['stat_date', 'ASC']],
        attributes: ['stat_date', 'revenue', 'orders', 'method_mix', 'peak_hours'],
      });
      if (rollupRows.length > 0) {
        const rollupTrend = closeoutByDay;
        for (const row of rollupRows) {
          const entry = rollupTrend.get(row.stat_date);
          if (!entry) continue;
          entry.revenue = Math.round(Number(row.revenue) * 100) / 100;
          entry.orders = row.orders;
          entry.methodMix = {
            ...entry.methodMix,
            ...Object.fromEntries(
              Object.entries(row.method_mix || {}).map(([k, v]) => [k, Math.round(Number(v) * 100) / 100])
            ),
          };
        }
        // Merge each day's sparse peak map into the full 7×24 grid.
        const grid2 = PEAK_DAY_LABELS.map(() => PEAK_HOURS.map(() => ({ orders: 0, revenue: 0 })));
        let mO = 0;
        let mR = 0;
        for (const row of rollupRows) {
          const pk = row.peak_hours || {};
          for (const dayStr of Object.keys(pk)) {
            const day = Number(dayStr);
            if (!grid2[day]) continue;
            for (const hourStr of Object.keys(pk[day])) {
              const hour = Number(hourStr);
              const cell = pk[day][hourStr] || { orders: 0, revenue: 0 };
              grid2[day][hour].orders += Number(cell.orders) || 0;
              grid2[day][hour].revenue += Number(cell.revenue) || 0;
              if (grid2[day][hour].orders > mO) mO = grid2[day][hour].orders;
              if (grid2[day][hour].revenue > mR) mR = grid2[day][hour].revenue;
            }
          }
        }
        let busiest2 = null;
        for (let day = 0; day < 7; day += 1) {
          for (let hour = 0; hour < 24; hour += 1) {
            const cell = grid2[day][hour];
            if (!cell.revenue && !cell.orders) continue;
            if (
              !busiest2 ||
              cell.revenue > busiest2.revenue ||
              (cell.revenue === busiest2.revenue && cell.orders > busiest2.orders)
            ) {
              busiest2 = { day, hour, ...cell };
            }
          }
        }
        finalCloseoutTrend = [...rollupTrend.values()].map((d) => ({
          date: d.date,
          revenue: Math.round(d.revenue * 100) / 100,
          orders: d.orders,
          methodMix: Object.fromEntries(
            Object.entries(d.methodMix).map(([k, v]) => [k, Math.round(v * 100) / 100])
          ),
        }));
        finalPeakHours = {
          days: PEAK_DAY_LABELS,
          hours: PEAK_HOURS,
          grid: grid2.map((row, day) =>
            row.map((cell, hour) => ({
              day,
              hour,
              orders: cell.orders,
              revenue: Math.round(cell.revenue * 100) / 100,
            }))
          ),
          maxOrders: mO,
          maxRevenue: Math.round(mR * 100) / 100,
          busiest: busiest2
            ? { ...busiest2, revenue: Math.round(busiest2.revenue * 100) / 100 }
            : null,
        };
      }
    }

    // ── Category mix (Phase 7) ──────────────────────────────────────────
    // Paid line items grouped by menu category (soft-delete-safe via
    // paranoid: false join; 'Uncategorized' when a product has no category).
    const byCategory = new Map();
    for (const line of windowItems) {
      if (line.Order?.payment_status !== 'paid') continue;
      const name = line.Product?.category?.name || 'Uncategorized';
      const entry = byCategory.get(name) || { name, revenue: 0, quantity: 0 };
      entry.revenue += Number(line.line_total || 0);
      entry.quantity += Number(line.quantity || 0);
      byCategory.set(name, entry);
    }
    const categoryMixRaw = [...byCategory.values()];
    const categoryTotal = categoryMixRaw.reduce((s, c) => s + c.revenue, 0);
    const categoryMix = categoryMixRaw
      .sort((a, b) => b.revenue - a.revenue)
      .map((c) => ({
        name: c.name,
        revenue: Math.round(c.revenue * 100) / 100,
        quantity: c.quantity,
        pct: categoryTotal > 0 ? Math.round((c.revenue / categoryTotal) * 1000) / 10 : 0,
      }));

    // ── Customer retention (Phase 7) ────────────────────────────────────
    // Repeat-customer rate + avg order value over a 30-day window; top
    // customers by revenue (phone masked — the merchant knows who they are
    // but the payload stays privacy-safe).
    const byPhone = new Map();
    for (const o of retentionOrders) {
      const entry = byPhone.get(o.customer_phone) || { orders: 0, revenue: 0 };
      entry.orders += 1;
      entry.revenue += Number(o.grand_total || 0);
      byPhone.set(o.customer_phone, entry);
    }
    const customerList = [...byPhone.entries()];
    const totalCustomers = customerList.length;
    const repeatCustomers = customerList.filter(([, e]) => e.orders >= 2).length;
    const retentionRevenue = customerList.reduce((s, [, e]) => s + e.revenue, 0);
    const retentionOrderCount = customerList.reduce((s, [, e]) => s + e.orders, 0);
    const retention = {
      windowDays: 30,
      totalCustomers,
      repeatCustomers,
      repeatRate:
        totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 1000) / 10 : 0,
      avgOrderValue:
        retentionOrderCount > 0
          ? Math.round((retentionRevenue / retentionOrderCount) * 100) / 100
          : 0,
      topCustomers: customerList
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 5)
        .map(([phone, e]) => ({
          phone: phone.replace(/^(\d{4})\d+(\d{2})$/, '$1••••$2'),
          orders: e.orders,
          revenue: Math.round(e.revenue * 100) / 100,
        })),
    };

    // ── Fulfillment time (Phase 7) ──────────────────────────────────────
    // Average placed → delivered duration per order type (minutes).
    const byTypeMs = new Map();
    let allMs = 0;
    let allCount = 0;
    for (const o of fulfillmentOrders) {
      const ms = new Date(o.updatedAt).getTime() - new Date(o.createdAt).getTime();
      if (ms < 0) continue; // clock skew / malformed row — never negative
      const type = o.type || 'pickup';
      const entry = byTypeMs.get(type) || { totalMs: 0, count: 0 };
      entry.totalMs += ms;
      entry.count += 1;
      byTypeMs.set(type, entry);
      allMs += ms;
      allCount += 1;
    }
    const fulfillment = {
      overallAvgMinutes:
        allCount > 0 ? Math.round((allMs / allCount / 60000) * 10) / 10 : 0,
      types: [...byTypeMs.entries()]
        .sort((a, b) => b[1].totalMs / b[1].count - a[1].totalMs / a[1].count)
        .map(([type, e]) => ({
          type,
          avgMinutes: Math.round((e.totalMs / e.count / 60000) * 10) / 10,
          orders: e.count,
        })),
    };

    // ── Split-method analytics (dine-in split billing) ─────────────────
    // How orders are being split over the window: usage by split method
    // (equal / item / custom / unsplit), revenue per method (paid parts —
    // a split order's revenue is counted ONCE across its parts, so closeout
    // and VAT stay unduplicated), avg diners per split order and the
    // payment-method mix WITHIN split orders.
    const splitOrders = new Set();
    const bySplitMethod = {};
    for (const m of SPLIT_METHODS) bySplitMethod[m] = { orders: 0, revenue: 0 };
    const splitMethodMix = {};
    let totalSplitParts = 0;
    let totalSplitRevenue = 0;
    let paidPartCount = 0;
    for (const p of splitPayments) {
      if (!p.split_method || !SPLIT_METHODS.includes(p.split_method)) continue;
      const entry = bySplitMethod[p.split_method];
      if (!splitOrders.has(p.order_id)) {
        entry.orders += 1;
        splitOrders.add(p.order_id);
      }
      totalSplitParts += 1;
      if (p.status === 'paid') {
        const amount = Number(p.amount || 0);
        entry.revenue += amount;
        totalSplitRevenue += amount;
        paidPartCount += 1;
        splitMethodMix[p.method] = (splitMethodMix[p.method] || 0) + amount;
      }
    }
    const splitOrdersTotal = splitOrders.size;
    const splitAnalytics = {
      windowDays: days,
      totalOrders: closeoutOrders.length,
      splitOrders: {
        total: splitOrdersTotal,
        unsplit: Math.max(closeoutOrders.length - splitOrdersTotal, 0),
        equal: bySplitMethod.equal.orders,
        item: bySplitMethod.item.orders,
        custom: bySplitMethod.custom.orders,
        pctByMethod: SPLIT_METHODS.map((m) => ({
          method: m,
          orders: bySplitMethod[m].orders,
          pct:
            splitOrdersTotal > 0
              ? Math.round((bySplitMethod[m].orders / splitOrdersTotal) * 1000) / 10
              : 0,
        })),
      },
      revenue: SPLIT_METHODS.map((m) => ({
        method: m,
        revenue: Math.round(bySplitMethod[m].revenue * 100) / 100,
      })),
      avgDiners:
        splitOrdersTotal > 0
          ? Math.round((totalSplitParts / splitOrdersTotal) * 100) / 100
          : 0,
      avgPerDiner:
        paidPartCount > 0
          ? Math.round((totalSplitRevenue / paidPartCount) * 100) / 100
          : 0,
      methodMix: Object.entries(splitMethodMix)
        .map(([method, amount]) => ({
          method,
          amount: Math.round(amount * 100) / 100,
        }))
        .sort((a, b) => b.amount - a.amount),
    };

    // ── Live fulfillment panel (Phase 7) ────────────────────────────────
    // Open orders as a glanceable queue — the dashboard's live view of what
    // the kitchen/delivery is working on right now.
    const nowMs = Date.now();
    const livePanel = liveOrders.map((o) => ({
      order_no: o.order_no,
      table_no: o.table_no,
      status: o.status,
      customer_name: o.customer_name,
      total: Math.round(Number(o.grand_total || 0) * 100) / 100,
      minutesOpen: Math.max(0, Math.round((nowMs - new Date(o.createdAt).getTime()) / 60000)),
      itemCount: (o.items || []).length,
      itemQty: (o.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0),
    }));

    // ── Dashboard alerts (Phase 7) ──────────────────────────────────────
    // Structured alerts the frontend renders in the merchant's language:
    // low stock (below threshold), high cancellation rate (7-day window,
    // only when there is enough volume to be meaningful), and idle hours
    // (no order for 2+ hours). Never blocks the dashboard — informational.
    const alerts = [];
    const lowStock = inventoryRows.filter(
      (i) => Number(i.low_stock_at) > 0 && Number(i.stock_qty) <= Number(i.low_stock_at)
    );
    if (lowStock.length > 0) {
      alerts.push({
        code: 'LOW_STOCK',
        severity: 'warning',
        count: lowStock.length,
        items: lowStock
          .slice(0, 5)
          .map((i) => ({ name: i.name, stock_qty: i.stock_qty, low_stock_at: i.low_stock_at })),
      });
    }
    // Variant-level low stock (Phase 4 follow-up): tracked variants whose
    // stock has hit their own threshold get their own alert so the merchant
    // sees size-level stockouts, not just product-level inventory.
    const lowVariants = await ItemVariant.findAll({
      where: {
        tenant_id: req.tenant.id,
        stock: { [Op.not]: null },
      },
      attributes: ['id', 'name', 'stock', 'low_stock_at'],
      include: [{ model: Product, as: 'product', attributes: ['id', 'name'] }],
      limit: 200,
    });
    const lowVariantRows = lowVariants.filter(
      (v) =>
        Number(v.low_stock_at) > 0 &&
        Number(v.stock) <= Number(v.low_stock_at)
    );
    if (lowVariantRows.length > 0) {
      alerts.push({
        code: 'LOW_VARIANT_STOCK',
        severity: 'warning',
        count: lowVariantRows.length,
        items: lowVariantRows.slice(0, 5).map((v) => ({
          name: `${v.product?.name || 'Item'} — ${v.name}`,
          stock_qty: v.stock,
          low_stock_at: v.low_stock_at,
        })),
      });
    }
    const windowTotal = windowOrders.length;
    const windowCanceled = windowOrders.filter((o) => o.status === 'canceled').length;
    if (windowTotal >= 10 && windowCanceled / windowTotal > 0.15) {
      alerts.push({
        code: 'HIGH_CANCELLATION',
        severity: 'danger',
        rate: Math.round((windowCanceled / windowTotal) * 1000) / 10,
        windowOrders: windowTotal,
      });
    }
    if (windowOrders.length > 0) {
      const lastOrderAt = windowOrders.reduce(
        (max, o) => Math.max(max, new Date(o.createdAt).getTime()),
        0
      );
      const idleHours = (nowMs - lastOrderAt) / 3600000;
      if (idleHours >= 2) {
        alerts.push({
          code: 'IDLE',
          severity: 'warning',
          hours: Math.round(idleHours * 10) / 10,
        });
      }
    }

    // Trend stats + forecast follow the (possibly rollup-overridden) trend,
    // so ?source=rollup returns fully rollup-derived analytics.
    const trendStats = computeTrendStats(finalCloseoutTrend, days);
    const forecast = computeForecast(finalCloseoutTrend);

    res.json({
      today: { orders: todayOrders.length, revenue: Math.round(todayRevenue * 100) / 100 },
      openOrders,
      totalProducts,
      trend,
      statusBreakdown,
      topItems,
      paymentBreakdown,
      closeoutTrend: finalCloseoutTrend,
      trendStats,
      forecast,
      monthOverMonth,
      peakHours: finalPeakHours,
      categoryMix,
      splitAnalytics,
      retention,
      fulfillment,
      livePanel,
      alerts,
    });
  })
);

export default router;
