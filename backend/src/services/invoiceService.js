import Product from '../models/Product.js';
import { METHOD_LABELS } from './paymentsService.js';

/**
 * Order invoices (Phase 6) — a VAT-aware, payment-linked invoice per order.
 *
 * Menu pricing is VAT-inclusive (the BD norm), so each line's amount is split
 * by the item's own `vat_rate` (default 5%, some items 15%, 0% exempt):
 * VAT = line × rate/(100+rate), net = line − VAT. The invoice references the
 * order's payment records (method, amount, status, trxID) so the merchant's
 * PDF ties money to items. Rendered as print-ready HTML (browser Save-as-PDF,
 * perfect Bangla rendering) — same pattern as the daily closeout.
 */

/** Builds the full invoice document for one order (items + VAT + payments). */
export async function buildInvoice(order, tenant) {
  const defaultRateRaw = Number(tenant?.settings?.vat?.defaultRate ?? 5);
  const defaultRate = Number.isFinite(defaultRateRaw) && defaultRateRaw >= 0 ? defaultRateRaw : 5;

  const productIds = (order.items || [])
    .map((i) => i.product_id)
    .filter((id) => id != null);
  const products = productIds.length
    ? await Product.findAll({ where: { id: productIds }, attributes: ['id', 'vat_rate'] })
    : [];
  const rateByProduct = new Map();
  for (const p of products) {
    const rate = Number(p.vat_rate);
    rateByProduct.set(p.id, Number.isFinite(rate) && rate >= 0 ? rate : defaultRate);
  }

  let subtotal = 0;
  let discountTotal = 0;
  let vatTotal = 0;
  let netTotal = 0;
  const items = (order.items || []).map((line) => {
    const qty = Number(line.quantity) || 0;
    const lineTotal = Number(line.line_total) || 0;
    const discount = Number(line.discount) || 0;
    const rate = rateByProduct.get(line.product_id) ?? defaultRate;
    const vat = Math.round((lineTotal * rate) / (100 + rate) * 100) / 100;
    const net = Math.round((lineTotal - vat) * 100) / 100;
    subtotal += Number(line.unit_price) * qty;
    discountTotal += discount;
    vatTotal += vat;
    netTotal += net;
    return {
      itemName: line.item_name,
      quantity: qty,
      unitPrice: Number(line.unit_price),
      discount,
      lineTotal,
      vatRate: rate,
      vat,
      net,
    };
  });

  const payments = (order.payments || []).map((p) => ({
    method: p.method,
    methodLabel: METHOD_LABELS[p.method] || p.method,
    amount: Number(p.amount),
    status: p.status,
    reference: p.reference || null,
    refundedAmount: p.refunded_amount != null ? Number(p.refunded_amount) : null,
    paidAt: p.paid_at || null,
  }));

  return {
    invoiceNo: `INV-${order.order_no || order.id}`,
    orderId: order.id,
    orderNo: order.order_no,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    customerAddress: order.customer_address,
    tableNo: order.table_no,
    createdAt: order.createdAt?.toISOString ? order.createdAt.toISOString() : null,
    restaurantName: tenant?.name || 'Restaurant',
    status: order.status,
    paymentStatus: order.payment_status,
    items,
    payments,
    totals: {
      subtotal: Math.round(subtotal * 100) / 100,
      discount: Math.round(discountTotal * 100) / 100,
      vat: Math.round(vatTotal * 100) / 100,
      net: Math.round(netTotal * 100) / 100,
      grandTotal: Number.isFinite(Number(order.grand_total))
        ? Number(order.grand_total)
        : Math.round((subtotal - discountTotal) * 100) / 100,
    },
  };
}

