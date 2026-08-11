import { Op } from 'sequelize';
import { AppError } from '../middleware/errorHandler.js';
import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import Payment from '../models/Payment.js';
import Product from '../models/Product.js';
import InventoryItem from '../models/InventoryItem.js';
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
    if (p.status === 'refunded') {
      // Partial refund: only the portion still retained counts as revenue.
      const returned = p.refunded_amount != null ? Number(p.refunded_amount) : Number(p.amount || 0);
      entry.amount += Math.max(Number(p.amount || 0) - returned, 0);
    }
    if (p.status === 'pending') entry.pendingAmount += Number(p.amount || 0);
  }

  // Revenue is computed from PAYMENT rows (split- and refund-accurate: a
  // split order contributes each part; a partial refund keeps its retained
  // portion) — equivalent to summing paid orders' grand totals when there
  // are no refunds.
  let revenue = 0;
  let pendingAmount = 0;
  let refundedAmount = 0;
  let canceled = 0;
  for (const p of payments) {
    if (p.status === 'paid') revenue += Number(p.amount || 0);
    if (p.status === 'refunded') {
      const returned = p.refunded_amount != null ? Number(p.refunded_amount) : Number(p.amount || 0);
      revenue += Math.max(Number(p.amount || 0) - returned, 0);
      refundedAmount += Math.min(returned, Number(p.amount || 0));
    }
    if (p.status === 'pending') pendingAmount += Number(p.amount || 0);
  }
  for (const o of orders) {
    if (o.status === 'canceled') canceled += 1;
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

  // Split-order breakdown (Phase 6): one order split across methods (or
  // diners via QR table bill-split) — each part with its method/label,
  // amount, status, diner note and trx reference, so the cashier can
  // reconcile exactly who paid what against the wallet statements.
  const splitParts = [];
  for (const o of orders) {
    if (o.payment_method !== 'split') continue;
    for (const p of payments.filter((pay) => pay.order_id === o.id)) {
      splitParts.push({
        orderNo: o.order_no,
        tableNo: o.table_no,
        customerName: o.customer_name,
        time: o.createdAt.toISOString(),
        method: p.method,
        label: METHOD_LABELS[p.method] || p.method,
        amount: Number(p.amount || 0),
        status: p.status,
        note: p.notes || null,
        reference: p.reference || null,
      });
    }
  }
  splitParts.sort((a, b) => a.orderNo.localeCompare(b.orderNo) || a.method.localeCompare(b.method));

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
    split: {
      orders: new Set(splitParts.map((p) => p.orderNo)).size,
      revenue: Math.round(
        splitParts.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0) * 100
      ) / 100,
      parts: splitParts.map((p) => ({
        ...p,
        amount: Math.round(p.amount * 100) / 100,
      })),
    },
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
  const body = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');

  // Split-payment section (Phase 6) — appended ONLY when the day had split
  // orders, so a normal day's CSV is byte-identical to before. Each split
  // order appears once per part, with its diner note + trx reference, which
  // is exactly what the cashier matches against the wallet app statement.
  if ((data.split?.parts || []).length === 0) return body;
  const splitHeader = ['SPLIT PARTS', 'order_no', 'method', 'amount_bdt', 'status', 'diner_note', 'reference'];
  const splitRows = data.split.parts.map((p) => [
    '', p.orderNo, p.method, Number(p.amount).toFixed(2), p.status, p.note || '', p.reference || '',
  ]);
  return `${body}\r\n\r\n${[splitHeader, ...splitRows]
    .map((r) => r.map(csvCell).join(','))
    .join('\r\n')}`;
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
  ${(data.split?.parts || []).length > 0
    ? `<h2>Split payments (${data.split.orders} order${data.split.orders === 1 ? '' : 's'})</h2>
       <table><thead><tr><th>Order</th><th>Diner / part</th><th>Method</th><th class="num">Amount</th><th>Status</th><th>Ref</th></tr></thead><tbody>
       ${data.split.parts
         .map(
           (p) => `<tr>
             <td class="mono">${p.orderNo}</td>
             <td>${p.note ? csvCell(p.note) : '—'}</td>
             <td>${csvCell(p.label)}</td>
             <td class="num">${fmt(p.amount)}</td>
             <td>${p.status}</td>
             <td class="mono">${p.reference ? csvCell(p.reference) : '—'}</td>
           </tr>`
         )
         .join('')}
       </tbody></table>`
    : ''}
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

