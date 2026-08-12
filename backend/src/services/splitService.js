import sequelize from '../config/db.js';
import { AppError } from '../middleware/errorHandler.js';
import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import Payment from '../models/Payment.js';
import OrderSplitItem from '../models/OrderSplitItem.js';
import Product from '../models/Product.js';
import { validateSplits, METHOD_LABELS } from './paymentsService.js';
import { recomputeOrderPaymentStatus } from './paymentsService.js';
import { audit } from './auditService.js';

/**
 * Dine-in split billing (per-diner receipts / cashier split panel).
 *
 * Model: a split is a set of `payments` rows — one per diner — exactly like
 * the Phase 6 split-payment foundation, extended with `split_method` +
 * `diner_index` and an `order_split_items` allocation table (migration 013).
 * This service is the single authority for split MATH: the panel may propose
 * anything, but amounts, methods, allocation and the exact-sum invariant are
 * recomputed/verified here (and inside a transaction) — the frontend never
 * dictates a total.
 *
 * Money strategy matches the rest of the app: integer paisa (1/100 taka)
 * internally, rounded to 2dp on the way out, so equal/custom/item splits sum
 * to the order's grand total EXACTLY (largest-remainder rounding).
 */

export const SPLIT_METHODS = ['equal', 'item', 'custom'];

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const toPaisa = (n) => Math.round((Number(n) || 0) * 100);
const fromPaisa = (p) => p / 100;

/** Workspace default VAT rate (tenant.settings.vat.defaultRate, default 5). */
export function tenantDefaultVat(tenant) {
  const raw = Number(tenant?.settings?.vat?.defaultRate ?? 5);
  return Number.isFinite(raw) && raw >= 0 ? raw : 5;
}

/**
 * Equal split with largest-remainder rounding: ৳100 / 3 diners →
 * [33.34, 33.33, 33.33]. Sum always equals the total exactly.
 */
export function computeEqualParts(total, dinerCount) {
  if (!Number.isInteger(dinerCount) || dinerCount < 1) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Diner count must be a positive integer');
  }
  const totalP = toPaisa(total);
  const base = Math.floor(totalP / dinerCount);
  const remainder = totalP - base * dinerCount;
  return Array.from({ length: dinerCount }, (_, i) =>
    fromPaisa(base + (i < remainder ? 1 : 0))
  );
}

/**
 * Forces an integer-paisa list to sum EXACTLY to a target by spreading the
 * (small) rounding residue one paisa at a time, round-robin. Every element
 * stays ≥ 0.
 */
function reconcileToTotal(fullPaisa, targetPaisa) {
  const out = fullPaisa.map((p) => Math.max(0, Math.floor(p)));
  let diff = targetPaisa - out.reduce((s, v) => s + v, 0);
  let i = 0;
  const guard = out.length * 1000;
  while (diff !== 0 && i < guard) {
    const idx = i % out.length;
    if (diff > 0) {
      out[idx] += 1;
      diff -= 1;
    } else if (out[idx] > 0) {
      out[idx] -= 1;
      diff += 1;
    }
    i += 1;
  }
  return out;
}

/**
 * Server-side split computation. Verifies mode/diners/allocation and returns
 * normalized parts (each = { method, amount, reference, note, diner_index,
 * items: [...] | null }). `vatRateOf(menuItemId)` resolves the product's VAT
 * rate for item splits (defaults to the workspace rate).
 */
