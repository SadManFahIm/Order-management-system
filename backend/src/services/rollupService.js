import { Op } from 'sequelize';
import Tenant from '../models/Tenant.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import DailyStat from '../models/DailyStat.js';

/**
 * Daily analytics rollup (Phase 7) — the query-cost mitigation layer.
 *
 * Each active workspace gets one `daily_stats` row per Dhaka day with
 * pre-aggregated revenue/orders, the payment-method mix, and a sparse
 * day×hour peak-hours map. The dashboard serves its historical trend and
 * heatmap from these rows when `?source=rollup` is passed, instead of
 * scanning raw orders + payments on every load — which is what keeps the
 * roadmap's <2s p95 target achievable on 6-month datasets.
 *
 * The nightly tick upserts yesterday for every active/trial tenant
 * (idempotent — re-running never duplicates); `npm run db:rollup`
 * backfills the last N days on demand.
 */

export const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000; // UTC+6, no DST
const METHOD_ORDER = ['cash', 'bkash', 'nagad', 'card', 'online', 'other'];

/** YYYY-MM-DD (Dhaka day) → UTC bounds for the raw-data query. */
export const dhakaDayBounds = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const startUtc = new Date(Date.UTC(y, m - 1, d) - DHAKA_OFFSET_MS);
  return { startUtc, endUtc: new Date(startUtc.getTime() + 24 * 60 * 60 * 1000) };
};

/**
 * Computes one tenant's stats for a Dhaka day and upserts the row.
 * Same aggregation math as the live dashboard (paid revenue from the order
 * payment_status; method mix from paid payments; peak hours from Dhaka-shifted
 * createdAt). Returns the upserted row.
 */
export async function buildDailyStat(tenantId, dateStr) {
  const { startUtc, endUtc } = dhakaDayBounds(dateStr);

  const [orders, payments] = await Promise.all([
    Order.findAll({
      where: { tenant_id: tenantId, createdAt: { [Op.gte]: startUtc, [Op.lt]: endUtc } },
      attributes: ['grand_total', 'payment_status', 'createdAt'],
    }),
    Payment.findAll({
      where: {
        tenant_id: tenantId,
        status: 'paid',
        createdAt: { [Op.gte]: startUtc, [Op.lt]: endUtc },
      },
      attributes: ['method', 'amount', 'createdAt'],
    }),
  ]);

  const revenue = orders.reduce(
    (s, o) => s + (o.payment_status === 'paid' ? Number(o.grand_total || 0) : 0),
    0
  );
  const methodMix = METHOD_ORDER.reduce((m, k) => ({ ...m, [k]: 0 }), {});
  for (const p of payments) {
    const k = METHOD_ORDER.includes(p.method) ? p.method : 'other';
    methodMix[k] += Number(p.amount || 0);
  }

  // Sparse { "<day>": { "<hour>": { orders, revenue } } } — Sun-first days,
  // Dhaka hours (matches the live heatmap's cell semantics).
  const peakHours = {};
  for (const o of orders) {
    const dh = new Date(o.createdAt.getTime() + DHAKA_OFFSET_MS);
    const day = dh.getUTCDay();
    const hour = dh.getUTCHours();
    peakHours[day] = peakHours[day] || {};
    peakHours[day][hour] = peakHours[day][hour] || { orders: 0, revenue: 0 };
    peakHours[day][hour].orders += 1;
    if (o.payment_status === 'paid') {
      peakHours[day][hour].revenue += Number(o.grand_total || 0);
    }
  }

  const roundedMix = Object.fromEntries(
    Object.entries(methodMix).map(([k, v]) => [k, Math.round(v * 100) / 100])
  );

  const [row] = await DailyStat.upsert({
    tenant_id: tenantId,
    stat_date: dateStr,
    revenue: Math.round(revenue * 100) / 100,
    orders: orders.length,
    method_mix: roundedMix,
    peak_hours: peakHours,
    category_mix: {},
  });
  return row;
}

/** Nightly tick — upsert yesterday's row for every active/trial tenant. */
export async function runRollupScheduler(now = new Date()) {
  const dhakaNow = new Date(now.getTime() + DHAKA_OFFSET_MS);
  const yesterday = new Date(dhakaNow.getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const tenants = await Tenant.findAll({
    where: { status: { [Op.in]: ['active', 'trial'] } },
    attributes: ['id'],
  });
  let built = 0;
  for (const tenant of tenants) {
    try {
      await buildDailyStat(tenant.id, yesterday);
      built += 1;
    } catch (e) {
      // One failing workspace must never stop the others (or the tick).
      console.error(`[rollup] failed for tenant ${tenant.id}: ${e.message}`);
    }
  }
  return built;
}

/** Hourly tick; `unref()` keeps it from holding the process open. */
export function startRollupScheduler({ intervalMs = 3600_000 } = {}) {
  const timer = setInterval(() => {
    runRollupScheduler().catch((e) =>
      console.error(`[rollup] scheduler tick failed: ${e.message}`)
    );
  }, intervalMs);
  timer.unref?.();
  console.log(`[rollup] nightly rollup scheduler started (every ${intervalMs}ms)`);
  return timer;
}

/**
 * CLI backfill — build the last `fromDays` Dhaka days for one tenant or all
 * active/trial tenants. Idempotent (upsert per day).
 */
export async function backfillRollup({ tenantId = null, fromDays = 30 } = {}) {
  const dhakaNow = new Date(Date.now() + DHAKA_OFFSET_MS);
  const tenants = tenantId
    ? [{ id: tenantId }]
    : await Tenant.findAll({
        where: { status: { [Op.in]: ['active', 'trial'] } },
        attributes: ['id'],
      });
  let built = 0;
  for (const tenant of tenants) {
    for (let i = 0; i < fromDays; i += 1) {
      const dateStr = new Date(dhakaNow.getTime() - i * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      await buildDailyStat(tenant.id, dateStr);
      built += 1;
    }
  }
  return built;
}
