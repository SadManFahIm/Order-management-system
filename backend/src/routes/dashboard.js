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

/** Date-only ISO key (YYYY-MM-DD) for grouping. */
const dayKey = (d) => {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy.toISOString().slice(0, 10);
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
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfWindow = new Date(startOfToday);
    startOfWindow.setDate(startOfWindow.getDate() - 6); // last 7 days incl. today

    const [todayOrders, openOrders, totalProducts, windowOrders, recentLines, paidPayments] =
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

    res.json({
      today: { orders: todayOrders.length, revenue: Math.round(todayRevenue * 100) / 100 },
      openOrders,
      totalProducts,
      trend,
      statusBreakdown,
      topItems,
      paymentBreakdown,
    });
  })
);

export default router;