export function computeSplitParts({ order, mode, diners, allocations = [], tenant, vatRateOf }) {
  const total = Number(order.grand_total ?? 0);
  const n = diners.length;
  if (n < 2) throw new AppError(400, 'VALIDATION_ERROR', 'A split needs at least 2 diners');
  if (n > 20) throw new AppError(400, 'VALIDATION_ERROR', 'A split supports at most 20 diners');
  if (!SPLIT_METHODS.includes(mode)) {
    throw new AppError(400, 'VALIDATION_ERROR', `Unknown split mode "${mode}"`);
  }
  const resolveVat = vatRateOf || (() => tenantDefaultVat(tenant));

  let amounts;
  let perDinerItems = null;

  if (mode === 'equal') {
    amounts = computeEqualParts(total, n);
  } else if (mode === 'custom') {
    amounts = diners.map((d) => Number(d.amount));
    if (amounts.some((a) => !Number.isFinite(a) || a <= 0)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Every diner needs a positive amount');
    }
    const sumP = amounts.reduce((s, a) => s + toPaisa(a), 0);
    if (sumP !== toPaisa(total)) {
      throw new AppError(
        400,
        'SPLIT_MISMATCH',
        `Custom amounts (৳${fromPaisa(sumP).toFixed(2)}) must sum to the order total (৳${total.toFixed(2)})`
      );
    }
  } else {
    // ── item split ─────────────────────────────────────────────────────
    const lines = order.items || [];
    const lineById = new Map(lines.map((l) => [l.id, l]));
    const perLine = new Map(); // orderItemId -> Map(dinerIndex -> qty)

    for (const a of allocations) {
      const line = lineById.get(Number(a.orderItemId));
      if (!line) throw new AppError(400, 'VALIDATION_ERROR', `Unknown order item ${a.orderItemId}`);
      const qty = Number(a.quantity);
      if (!Number.isInteger(qty) || qty < 1) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Allocated quantities must be positive integers');
      }
      const di = Number(a.dinerIndex);
      if (!Number.isInteger(di) || di < 0 || di >= n) {
        throw new AppError(400, 'VALIDATION_ERROR', `Invalid diner index ${di}`);
      }
      const m = perLine.get(line.id) || new Map();
      m.set(di, (m.get(di) || 0) + qty);
      perLine.set(line.id, m);
    }

    // Full allocation required — no over-allocation, no unassigned items
    // (TOTAL vs SUM OF SPLITS must reconcile exactly).
    const issues = [];
    for (const line of lines) {
      const assigned = [...(perLine.get(line.id) || new Map()).values()].reduce(
        (s, q) => s + q,
        0
      );
      if (assigned > line.quantity) {
        issues.push(`Over-allocated: ${line.item_name} (${assigned}/${line.quantity})`);
      } else if (assigned < line.quantity) {
        issues.push(`Unassigned: ${line.item_name} (${line.quantity - assigned} remaining)`);
      }
    }
    if (issues.length > 0) {
      throw new AppError(400, 'SPLIT_ALLOCATION_INVALID', issues.join('; '));
    }

    // Money per diner, full precision (paisa), then reconciled exactly.
    const dinerFull = new Array(n).fill(0);
    perDinerItems = Array.from({ length: n }, () => []);
    for (const line of lines) {
      const m = perLine.get(line.id);
      if (!m) continue;
      const lineTotalP = toPaisa(line.line_total);
      const discountP = toPaisa(line.discount);
      const unitP = toPaisa(line.unit_price);
      const rate = Number.isFinite(Number(line.Product?.vat_rate))
        ? Number(line.Product?.vat_rate)
        : resolveVat(line.product_id);
      for (const [di, qty] of m) {
        const frac = qty / line.quantity;
        const lineAmtP = Math.round(lineTotalP * frac);
        dinerFull[di] += lineAmtP;
        perDinerItems[di].push({
          menu_item_id: line.product_id ?? null,
          item_name: line.item_name,
          quantity: qty,
          unit_amount: fromPaisa(unitP),
          discount_amount: fromPaisa(Math.round(discountP * frac)),
          line_amount: fromPaisa(lineAmtP),
          vat_rate: rate,
        });
      }
    }

    // Delivery fee split equally; the last diner absorbs any rounding.
    const feeP = toPaisa(Number(order.delivery_fee) || 0);
    const feeBase = Math.floor(feeP / n);
    const feeRem = feeP - feeBase * n;
    for (let i = 0; i < n; i += 1) {
      dinerFull[i] += feeBase + (i < feeRem ? 1 : 0);
    }
    amounts = reconcileToTotal(dinerFull, toPaisa(total)).map(fromPaisa);
  }

  const parts = diners.map((d, i) => ({
    method: d.method,
    amount: amounts[i],
    reference: d.trxID || null,
    note: (d.label || '').trim().slice(0, 80) || `Diner ${i + 1}`,
    diner_index: i + 1,
    items: perDinerItems ? perDinerItems[i] : null,
  }));

  // Method enablement + exact-sum validation (reuses the Phase 6 split
  // validation — one source of truth for payment-part rules).
  return validateSplits(tenant, parts, total).map((p, i) => ({
    ...p,
    diner_index: i + 1,
    items: perDinerItems ? perDinerItems[i] : null,
  }));
}

/** True when a payment row blocks re-splitting (real money already moved). */
function paymentLocksSplit(payment) {
  if (payment.intent_ref) {
    return 'A gateway-managed payment cannot be re-split';
  }
  if (payment.status === 'refunded') {
    return 'Refunded payments block re-splitting';
  }
  if (payment.status === 'paid' && payment.method !== 'cash') {
    return `A collected ${payment.method} payment blocks re-splitting — refund it first`;
  }
  return null;
}

