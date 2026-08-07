import express from 'express';
import { Op } from 'sequelize';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { resolveTenant, requireTenant } from '../middleware/tenant.js';
import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import Product from '../models/Product.js';

const router = express.Router();
router.use(authMiddleware, resolveTenant, requireTenant, requirePermission('view:orders'));

const OPEN_STATUSES = ['placed', 'preparing', 'ready'];

/**
 * GET /api/dashboard — merchant overview (Phase 4 completion).
 * Today's revenue/orders, open fulfillment load, menu size and top items.
 * Aggregations run in-app (bounded, tenant-scoped) — a dedicated analytics
 * API can move these to SQL in Phase 7.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [todayOrders, openOrders, totalProducts, recentLines] = await Promise.all([
      Order.findAll({
        where: { tenant_id: req.tenant.id, createdAt: { [Op.gte]: startOfToday } },
        attributes: ['grand_total'],
      }),
      Order.count({
        where: { tenant_id: req.tenant.id, status: { [Op.in]: OPEN_STATUSES } },
      }),
      Product.count({ where: { tenant_id: req.tenant.id } }),
      // Latest 500 line items (any status) — plenty for a top-items snapshot.
      OrderItem.findAll({
        where: { tenant_id: req.tenant.id },
        attributes: ['item_name', 'quantity', 'line_total'],
        limit: 500,
      }),
    ]);

    const todayRevenue = todayOrders.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);

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

    res.json({
      today: { orders: todayOrders.length, revenue: Math.round(todayRevenue * 100) / 100 },
      openOrders,
      totalProducts,
      topItems,
    });
  })
);

export default router;
