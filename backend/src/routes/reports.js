import express from 'express';
import { Op } from 'sequelize';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { resolveTenant, requireTenant } from '../middleware/tenant.js';
import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import Payment from '../models/Payment.js';
import { PAYMENT_METHODS, METHOD_LABELS } from '../services/paymentsService.js';

/**
 * Daily closeout report (Phase 5) — the cash-register reconciliation view.
 *
 * A single day's orders and payments (Dhaka local day, UTC+6): totals,
 * revenue by payment method, pending wallet amounts, refunds — plus a CSV
 * export so the cashier can reconcile against the physical register / bKash
 * app statement.
 */
const router = express.Router();
router.use(authMiddleware, resolveTenant, requireTenant, requirePermission('view:orders'));

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000; // UTC+6, no DST in Bangladesh

/** Day bounds for a YYYY-MM-DD string in Dhaka time (UTC+6). */
function dayBounds(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!match) throw new AppError(400, 'VALIDATION_ERROR', 'date must be YYYY-MM-DD');
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const startUtc = Date.UTC(y, m - 1, d) - DHAKA_OFFSET_MS;
  return {
    start: new Date(startUtc),
    end: new Date(startUtc + 24 * 60 * 60 * 1000),
  };
}

/** Builds the full closeout dataset for a day (shared by JSON + CSV). */
async function buildCloseout(tenantId, dateStr) {
  const { start, end } = dayBounds(dateStr);
  const where = { tenant_id: tenantId, createdAt: { [Op.gte]: start, [Op.lt]: end } };

  const [orders, payments] = await Promise.all([
    Order.findAll({
      where,
      include: [{ model: OrderItem, as: 'items' }],
      order: [['id', 'ASC']],
    }),
    Payment.findAll({ where: { tenant_id: tenantId, createdAt: { [Op.gte]: start, [Op.lt]: end } } }),
  ]);

  const byMethod = new Map();
  for (const method of PAYMENT_METHODS) {
    byMethod.set(method, { method, label: METHOD_LABELS[method] || method, orders: 0, amount: 0, pendingAmount: 0 });
  }
  for (const p of payments) {
    const entry = byMethod.get(p.method) || byMethod.get('other');
    if (!entry) continue;
    entry.orders += 1;
    if (p.status === 'paid') entry.amount += Number(p.amount || 0);
    if (p.status === 'pending') entry.pendingAmount += Number(p.amount || 0);
  }

  let revenue = 0;
  let pendingAmount = 0;
  let refundedAmount = 0;
  let canceled = 0;
  for (const o of orders) {
    if (o.status === 'canceled') canceled += 1;
    if (o.payment_status === 'paid') revenue += Number(o.grand_total || 0);
    if (o.payment_status === 'pending') pendingAmount += Number(o.grand_total || 0);
    if (o.payment_status === 'refunded') refundedAmount += Number(o.grand_total || 0);
  }

  const serializedOrders = orders.map((o) => ({
    id: o.id,
    orderNo: o.order_no,
    time: o.createdAt.toISOString(),
    customerName: o.customer_name,
    tableNo: o.table_no,
    status: o.status,
    paymentStatus: o.payment_status,
    paymentMethod: o.payment_method || (o.payment_status === 'paid' ? 'cash' : null),
    items: (o.items || []).reduce((n, i) => n + Number(i.quantity || 0), 0),
    amount: Number(o.grand_total || 0),
  }));

  return {
    // Dhaka (UTC+6) is AHEAD of UTC — add the offset to get the local date.
    date: dateStr || new Date(Date.now() + DHAKA_OFFSET_MS).toISOString().slice(0, 10),
    totals: {
      orders: orders.length,
      canceled,
      revenue: Math.round(revenue * 100) / 100,
      pendingAmount: Math.round(pendingAmount * 100) / 100,
      refundedAmount: Math.round(refundedAmount * 100) / 100,
      avgOrder: orders.length ? Math.round((revenue / orders.length) * 100) / 100 : 0,
    },
    byMethod: [...byMethod.values()]
      .filter((m) => m.orders > 0 || m.amount > 0 || m.pendingAmount > 0)
      .map((m) => ({ ...m, amount: Math.round(m.amount * 100) / 100, pendingAmount: Math.round(m.pendingAmount * 100) / 100 })),
    orders: serializedOrders,
  };
}

/** Escapes a CSV field (quote + double quotes). */
const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** GET /api/reports/closeout?date=YYYY-MM-DD — daily summary (JSON). */
router.get(
  '/closeout',
  asyncHandler(async (req, res) => {
    res.json(await buildCloseout(req.tenant.id, req.query.date));
  })
);

/** GET /api/reports/closeout.csv — the same day as a downloadable CSV. */
router.get(
  '/closeout.csv',
  asyncHandler(async (req, res) => {
    const data = await buildCloseout(req.tenant.id, req.query.date);
    const header = ['order_no', 'time', 'customer_name', 'table_no', 'status', 'payment_status', 'payment_method', 'items', 'amount_bdt'];
    const rows = data.orders.map((o) => [
      o.orderNo, o.time, o.customerName, o.tableNo ?? '', o.status, o.paymentStatus,
      o.paymentMethod || '', o.items, o.amount.toFixed(2),
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="closeout-${data.date}.csv"`);
    res.send(csv);
  })
);

export default router;