/**
 * Applies (or replaces) the split for an order inside ONE transaction.
 *
 * - Guards: non-terminal order (canceled/rejected blocked), no refunded or
 *   non-cash-collected payment rows, no gateway intents.
 * - Replaces the order's payment rows with one row per diner part (cash →
 *   paid on the spot, wallets → pending with the trxID), writes the item
 *   allocation for item splits, marks the order payment_method='split' and
 *   recomputes payment_status across the new rows.
 * - The old rows are replaced, not edited — the audit trail records the
 *   before/after so history survives a re-split.
 */
export async function applySplit({ tenant, order, mode, diners, allocations = [], actorId, req }) {
  const orderFull = await Order.findByPk(order.id, {
    include: [
      // Deterministic item order (PG returns included rows arbitrarily) so
      // validation errors like "Over-allocated: …" are stable across dialects.
      { model: OrderItem, as: 'items', order: [['id', 'ASC']], include: [{ model: Product }] },
      { model: Payment, as: 'payments' },
    ],
  });
  if (!orderFull) throw new AppError(404, 'NOT_FOUND', 'Order not found');

  const vatRateOf = (menuItemId) => {
    const line = (orderFull.items || []).find((l) => Number(l.product_id) === Number(menuItemId));
    const rate = line?.Product?.vat_rate;
    return Number.isFinite(Number(rate)) && Number(rate) >= 0
      ? Number(rate)
      : tenantDefaultVat(tenant);
  };
  const parts = computeSplitParts({
    order: orderFull,
    mode,
    diners,
    allocations,
    tenant,
    vatRateOf,
  });

  return sequelize.transaction(async (tx) => {
    // Row lock inside the transaction — two cashiers cannot race.
    const locked = await Order.findByPk(order.id, {
      transaction: tx,
      lock: tx.LOCK.UPDATE,
    });
    if (!locked || Number(locked.tenant_id) !== Number(tenant.id)) {
      throw new AppError(404, 'NOT_FOUND', 'Order not found');
    }
    if (['canceled', 'rejected'].includes(locked.status)) {
      throw new AppError(409, 'SPLIT_LOCKED', `Cannot split a ${locked.status} order`);
    }
    if (locked.payment_status === 'refunded') {
      throw new AppError(409, 'SPLIT_LOCKED', 'Refunded orders cannot be re-split');
    }

    const existing = await Payment.findAll({
      where: { order_id: order.id },
      transaction: tx,
    });
    for (const p of existing) {
      const lockReason = paymentLocksSplit(p);
      if (lockReason) throw new AppError(409, 'SPLIT_LOCKED', lockReason);
    }

    // Replace the split state: allocation rows first (FK), then payments.
    await OrderSplitItem.destroy({ where: { order_id: order.id }, transaction: tx });
    await Payment.destroy({ where: { order_id: order.id }, transaction: tx });

    const now = new Date();
    const created = await Payment.bulkCreate(
      parts.map((p) => ({
        tenant_id: tenant.id,
        order_id: order.id,
        method: p.method,
        amount: p.amount,
        status: p.method === 'cash' ? 'paid' : 'pending',
        reference: p.reference || null,
        notes: p.note || null,
        paid_at: p.method === 'cash' ? now : null,
        split_method: mode,
        diner_index: p.diner_index,
      })),
      { transaction: tx }
    );

    const itemsToCreate = [];
    parts.forEach((p, i) => {
      (p.items || []).forEach((it) => {
        itemsToCreate.push({
          tenant_id: tenant.id,
          order_id: order.id,
          payment_id: created[i].id,
          menu_item_id: it.menu_item_id ?? null,
          item_name: it.item_name,
          quantity: it.quantity,
          unit_amount: it.unit_amount,
          discount_amount: it.discount_amount,
          line_amount: it.line_amount,
          vat_rate: it.vat_rate,
          created_by: actorId ?? null,
        });
      });
    });
    if (itemsToCreate.length > 0) {
      await OrderSplitItem.bulkCreate(itemsToCreate, { transaction: tx });
    }

    locked.payment_method = 'split';
    await locked.save({ transaction: tx });
    const updated = await recomputeOrderPaymentStatus(locked, { transaction: tx });

    await audit({
      action: 'order.split',
      actorId,
      tenantId: tenant.id,
      entityType: 'order',
      entityId: order.id,
      metadata: {
        mode,
        replacedPayments: existing.length,
        parts: parts.map((p) => ({
          label: p.note,
          method: p.method,
          amount: p.amount,
        })),
      },
      req,
      transaction: tx,
    });

    return {
      id: order.id,
      mode,
      payment_status: updated.payment_status,
      parts: parts.map((p, i) => ({
        paymentId: created[i].id,
        dinerLabel: p.note,
        method: p.method,
        amount: p.amount,
        status: created[i].status,
      })),
    };
  });
}