/**
 * VAT report (Phase 6) — Bangladesh NBR-ready compliance view.
 *
 * Menu pricing is VAT-inclusive (the BD norm), so each line's gross amount
 * is split by the item's own `vat_rate`: VAT = gross × rate/(100+rate),
 * net = gross − VAT. Rates default from `tenant.settings.vat.defaultRate`
 * (or 5%) when an item no longer exists or has no rate. `from`/`to` default
 * to the current Dhaka day; both are YYYY-MM-DD (inclusive).
 */
export async function buildVatReport(tenant, from, to) {
  const startStr = from || dhakaDate();
  const endStr = to || startStr;
  // YYYY-MM-DD strings compare lexicographically — `from` after `to` is a
  // user error, not an empty report (a compliance view must not silently
  // look like zero sales).
  if (startStr > endStr) {
    throw new AppError(400, 'VALIDATION_ERROR', '`from` must not be after `to`');
  }
  const { start } = dayBounds(startStr);
  const { end } = dayBounds(endStr);
  // `|| 5` would clobber a legitimate 0% (VAT-exempt) default — parse and
  // validate instead so 0 stays 0.
  const parsedDefault = Number(tenant.settings?.vat?.defaultRate ?? 5);
  const defaultRate = Number.isFinite(parsedDefault) && parsedDefault >= 0 ? parsedDefault : 5;

  const orders = await Order.findAll({
    where: { tenant_id: tenant.id, createdAt: { [Op.gte]: start, [Op.lt]: end } },
    attributes: ['id'],
    order: [['id', 'ASC']],
  });
  const orderIds = orders.map((o) => o.id);

  if (orderIds.length === 0) {
    return {
      from: startStr,
      to: endStr,
      defaultRate,
      items: [],
      totals: { gross: 0, vat: 0, net: 0 },
    };
  }

  const [lines, products] = await Promise.all([
    OrderItem.findAll({
      where: { tenant_id: tenant.id, order_id: { [Op.in]: orderIds } },
    }),
    Product.findAll({
      where: { tenant_id: tenant.id },
      attributes: ['id', 'name', 'vat_rate'],
    }),
  ]);

  const rateByProduct = new Map();
  for (const p of products) {
    const rate = Number(p.vat_rate);
    rateByProduct.set(p.id, Number.isFinite(rate) && rate >= 0 ? rate : defaultRate);
  }

  // Group by product (denormalised name as fallback for removed items).
  const byItem = new Map();
  for (const line of lines) {
    const id = line.product_id ?? `legacy:${line.item_name}`;
    const entry =
      byItem.get(id) ||
      (() => {
        const e = {
          itemId: id,
          itemName: line.item_name || 'Unknown item',
          rate: rateByProduct.get(line.product_id) ?? defaultRate,
          quantity: 0,
          gross: 0,
        };
        byItem.set(id, e);
        return e;
      })();
    entry.quantity += Number(line.quantity) || 0;
    entry.gross += Number(line.line_total) || 0;
  }

  let totalGross = 0;
  let totalVat = 0;
  const items = [...byItem.values()].map((e) => {
    const gross = Math.round(e.gross * 100) / 100;
    const vat = Math.round((gross * e.rate) / (100 + e.rate) * 100) / 100;
    const net = Math.round((gross - vat) * 100) / 100;
    totalGross += gross;
    totalVat += vat;
    return {
      itemId: e.itemId,
      itemName: e.itemName,
      vatRate: e.rate,
      quantity: e.quantity,
      gross,
      vat,
      net,
    };
  });
  items.sort((a, b) => b.gross - a.gross);

  return {
    from: startStr,
    to: endStr,
    defaultRate,
    items,
    totals: {
      gross: Math.round(totalGross * 100) / 100,
      vat: Math.round(totalVat * 100) / 100,
      net: Math.round((totalGross - totalVat) * 100) / 100,
    },
  };
}

