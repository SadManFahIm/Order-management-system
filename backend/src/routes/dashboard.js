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

const router = express.Router();
router.use(authMiddleware, resolveTenant, requireTenant, requirePermission('view:orders'));

const OPEN_STATUSES = ['placed', 'preparing', 'ready'];
const ALL_STATUSES = ['placed', 'preparing', 'ready', 'delivered', 'canceled'];
const METHOD_ORDER = ['cash', 'bkash', 'nagad', 'card', 'online', 'other'];
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000; // UTC+6, no DST

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

    const [todayOrders, openOrders, totalProducts, windowOrders, recentLines, paidPayments, closeoutOrders, closeoutPayments] =
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

    // Trend stats — totals, average, best day, and the day-over-day delta.
    const paidRevenue = closeoutTrend.reduce((s, d) => s + d.revenue, 0);
    const totalOrders = closeoutTrend.reduce((s, d) => s + d.orders, 0);
    let bestDay = null;
    for (const d of closeoutTrend) {
      if (!bestDay || d.revenue > bestDay.revenue) bestDay = { date: d.date, revenue: d.revenue };
    }
    const last = closeoutTrend[closeoutTrend.length - 1];
    const prev = closeoutTrend[closeoutTrend.length - 2];
    const delta = last.revenue - (prev?.revenue || 0);
    const trendStats = {
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

    res.json({
      today: { orders: todayOrders.length, revenue: Math.round(todayRevenue * 100) / 100 },
      openOrders,
      totalProducts,
      trend,
      statusBreakdown,
      topItems,
      paymentBreakdown,
      closeoutTrend,
      trendStats,
    });
  })
);

export default router;