/**
 * Removes the split and restores a single cash payment row for the full
 * total. Guarded: only when no real (non-cash) money moved and no refunds
 * exist — a POS-level "start over". The restored row is 'paid' when any
 * cash was collected by the parts, else 'pending' (honest about what was
 * actually collected).
 */
export async function clearSplit({ tenant, order, actorId, req }) {
  return sequelize.transaction(async (tx) => {
    const locked = await Order.findByPk(order.id, {
      transaction: tx,
      lock: tx.LOCK.UPDATE,
    });
    if (!locked || Number(locked.tenant_id) !== Number(tenant.id)) {
      throw new AppError(404, 'NOT_FOUND', 'Order not found');
    }
    if (['canceled', 'rejected'].includes(locked.status)) {
      throw new AppError(409, 'SPLIT_LOCKED', `Cannot un-split a ${locked.status} order`);
    }

    const existing = await Payment.findAll({
      where: { order_id: order.id },
      transaction: tx,
    });
    let hadCollectedCash = false;
    for (const p of existing) {
      const lockReason = paymentLocksSplit(p);
      if (lockReason) throw new AppError(409, 'SPLIT_LOCKED', lockReason);
      if (p.status === 'paid' && p.method === 'cash') hadCollectedCash = true;
    }

    await OrderSplitItem.destroy({ where: { order_id: order.id }, transaction: tx });
    await Payment.destroy({ where: { order_id: order.id }, transaction: tx });

    const total = Number(locked.grand_total ?? locked.total_amount ?? 0);
    const restored = await Payment.create(
      {
        tenant_id: tenant.id,
        order_id: order.id,
        method: 'cash',
        amount: total,
        status: hadCollectedCash ? 'paid' : 'pending',
        paid_at: hadCollectedCash ? new Date() : null,
      },
      { transaction: tx }
    );

    locked.payment_method = 'cash';
    await locked.save({ transaction: tx });
    const updated = await recomputeOrderPaymentStatus(locked, { transaction: tx });

    await audit({
      action: 'order.split.cleared',
      actorId,
      tenantId: tenant.id,
      entityType: 'order',
      entityId: order.id,
      metadata: { removedParts: existing.length },
      req,
      transaction: tx,
    });

    return {
      id: order.id,
      payment_method: 'cash',
      payment_status: updated.payment_status,
      paymentId: restored.id,
    };
  });
}

/** Current split state for the cashier panel (parts + items + totals). */
export function buildSplitState(order, defaultVatRate = 5) {
  const parts = (order.payments || []).map((p) => ({
    paymentId: p.id,
    dinerLabel: p.notes || null,
    splitMethod: p.split_method || null,
    dinerIndex: p.diner_index || null,
    method: p.method,
    amount: Number(p.amount) || 0,
    status: p.status,
    reference: p.reference || null,
    paidAt: p.paid_at || null,
    refundedAmount: p.refunded_amount != null ? Number(p.refunded_amount) : null,
    items: (p.splitItems || []).map((i) => ({
      menu_item_id: i.menu_item_id,
      item_name: i.item_name,
      quantity: i.quantity,
      unit_amount: Number(i.unit_amount) || 0,
      discount_amount: Number(i.discount_amount) || 0,
      line_amount: Number(i.line_amount) || 0,
      vat_rate: Number(i.vat_rate) || 0,
    })),
  }));
  const grandTotal = Number(order.grand_total || 0);
  const sumOfParts = round2(parts.reduce((s, p) => s + p.amount, 0));

  return {
    order: {
      id: order.id,
      order_no: order.order_no,
      table_no: order.table_no,
      customer_name: order.customer_name,
      status: order.status,
      payment_status: order.payment_status,
      payment_method: order.payment_method,
      grand_total: grandTotal,
      subtotal: Number(order.subtotal || 0),
      total_discount: Number(order.total_discount || 0),
      delivery_fee: Number(order.delivery_fee || 0),
      createdAt: order.createdAt?.toISOString ? order.createdAt.toISOString() : null,
    },
    items: (order.items || []).map((l) => {
      const rawRate = Number(l.Product?.vat_rate);
      return {
        orderItemId: l.id,
        menu_item_id: l.product_id,
        item_name: l.item_name,
        quantity: l.quantity,
        unit_price: Number(l.unit_price) || 0,
        discount: Number(l.discount) || 0,
        line_total: Number(l.line_total) || 0,
        vat_rate: Number.isFinite(rawRate) && rawRate >= 0 ? rawRate : defaultVatRate,
      };
    }),
    parts,
    totals: {
      grandTotal,
      sumOfParts,
      reconciles: Math.abs(sumOfParts - grandTotal) < 0.01,
    },
    isSplit: parts.some((p) => p.splitMethod),
  };
}