/** The VAT report as a CSV document (per-item rows + totals footer). */
export function buildVatCsv(data) {
  const header = ['item_name', 'vat_rate_pct', 'quantity', 'gross_bdt', 'vat_bdt', 'net_bdt'];
  const rows = data.items.map((i) => [
    i.itemName, i.vatRate, i.quantity, i.gross.toFixed(2), i.vat.toFixed(2), i.net.toFixed(2),
  ]);
  const footer = ['TOTAL', '', '', data.totals.gross.toFixed(2), data.totals.vat.toFixed(2), data.totals.net.toFixed(2)];
  return [header, ...rows, footer].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/**
 * Nightly merchant digest (Phase 6) — what a restaurant owner wants to see
 * first thing in the morning: today's top sellers and anything running low.
 * Rendered inside the nightly closeout email + pushed to the WhatsApp
 * webhook so the digest reaches the owner wherever they are.
 */
export async function buildDigest(tenantId, dateStr) {
  const { start, end } = dayBounds(dateStr);

  const [orders, lowStock] = await Promise.all([
    Order.findAll({
      where: { tenant_id: tenantId, createdAt: { [Op.gte]: start, [Op.lt]: end } },
      attributes: ['id'],
    }),
    InventoryItem.findAll({ where: { tenant_id: tenantId } }),
  ]);

  const orderIds = orders.map((o) => o.id);
  let topSellers = [];
  if (orderIds.length > 0) {
    const lines = await OrderItem.findAll({
      where: { tenant_id: tenantId, order_id: { [Op.in]: orderIds } },
    });
    const byName = new Map();
    for (const line of lines) {
      const name = line.item_name || 'Unknown item';
      const entry = byName.get(name) || { itemName: name, quantity: 0, revenue: 0 };
      entry.quantity += Number(line.quantity) || 0;
      entry.revenue += Number(line.line_total) || 0;
      byName.set(name, entry);
    }
    topSellers = [...byName.values()]
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5)
      .map((t) => ({
        ...t,
        quantity: t.quantity,
        revenue: Math.round(t.revenue * 100) / 100,
      }));
  }

  const low = lowStock
    .filter((i) => Number(i.stock_qty) <= Number(i.low_stock_at))
    .sort((a, b) => Number(a.stock_qty) - Number(b.stock_qty))
    .slice(0, 8)
    .map((i) => ({
      itemName: i.name,
      stockQty: Number(i.stock_qty) || 0,
      lowStockAt: Number(i.low_stock_at) || 0,
      unit: i.unit || 'pcs',
    }));

  return { date: dateStr, topSellers, lowStock: low };
}

/** HTML block for the digest (top sellers + low-stock) embedded in the email. */
export function renderDigestHtml(digest) {
  const sellers = digest.topSellers
    .map(
      (t, i) => `<tr><td class="rank">${i + 1}</td><td>${csvCell(t.itemName)}</td><td class="num">${t.quantity}</td><td class="num">৳ ${Number(t.revenue).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td></tr>`
    )
    .join('');
  const low = digest.lowStock
    .map(
      (i) => `<tr><td>${csvCell(i.itemName)}</td><td class="num">${i.stockQty} / ${i.lowStockAt} ${i.unit}</td></tr>`
    )
    .join('');
  return `
  <h2>🥇 Top sellers</h2>
  ${sellers ? `<table><thead><tr><th>#</th><th>Item</th><th class="num">Qty</th><th class="num">Revenue</th></tr></thead><tbody>${sellers}</tbody></table>` : '<div class="empty">No sales this day.</div>'}
  <h2>⚠️ Low stock</h2>
  ${low ? `<table><thead><tr><th>Item</th><th class="num">Stock / threshold</th></tr></thead><tbody>${low}</tbody></table>` : '<div class="empty">All items above their low-stock threshold. ✅</div>'}`;
}

/**
 * Sends the nightly merchant digest along with the closeout email: the email
 * body gains the digest sections, and (if configured) the WhatsApp webhook
 * gets a `digest.daily` push. Returns { email, webhook } results.
 */
export async function sendNightlyDigest({ tenant, date }) {
  const data = await buildCloseout(tenant.id, date);
  const digest = await buildDigest(tenant.id, date);
  const recipient = String(tenant.settings?.reports?.closeoutEmail || '').trim();

  let email = null;
  if (recipient) {
    const html = renderCloseoutHtml(data, tenant.name || 'Restaurant').replace(
      '<div class="foot">',
      `${renderDigestHtml(digest)}<div class="foot">`
    );
    const result = await sendEmail({
      to: recipient,
      subject: `Daily digest — ${data.date} — ${tenant.name || 'Restaurant'}`,
      html,
      attachments: [{ filename: `closeout-${data.date}.csv`, content: buildCloseoutCsv(data), contentType: 'text/csv' }],
    });
    email = { ...result, date: data.date, orders: data.orders.length, to: recipient };
  }
  return { email, digest, closeout: data };
}
