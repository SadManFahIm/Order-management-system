import { Op } from 'sequelize';
import { AppError } from '../middleware/errorHandler.js';
import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import Payment from '../models/Payment.js';
import { PAYMENT_METHODS, METHOD_LABELS } from './paymentsService.js';
import { sendEmail } from './notifications/email.js';

/**
 * Daily closeout (Phase 5) — shared by the report routes (JSON / CSV / PDF /
 * on-demand email) and the nightly scheduler. One day's orders and payments
 * in Dhaka local time (UTC+6): totals, revenue by payment method, pending
 * wallet amounts, refunds.
 */

export const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000; // UTC+6, no DST in Bangladesh

/** Day bounds for a YYYY-MM-DD string in Dhaka time (UTC+6). */
export function dayBounds(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!match) throw new AppError(400, 'VALIDATION_ERROR', 'date must be YYYY-MM-DD');
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const startUtc = Date.UTC(y, m - 1, d) - DHAKA_OFFSET_MS;
  return {
    start: new Date(startUtc),
    end: new Date(startUtc + 24 * 60 * 60 * 1000),
  };
}

/** Current Dhaka date (YYYY-MM-DD) — the day a report is "for". */
export function dhakaDate(now = new Date()) {
  return new Date(now.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Builds the full closeout dataset for a day (shared by JSON/CSV/PDF/email). */
export async function buildCloseout(tenantId, dateStr) {
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
    date: dateStr || dhakaDate(),
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
export const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The closeout day as a CSV document (header + rows). */
export function buildCloseoutCsv(data) {
  const header = ['order_no', 'time', 'customer_name', 'table_no', 'status', 'payment_status', 'payment_method', 'items', 'amount_bdt'];
  const rows = data.orders.map((o) => [
    o.orderNo, o.time, o.customerName, o.tableNo ?? '', o.status, o.paymentStatus,
    o.paymentMethod || '', o.items, Number(o.amount).toFixed(2),
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** Renders the closeout as a print-ready HTML document (PDF via browser). */
export function renderCloseoutHtml(data, tenantName) {
  const rows = data.orders
    .map(
      (o) => `<tr>
        <td class="mono">${o.orderNo}</td>
        <td class="mono">${new Date(o.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
        <td>${csvCell(o.customerName)}</td>
        <td>${o.tableNo ? `🪑 ${o.tableNo}` : '—'}</td>
        <td>${o.status}</td>
        <td>${o.paymentMethod || '—'}</td>
        <td class="num">${Number(o.items)}</td>
        <td class="num">৳ ${Number(o.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
      </tr>`
    )
    .join('');
  const methods = (data.byMethod || [])
    .map(
      (m) => `<div class="method">
        <span>${csvCell(m.label)}</span>
        <span class="num">${m.orders} · ৳ ${Number(m.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}${m.pendingAmount > 0 ? ` <small>(+৳ ${Number(m.pendingAmount).toLocaleString('en-IN')} pending)</small>` : ''}</span>
      </div>`
    )
    .join('');
  const fmt = (n) => `৳ ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Closeout — ${data.date} — ${csvCell(tenantName)}</title>
<style>
  :root{--ink:#16181d;--muted:#68707a;--line:#e6e8ec;--brand:#e11d48;--bg:#fff}
  *{box-sizing:border-box}
  body{font-family:system-ui,'Segoe UI',Roboto,'Noto Sans Bengali',sans-serif;color:var(--ink);margin:0;background:#f6f7f9;padding:32px}
  .sheet{max-width:760px;margin:0 auto;background:var(--bg);border-radius:16px;padding:40px 44px;box-shadow:0 8px 28px rgba(0,0,0,.06)}
  h1{font-size:22px;margin:0 0 4px}
  .sub{color:var(--muted);margin:0 0 26px;font-size:13.5px}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:26px}
  .stat{background:#fafbfc;border:1px solid var(--line);border-radius:12px;padding:12px 14px}
  .stat b{display:block;font-size:19px;margin-top:3px;font-variant-numeric:tabular-nums}
  .stat span{font-size:11.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:22px 0 10px}
  .method{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px dashed var(--line);font-size:14px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);padding:8px 6px;border-bottom:2px solid var(--line)}
  td{padding:8px 6px;border-bottom:1px solid var(--line)}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .mono{font-family:'JetBrains Mono',Consolas,monospace;font-size:12px}
  .foot{margin-top:28px;color:var(--muted);font-size:11.5px;border-top:1px solid var(--line);padding-top:14px}
  .empty{color:var(--muted);padding:20px 0}
  @media print{body{background:#fff;padding:0}.sheet{box-shadow:none;border-radius:0;padding:0;max-width:none}}
</style></head><body><div class="sheet">
  <h1>${csvCell(tenantName)} — Daily Closeout</h1>
  <p class="sub">${data.date} · Dhaka (UTC+6) · ${data.orders.length} orders · generated ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}</p>
  <div class="grid">
    <div class="stat"><span>Orders</span><b>${data.totals.orders}</b></div>
    <div class="stat"><span>Revenue (paid)</span><b>${fmt(data.totals.revenue)}</b></div>
    <div class="stat"><span>Pending</span><b>${fmt(data.totals.pendingAmount)}</b></div>
    <div class="stat"><span>Refunded</span><b>${fmt(data.totals.refundedAmount)}</b></div>
  </div>
  <h2>Revenue by payment method</h2>
  ${methods || '<div class="empty">No payments this day.</div>'}
  <h2>Orders</h2>
  ${rows ? `<table><thead><tr><th>Order</th><th>Time</th><th>Customer</th><th>Table</th><th>Status</th><th>Payment</th><th class="num">Items</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">No orders this day.</div>'}
  <div class="foot">Generated by Orderly — Order Management System · avg order ${fmt(data.totals.avgOrder)} · canceled ${data.totals.canceled}</div>
</div></body></html>`;
}

/**
 * Emails a day's closeout (HTML summary + CSV attachment). `to` falls back to
 * the workspace's configured closeout email. Returns the send result.
 */
export async function sendCloseoutEmail({ tenant, date, to }) {
  const data = await buildCloseout(tenant.id, date);
  const recipient = String(to || '').trim() || tenant.settings?.reports?.closeoutEmail || '';
  if (!recipient) return null;

  const result = await sendEmail({
    to: recipient,
    subject: `Daily closeout — ${data.date} — ${tenant.name || 'Restaurant'}`,
    html: renderCloseoutHtml(data, tenant.name || 'Restaurant'),
    attachments: [{ filename: `closeout-${data.date}.csv`, content: buildCloseoutCsv(data), contentType: 'text/csv' }],
  });
  return { ...result, date: data.date, orders: data.orders.length, to: recipient };
}