/**
 * Per-diner receipt document — one diner's items + VAT + payable, computed
 * from the STORED split allocation (never live menu prices), so a receipt
 * printed today matches the bill the diner agreed to.
 */
export function buildDinerReceipt({ order, tenant, payment }) {
  const defaultRate = tenantDefaultVat(tenant);
  const items = (payment.splitItems || []).map((i) => {
    const lineTotal = Number(i.line_amount) || 0;
    const rawRate = Number(i.vat_rate);
    const vatRate = Number.isFinite(rawRate) && rawRate >= 0 ? rawRate : defaultRate;
    const vat = round2((lineTotal * vatRate) / (100 + vatRate));
    return {
      itemName: i.item_name,
      quantity: i.quantity,
      unitPrice: Number(i.unit_amount) || 0,
      discount: Number(i.discount_amount) || 0,
      lineTotal,
      vatRate,
      vat,
    };
  });
  const subtotal = round2(items.reduce((s, i) => s + i.lineTotal, 0));
  const discount = round2(items.reduce((s, i) => s + i.discount, 0));
  const vat = round2(items.reduce((s, i) => s + i.vat, 0));
  const net = round2(subtotal - discount - vat);
  const payable = Number(payment.amount) || 0;
  // The payment amount is the EXACT reconciled total; per-line rounding can
  // leave a paisa-scale residue — shown explicitly so the receipt adds up.
  const rounding = round2(payable - net);

  return {
    receiptNo: `DIN-${order.order_no || order.id}-${payment.id}`,
    orderId: order.id,
    orderNo: order.order_no,
    paymentId: payment.id,
    restaurantName: tenant?.name || 'Restaurant',
    tableNo: order.table_no,
    dinerLabel: payment.notes || `Diner ${payment.diner_index || 1}`,
    dinerIndex: payment.diner_index || 1,
    splitMethod: payment.split_method,
    createdAt: order.createdAt?.toISOString ? order.createdAt.toISOString() : null,
    customerName: order.customer_name,
    items,
    payment: {
      method: payment.method,
      methodLabel: METHOD_LABELS[payment.method] || payment.method,
      status: payment.status,
      reference: payment.reference || null,
      paidAt: payment.paid_at || null,
    },
    totals: { subtotal, discount, vat, net, payable, rounding },
  };
}

/** Escapes a value for safe inline HTML (quotes + angle brackets). */
const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const SPLIT_METHOD_LABEL = { equal: 'Equal split', item: 'Item split', custom: 'Custom split' };

/**
 * Print-ready diner receipt HTML — narrow (58/80mm-friendly) sheet that also
 * renders well on A4; browser print / Save-as-PDF, no heavyweight PDF lib.
 */