/** Escapes a value for safe inline HTML (quotes + angle brackets). */
const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Renders the invoice as a print-ready HTML document (PDF via browser). */
export function renderInvoiceHtml(invoice) {
  const fmt = (n) =>
    `৳ ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const rows = invoice.items
    .map(
      (i) => `<tr>
        <td>${esc(i.itemName)}</td>
        <td class="num">${i.quantity}</td>
        <td class="num">${fmt(i.unitPrice)}</td>
        <td class="num">${i.discount ? `−${fmt(i.discount)}` : '—'}</td>
        <td class="num">${i.vatRate}%</td>
        <td class="num">${fmt(i.vat)}</td>
        <td class="num">${fmt(i.lineTotal)}</td>
      </tr>`
    )
    .join('');
  const payRows = invoice.payments
    .map(
      (p) => `<div class="method">
        <span>${esc(p.methodLabel)} ${p.refundedAmount != null ? `(refunded ${fmt(p.refundedAmount)})` : ''} <small class="mono">${esc(p.reference || '')}</small></span>
        <span class="num">${fmt(p.amount)} · ${esc(p.status)}</span>
      </div>`
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Invoice ${esc(invoice.invoiceNo)} — ${esc(invoice.restaurantName)}</title>
<style>
  :root{--ink:#16181d;--muted:#68707a;--line:#e6e8ec;--brand:#e11d48;--bg:#fff}
  *{box-sizing:border-box}
  body{font-family:system-ui,'Segoe UI',Roboto,'Noto Sans Bengali',sans-serif;color:var(--ink);margin:0;background:#f6f7f9;padding:32px}
  .sheet{max-width:760px;margin:0 auto;background:var(--bg);border-radius:16px;padding:40px 44px;box-shadow:0 8px 28px rgba(0,0,0,.06)}
  .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px}
  h1{font-size:22px;margin:0 0 4px}
  .sub{color:var(--muted);margin:0;font-size:13.5px}
  .mono{font-family:'JetBrains Mono',Consolas,monospace;font-size:12px}
  .badge{display:inline-block;background:#fdeef1;color:var(--brand);font-size:12px;font-weight:700;border-radius:999px;padding:4px 12px}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;background:#fafbfc;border:1px solid var(--line);border-radius:12px;padding:14px 16px;font-size:13.5px;margin-bottom:22px}
  .meta b{color:var(--muted);font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;display:block}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:22px 0 10px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);padding:8px 6px;border-bottom:2px solid var(--line)}
  td{padding:8px 6px;border-bottom:1px solid var(--line)}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .totals{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:16px}
  .stat{background:#fafbfc;border:1px solid var(--line);border-radius:12px;padding:12px 14px}
  .stat b{display:block;font-size:18px;margin-top:3px;font-variant-numeric:tabular-nums}
  .stat span{font-size:11.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  .method{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px dashed var(--line);font-size:14px}
  .foot{margin-top:28px;color:var(--muted);font-size:11.5px;border-top:1px solid var(--line);padding-top:14px}
  @media print{body{background:#fff;padding:0}.sheet{box-shadow:none;border-radius:0;padding:0;max-width:none}}
</style></head><body><div class="sheet">
  <div class="top">
    <div>
      <h1>${esc(invoice.restaurantName)}</h1>
      <p class="sub">${esc(invoice.invoiceNo)} · ${invoice.createdAt ? new Date(invoice.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' }) : ''}</p>
    </div>
    <div>
      <span class="badge">${esc(invoice.paymentStatus)}</span>
    </div>
  </div>
  <div class="meta">
    <div><b>Order</b>${esc(invoice.orderNo || invoice.orderId)}</div>
    <div><b>Customer</b>${esc(invoice.customerName)}${invoice.customerPhone ? ` · ${esc(invoice.customerPhone)}` : ''}</div>
    <div><b>Table</b>${invoice.tableNo ? `🪑 ${invoice.tableNo}` : '—'}</div>
    <div><b>Status</b>${esc(invoice.status)}</div>
  </div>
  <h2>Items</h2>
  <table>
    <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Disc</th><th class="num">VAT %</th><th class="num">VAT</th><th class="num">Line</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div class="stat"><span>Subtotal</span><b>${fmt(invoice.totals.subtotal)}</b></div>
    <div class="stat"><span>Discount</span><b>${fmt(invoice.totals.discount)}</b></div>
    <div class="stat"><span>VAT</span><b>${fmt(invoice.totals.vat)}</b></div>
    <div class="stat"><span>Grand total</span><b>${fmt(invoice.totals.grandTotal)}</b></div>
  </div>
  <h2>Payments</h2>
  ${payRows || '<div class="sub">No payment records.</div>'}
  <div class="foot">VAT split per item (Bangladesh NBR convention: VAT = line × rate/(100+rate)) · generated ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })} · Orderly OMS</div>
</div></body></html>`;
}