export function renderDinerReceiptHtml(receipt) {
  const fmt = (n) => `৳ ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const rows = receipt.items
    .map(
      (i) => `<tr>
        <td>${esc(i.itemName)}<br><small>${i.quantity} × ${fmt(i.unitPrice)}</small></td>
        <td class="num">${fmt(i.lineTotal)}</td>
      </tr>`
    )
    .join('');
  const adjustment =
    Math.abs(receipt.totals.rounding) > 0.005
      ? `<tr class="adj"><td>Rounding adjustment</td><td class="num">${fmt(receipt.totals.rounding)}</td></tr>`
      : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Diner receipt ${esc(receipt.dinerLabel)} — ${esc(receipt.restaurantName)}</title>
<style>
  :root{--ink:#16181d;--muted:#68707a;--line:#e6e8ec;--brand:#e11d48;--bg:#fff}
  *{box-sizing:border-box}
  body{font-family:system-ui,'Segoe UI',Roboto,'Noto Sans Bengali',sans-serif;color:var(--ink);margin:0;background:#f6f7f9;padding:32px}
  .sheet{max-width:380px;margin:0 auto;background:var(--bg);border-radius:16px;padding:28px;box-shadow:0 8px 28px rgba(0,0,0,.06)}
  .brand{text-align:center;border-bottom:2px dashed var(--line);padding-bottom:14px;margin-bottom:14px}
  .brand h1{font-size:18px;margin:0 0 2px;letter-spacing:.02em}
  .brand .sub{color:var(--muted);font-size:12px;margin:0}
  .meta{display:flex;justify-content:space-between;font-size:12.5px;margin:6px 0}
  .meta b{font-weight:700}
  .diner{text-align:center;background:#fdeef1;color:var(--brand);font-weight:800;border-radius:999px;padding:6px 14px;font-size:14px;margin:12px 0}
  h2{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:16px 0 6px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  td{padding:6px 0;border-bottom:1px dashed var(--line);vertical-align:top}
  td small{color:var(--muted);font-size:11px}
  .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .totals{margin-top:12px;font-size:13px}
  .totals .row{display:flex;justify-content:space-between;padding:4px 0}
  .totals .row.total{border-top:2px solid var(--ink);margin-top:6px;padding-top:8px;font-size:16px;font-weight:800}
  .totals .row.adj{color:var(--muted);font-size:12px}
  .pay{margin-top:14px;background:#fafbfc;border:1px solid var(--line);border-radius:12px;padding:10px 12px;font-size:12.5px;display:grid;gap:4px}
  .pay .row{display:flex;justify-content:space-between}
  .mono{font-family:'JetBrains Mono',Consolas,monospace;font-size:11.5px}
  .foot{margin-top:16px;text-align:center;color:var(--muted);font-size:10.5px;border-top:1px dashed var(--line);padding-top:10px}
  .btn{display:block;width:100%;margin:18px 0 0;padding:11px;border:none;border-radius:999px;background:var(--brand);color:#fff;font-weight:800;font-size:14px;cursor:pointer}
  @media print{
    body{background:#fff;padding:0}
    .sheet{box-shadow:none;border-radius:0;padding:12px;max-width:none}
    .btn{display:none}
  }
</style></head><body>
<div class="sheet">
  <div class="brand">
    <h1>${esc(receipt.restaurantName)}</h1>
    <p class="sub">${esc(receipt.receiptNo)}</p>
    <p class="sub">${receipt.createdAt ? new Date(receipt.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</p>
  </div>
  <div class="meta"><span><b>Order</b></span><span>${esc(receipt.orderNo || receipt.orderId)}</span></div>
  <div class="meta"><span><b>Table</b></span><span>${receipt.tableNo ? `🪑 ${receipt.tableNo}` : '—'}</span></div>
  <div class="meta"><span><b>Split</b></span><span>${SPLIT_METHOD_LABEL[receipt.splitMethod] || esc(receipt.splitMethod || '—')}</span></div>
  <div class="diner">${esc(receipt.dinerLabel)}</div>
  <h2>Items</h2>
  <table>
    <tbody>${rows || '<tr><td>—</td></tr>'}</tbody>
  </table>
  <div class="totals">
    <div class="row"><span>Subtotal</span><span>${fmt(receipt.totals.subtotal)}</span></div>
    <div class="row"><span>Discount</span><span>${receipt.totals.discount ? `−${fmt(receipt.totals.discount)}` : '—'}</span></div>
    <div class="row"><span>VAT</span><span>${fmt(receipt.totals.vat)}</span></div>
    <div class="row"><span>Net</span><span>${fmt(receipt.totals.net)}</span></div>
    ${adjustment}
    <div class="row total"><span>Payable</span><span>${fmt(receipt.totals.payable)}</span></div>
  </div>
  <div class="pay">
    <div class="row"><span>Method</span><span>${esc(receipt.payment.methodLabel)} · ${esc(receipt.payment.status)}</span></div>
    ${receipt.payment.reference ? `<div class="row"><span>trxID</span><span class="mono">${esc(receipt.payment.reference)}</span></div>` : ''}
    ${receipt.payment.paidAt ? `<div class="row"><span>Paid at</span><span>${new Date(receipt.payment.paidAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}</span></div>` : ''}
  </div>
  <div class="foot">Thank you! · Orderly OMS · VAT per item (NBR: line × rate/(100+rate))</div>
  <button class="btn" onclick="window.print()">🖨️ Print receipt</button>
</div>
</body></html>`;
}
