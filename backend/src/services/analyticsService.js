import { Op } from 'sequelize';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';
import { wallToUtc, dateKeyIn } from '../utils/timezone.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import OrderItem from '../models/OrderItem.js';
import Product from '../models/Product.js';
import MenuCategory from '../models/MenuCategory.js';
import AnalyticsEvent from '../models/AnalyticsEvent.js';
import AuditLog from '../models/AuditLog.js';
import User from '../models/User.js';
import UserTenant from '../models/UserTenant.js';
import { csvCell } from './reportsService.js';

/**
 * Analytics service (Phase 7) — the single filter engine + aggregations
 * behind /api/analytics/* and the extended /api/dashboard filters.
 *
 * Conventions inherited from the existing codebase:
 *   • Revenue = orders' grand_total where payment_status='paid' (the same
 *     definition the dashboard trend + closeout use).
 *   • Day buckets are date-only keys ('YYYY-MM-DD') resolved in a timezone —
 *     the tenant's configured IANA zone when set, else Asia/Dhaka (UTC+6,
 *     no DST — the app's established business timezone).
 *   • Zero-denominator percentages return null (never NaN/Infinity), the
 *     same convention as monthOverMonth.pct on the dashboard.
 */

export const CHANNELS = ['pos', 'storefront'];
export const ORDER_TYPES = ['pickup', 'delivery', 'scheduled_pickup', 'scheduled_delivery'];
export const DEFAULT_TIMEZONE = 'Asia/Dhaka';
const METHOD_ORDER = ['cash', 'bkash', 'nagad', 'card', 'online', 'other'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// ── Date helpers (pure string math — never local-time parsing) ─────────────

const utcMs = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** True when `s` is a real calendar date in YYYY-MM-DD form. */
export function isValidDateStr(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const ms = utcMs(s);
  if (Number.isNaN(ms)) return false;
  return new Date(ms).toISOString().slice(0, 10) === s;
}

/** Shifts a YYYY-MM-DD string by N days (UTC-safe). */
export function addDays(dateStr, days) {
  return new Date(utcMs(dateStr) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive list of day keys between two validated date strings. */
export function dayKeysBetween(from, to) {
  const keys = [];
  for (let ms = utcMs(from); ms <= utcMs(to); ms += DAY_MS) {
    keys.push(new Date(ms).toISOString().slice(0, 10));
  }
  return keys;
}

/** IANA validity probe (Intl throws on unknown zones). */
export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * The effective analytics timezone: explicit ?timezone= wins (must be valid),
 * else the tenant's configured zone, else Asia/Dhaka.
 */
export function resolveTimezone(requested, tenant) {
  if (requested !== undefined && requested !== '') {
    if (!isValidTimeZone(requested)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Unknown timezone');
    }
    return requested;
  }
  const configured = tenant?.settings?.timezone;
  if (configured && isValidTimeZone(configured)) return configured;
  return DEFAULT_TIMEZONE;
}

const parseEnumFilter = (raw, allowed, label) => {
  if (raw === undefined || raw === '' || raw === 'all') return null;
  if (!allowed.includes(raw)) {
    throw new AppError(400, 'VALIDATION_ERROR', `Invalid ${label} — allowed: all, ${allowed.join(', ')}`);
  }
  return raw;
};

/**
 * Parses + validates the shared analytics filter object from query params:
 *   from/to     — inclusive YYYY-MM-DD bounds (both or neither; default last
 *                 7 days ending today); span capped by ANALYTICS_MAX_RANGE_DAYS
 *   timezone    — optional IANA override
 *   channel     — pos | storefront | all
 *   order_type  — pickup | delivery | scheduled_pickup | scheduled_delivery | all
 *
 * Returns the filter plus resolved UTC bounds [startUtc, endUtc) and the
 * zero-filled day-key axis every series shares.
 */
export function parseAnalyticsFilters(query = {}, tenant = null) {
  const timezone = resolveTimezone(query.timezone, tenant);

  let { from, to } = query;
  if ((from === undefined) !== (to === undefined)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Provide both `from` and `to`');
  }
  if (from === undefined) {
    to = dateKeyIn(new Date(), timezone);
    from = addDays(to, -6);
  } else {
    if (!isValidDateStr(from)) throw new AppError(400, 'VALIDATION_ERROR', '`from` must be a valid date (YYYY-MM-DD)');
    if (!isValidDateStr(to)) throw new AppError(400, 'VALIDATION_ERROR', '`to` must be a valid date (YYYY-MM-DD)');
    if (from > to) throw new AppError(400, 'VALIDATION_ERROR', '`from` must not be after `to`');
    const spanDays = Math.round((utcMs(to) - utcMs(from)) / DAY_MS) + 1;
    if (spanDays > env.ANALYTICS_MAX_RANGE_DAYS) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `Date range too large — maximum ${env.ANALYTICS_MAX_RANGE_DAYS} days`
      );
    }
  }

  const channel = parseEnumFilter(query.channel, CHANNELS, 'channel');
  const orderType = parseEnumFilter(query.order_type, ORDER_TYPES, 'order_type');

  const [fy, fm, fd] = from.split('-').map(Number);
  const endKey = addDays(to, 1);
  const [ey, em, ed] = endKey.split('-').map(Number);
  const startUtc = wallToUtc({ year: fy, month: fm, day: fd, hour: 0, minute: 0 }, timezone);
  const endUtc = wallToUtc({ year: ey, month: em, day: ed, hour: 0, minute: 0 }, timezone);

  return { from, to, timezone, channel, orderType, startUtc, endUtc, dayKeys: dayKeysBetween(from, to) };
}

/** Serialized form of the filters echoed back in every response. */
export function serializeFilters(filters) {
  return {
    from: filters.from,
    to: filters.to,
    timezone: filters.timezone,
    channel: filters.channel || 'all',
    orderType: filters.orderType || 'all',
  };
}

/** Tenant-scoped window where-clause with channel/order-type applied. */
export function analyticsOrderWhere(tenantId, filters, extra = {}) {
  const where = {
    tenant_id: tenantId,
    createdAt: { [Op.gte]: filters.startUtc, [Op.lt]: filters.endUtc },
    ...extra,
  };
  if (filters.channel) where.channel = filters.channel;
  if (filters.orderType) where.type = filters.orderType;
  return where;
}

const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;

/** Safe percentage — null when the denominator is 0 (never NaN/Infinity). */
export const safePct = (numerator, denominator) =>
  denominator > 0 ? round1((numerator / denominator) * 100) : null;

// ── Summary (revenue/orders series + KPIs + mixes) ─────────────────────────

/**
 * Aggregated summary for the window: zero-filled daily revenue/orders
 * series, KPI totals, status breakdown and paid-method mix. All math runs
 * here (backend-authoritative) — the frontend only renders.
 */
export async function buildSummary(tenantId, filters) {
  const paymentInclude =
    filters.channel || filters.orderType
      ? [
          {
            model: Order,
            attributes: [],
            where: {
              ...(filters.channel ? { channel: filters.channel } : {}),
              ...(filters.orderType ? { type: filters.orderType } : {}),
            },
          },
        ]
      : [];

  const [orders, payments] = await Promise.all([
    Order.findAll({
      where: analyticsOrderWhere(tenantId, filters),
      attributes: ['grand_total', 'payment_status', 'status', 'type', 'channel', 'createdAt'],
    }),
    Payment.findAll({
      where: {
        tenant_id: tenantId,
        status: 'paid',
        createdAt: { [Op.gte]: filters.startUtc, [Op.lt]: filters.endUtc },
      },
      attributes: ['method', 'amount'],
      ...(paymentInclude.length ? { include: paymentInclude } : {}),
    }),
  ]);

  // Zero-filled daily series — charts always render a complete axis.
  const byDay = new Map(filters.dayKeys.map((k) => [k, { date: k, revenue: 0, orders: 0 }]));
  const statusCounts = new Map();
  let totalRevenue = 0;
  let paidOrders = 0;
  let canceledOrders = 0;
  for (const o of orders) {
    const entry = byDay.get(dayKeyInTz(o.createdAt, filters.timezone));
    if (entry) entry.orders += 1;
    if (o.payment_status === 'paid') {
      totalRevenue += Number(o.grand_total || 0);
      paidOrders += 1;
      if (entry) entry.revenue += Number(o.grand_total || 0);
    }
    if (o.status === 'canceled') canceledOrders += 1;
    statusCounts.set(o.status, (statusCounts.get(o.status) || 0) + 1);
  }

  const mixByMethod = new Map(METHOD_ORDER.map((m) => [m, { method: m, amount: 0, count: 0 }]));
  for (const p of payments) {
    const key = METHOD_ORDER.includes(p.method) ? p.method : 'other';
    const entry = mixByMethod.get(key) || { method: key, amount: 0, count: 0 };
    entry.amount += Number(p.amount || 0);
    entry.count += 1;
    mixByMethod.set(key, entry);
  }

  const series = [...byDay.values()].map((d) => ({
    date: d.date,
    revenue: round2(d.revenue),
    orders: d.orders,
  }));

  return {
    filters: serializeFilters(filters),
    summary: {
      totalRevenue: round2(totalRevenue),
      totalOrders: orders.length,
      paidOrders,
      canceledOrders,
      avgOrderValue: paidOrders > 0 ? round2(totalRevenue / paidOrders) : 0,
    },
    series,
    statusBreakdown: [...statusCounts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => a.status.localeCompare(b.status)),
    methodMix: [...mixByMethod.values()]
      .filter((m) => m.count > 0)
      .map((m) => ({ ...m, amount: round2(m.amount) }))
      .sort((a, b) => b.amount - a.amount),
    generatedAt: new Date().toISOString(),
  };
}

/** Day key of an instant in the filter's timezone (reuses utils/timezone). */
function dayKeyInTz(date, timeZone) {
  return dateKeyIn(new Date(date), timeZone);
}

// ── Chart datasets shared with /api/analytics/export.csv ───────────────────

/**
 * Paid line items grouped by menu category — mirrors the dashboard's
 * category mix but over the custom window/filters. Soft-delete-safe
 * (paranoid: false joins); 'Uncategorized' when a product has no category.
 */
export async function buildCategoryMix(tenantId, filters) {
  const lines = await OrderItem.findAll({
    where: { tenant_id: tenantId },
    include: [
      {
        model: Order,
        as: 'Order',
        attributes: ['payment_status'],
        where: analyticsOrderWhere(tenantId, filters),
      },
      {
        model: Product,
        as: 'Product',
        attributes: ['category_id'],
        required: false,
        paranoid: false,
        include: [
          { model: MenuCategory, as: 'category', attributes: ['name'], required: false, paranoid: false },
        ],
      },
    ],
    attributes: ['item_name', 'quantity', 'line_total'],
    limit: 5000,
  });

  const byCategory = new Map();
  for (const line of lines) {
    if (line.Order?.payment_status !== 'paid') continue;
    const name = line.Product?.category?.name || 'Uncategorized';
    const entry = byCategory.get(name) || { name, revenue: 0, quantity: 0 };
    entry.revenue += Number(line.line_total || 0);
    entry.quantity += Number(line.quantity || 0);
    byCategory.set(name, entry);
  }
  const total = [...byCategory.values()].reduce((s, c) => s + c.revenue, 0);
  return {
    filters: serializeFilters(filters),
    categoryMix: [...byCategory.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .map((c) => ({
        name: c.name,
        revenue: round2(c.revenue),
        quantity: c.quantity,
        pct: total > 0 ? round1((c.revenue / total) * 100) : 0,
      })),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Top items by quantity over the window (denormalised item_name — survives
 * soft-deleted products), mirroring the dashboard's top-items snapshot.
 */
export async function buildTopItems(tenantId, filters, limit = 10) {
  const lines = await OrderItem.findAll({
    where: { tenant_id: tenantId },
    include: [
      { model: Order, as: 'Order', attributes: ['payment_status'], where: analyticsOrderWhere(tenantId, filters) },
    ],
    attributes: ['item_name', 'quantity', 'line_total'],
    limit: 5000,
  });
  const byName = new Map();
  for (const line of lines) {
    if (line.Order?.payment_status !== 'paid') continue;
    const key = line.item_name || 'Unknown';
    const entry = byName.get(key) || { name: key, quantity: 0, revenue: 0 };
    entry.quantity += Number(line.quantity) || 0;
    entry.revenue += Number(line.line_total) || 0;
    byName.set(key, entry);
  }
  return {
    filters: serializeFilters(filters),
    topItems: [...byName.values()]
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, limit)
      .map((t) => ({ ...t, revenue: round2(t.revenue) })),
    generatedAt: new Date().toISOString(),
  };
}

const PEAK_DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PEAK_HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * Day-of-week × hour heatmap of order volume + paid revenue, bucketed in
 * the filter's timezone (the dashboard's Dhaka grid generalized).
 */
export async function buildPeakHours(tenantId, filters) {
  const orders = await Order.findAll({
    where: analyticsOrderWhere(tenantId, filters),
    attributes: ['grand_total', 'payment_status', 'createdAt'],
  });

  // Per-day UTC offset at each instant (DST-safe): compute the wall-clock
  // day/hour via Intl parts instead of a fixed shift.
  const grid = PEAK_DAY_LABELS.map(() => PEAK_HOURS.map(() => ({ orders: 0, revenue: 0 })));
  let maxOrders = 0;
  let maxRevenue = 0;
  for (const o of orders) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: filters.timezone,
      weekday: 'short',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(new Date(o.createdAt));
    const weekday = parts.find((p) => p.type === 'weekday')?.value;
    const hourStr = parts.find((p) => p.type === 'hour')?.value;
    const day = PEAK_DAY_LABELS.indexOf(weekday);
    const hour = Number(hourStr) % 24; // '24' from h24 formatting → 0
    if (day < 0 || !Number.isInteger(hour)) continue;
    const cell = grid[day][hour];
    cell.orders += 1;
    if (o.payment_status === 'paid') cell.revenue += Number(o.grand_total || 0);
    if (cell.orders > maxOrders) maxOrders = cell.orders;
    if (cell.revenue > maxRevenue) maxRevenue = cell.revenue;
  }

  let busiest = null;
  for (let day = 0; day < 7; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const cell = grid[day][hour];
      if (!cell.revenue && !cell.orders) continue;
      if (!busiest || cell.revenue > busiest.revenue || (cell.revenue === busiest.revenue && cell.orders > busiest.orders)) {
        busiest = { day, hour, ...cell };
      }
    }
  }

  return {
    filters: serializeFilters(filters),
    days: PEAK_DAY_LABELS,
    hours: PEAK_HOURS,
    grid: grid.flatMap((row, day) =>
      row.map((cell, hour) => ({ day, hour, orders: cell.orders, revenue: round2(cell.revenue) }))
    ),
    maxOrders,
    maxRevenue: round2(maxRevenue),
    busiest: busiest ? { ...busiest, revenue: round2(busiest.revenue) } : null,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Customer retention over the window (phone = customer identity), mirroring
 * the dashboard's retention section but on the custom range. Phones are
 * masked in the payload.
 */
export async function buildRetention(tenantId, filters) {
  const orders = await Order.findAll({
    where: analyticsOrderWhere(tenantId, filters, {
      customer_phone: { [Op.not]: null },
      status: { [Op.ne]: 'canceled' },
    }),
    attributes: ['customer_phone', 'grand_total'],
  });

  const byPhone = new Map();
  for (const o of orders) {
    const entry = byPhone.get(o.customer_phone) || { orders: 0, revenue: 0 };
    entry.orders += 1;
    entry.revenue += Number(o.grand_total || 0);
    byPhone.set(o.customer_phone, entry);
  }
  const customers = [...byPhone.entries()];
  const repeatCustomers = customers.filter(([, e]) => e.orders >= 2).length;
  const totalRevenue = customers.reduce((s, [, e]) => s + e.revenue, 0);
  const totalOrders = customers.reduce((s, [, e]) => s + e.orders, 0);

  return {
    filters: serializeFilters(filters),
    retention: {
      from: filters.from,
      to: filters.to,
      totalCustomers: customers.length,
      repeatCustomers,
      repeatRate: safePct(repeatCustomers, customers.length),
      avgOrderValue: totalOrders > 0 ? round2(totalRevenue / totalOrders) : 0,
      topCustomers: customers
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 5)
        .map(([phone, e]) => ({
          phone: phone.replace(/^(\d{4})\d+(\d{2})$/, '$1••••$2'),
          orders: e.orders,
          revenue: round2(e.revenue),
        })),
    },
    generatedAt: new Date().toISOString(),
  };
}

// ── Funnel (Browse → Cart → Checkout → Paid) ───────────────────────────────

export const FUNNEL_STAGES = [
  { key: 'browse', label: 'Browse', event: 'menu_view' },
  { key: 'cart', label: 'Cart', event: 'add_to_cart' },
  { key: 'checkout', label: 'Checkout', event: 'checkout_start' },
];

/**
 * Conversion funnel over distinct sessions — one entity end to end:
 *   Browse/Cart/Checkout come from analytics_events (storefront journey),
 *   Paid comes from paid orders tied to their session via
 *   orders.analytics_session (legacy/null-session orders each count once).
 *
 * Filter semantics (documented limitations):
 *   • Events exist only for the storefront channel — channel=pos yields an
 *     empty funnel; channel=storefront/all behave identically upstream.
 *   • order_type can only apply to the Paid stage (earlier stages have no
 *     order yet).
 */
export async function buildFunnel(tenantId, filters) {
  const sessionsByStage = new Map(FUNNEL_STAGES.map((s) => [s.key, new Set()]));
  let paidSessions = new Set();

  // Events exist only for the storefront journey — channel=pos yields an
  // empty funnel by definition.
  if (filters.channel !== 'pos') {
    const events = await AnalyticsEvent.findAll({
      where: {
        tenant_id: tenantId,
        created_at: { [Op.gte]: filters.startUtc, [Op.lt]: filters.endUtc },
      },
      attributes: ['session_id', 'event_type'],
    });
    for (const e of events) {
      const stage = FUNNEL_STAGES.find((s) => s.event === e.event_type);
      if (stage) sessionsByStage.get(stage.key).add(e.session_id);
    }

    // Paid stage: only orders attributable to a journey (analytics_session
    // present). POS/legacy orders never browsed — counting them as "paid
    // sessions" would inflate conversion above 100%.
    const paidOrders = await Order.findAll({
      where: analyticsOrderWhere(tenantId, filters, {
        payment_status: 'paid',
        analytics_session: { [Op.not]: null },
      }),
      attributes: ['analytics_session'],
    });
    paidSessions = new Set(paidOrders.map((o) => `s:${o.analytics_session}`));
  }

  const counts = {
    browse: sessionsByStage.get('browse').size,
    cart: sessionsByStage.get('cart').size,
    checkout: sessionsByStage.get('checkout').size,
    paid: paidSessions.size,
  };

  const stages = [
    ...FUNNEL_STAGES.map((s) => ({ key: s.key, label: s.label, count: counts[s.key] })),
    { key: 'paid', label: 'Paid', count: counts.paid },
  ];

  return {
    filters: serializeFilters(filters),
    entity: 'distinct sessions',
    stages,
    conversions: {
      browseToCart: safePct(counts.cart, counts.browse),
      cartToCheckout: safePct(counts.checkout, counts.cart),
      checkoutToPaid: safePct(counts.paid, counts.checkout),
      browseToPaid: safePct(counts.paid, counts.browse),
    },
    generatedAt: new Date().toISOString(),
  };
}

// ── Rider performance ──────────────────────────────────────────────────────

const DELIVERY_TYPES = ['delivery', 'scheduled_delivery'];

/**
 * Per-rider delivery performance for the window.
 *
 * Definitions (documented approximations — the schema has no dedicated
 * delivered_at/promised_at columns):
 *   deliveredAt ≈ updatedAt of the delivered order row (the last status
 *     write — the same approximation the dashboard fulfillment section uses).
 *   deliveryTime = deliveredAt − createdAt (placement → doorstep).
 *   promisedAt   = scheduled_at when present, else createdAt + SLA minutes
 *     (settings.analytics.deliverySlaMinutes, default 60).
 *   onTime       = deliveredAt ≤ promisedAt.
 * Canceled/incomplete/negative-duration rows are excluded from time metrics;
 * canceled deliveries are counted separately per rider.
 */
export async function buildRiderPerformance(tenant, filters, sort = 'deliveries') {
  const slaRaw = Number(tenant?.settings?.analytics?.deliverySlaMinutes);
  const slaMinutes = Number.isFinite(slaRaw) && slaRaw > 0 ? slaRaw : 60;

  const [members, orders] = await Promise.all([
    UserTenant.findAll({
      where: { tenant_id: tenant.id, role: 'delivery' },
      include: [{ model: User, attributes: ['id', 'name'] }],
    }),
    Order.findAll({
      where: analyticsOrderWhere(
        tenant.id,
        filters,
        {
          assigned_to: { [Op.not]: null },
          status: { [Op.in]: ['delivered', 'canceled'] },
        }
      ),
      attributes: ['assigned_to', 'status', 'type', 'createdAt', 'updatedAt', 'scheduled_at'],
    }),
  ]);

  const nameByRider = new Map(
    members.map((m) => [m.user_id, m.User?.name || `Rider #${m.user_id}`])
  );

  const byRider = new Map();
  const riderEntry = (id) => {
    if (!byRider.has(id)) {
      byRider.set(id, {
        riderId: id,
        rider: nameByRider.get(id) || `User #${id}`,
        deliveries: 0,
        durationMsTotal: 0,
        onTime: 0,
        late: 0,
        canceled: 0,
      });
    }
    return byRider.get(id);
  };

  for (const o of orders) {
    const entry = riderEntry(Number(o.assigned_to));
    if (o.status === 'canceled') {
      entry.canceled += 1;
      continue;
    }
    const deliveredMs = new Date(o.updatedAt).getTime();
    const placedMs = new Date(o.createdAt).getTime();
    const durationMs = deliveredMs - placedMs;
    if (!Number.isFinite(durationMs) || durationMs < 0) continue; // clock skew
    entry.deliveries += 1;
    entry.durationMsTotal += durationMs;
    const promisedMs = o.scheduled_at
      ? new Date(o.scheduled_at).getTime()
      : placedMs + slaMinutes * 60000;
    if (deliveredMs <= promisedMs) entry.onTime += 1;
    else entry.late += 1;
  }

  const sorters = {
    deliveries: (a, b) => b.deliveries - a.deliveries,
    avg: (a, b) => avgMin(b) - avgMin(a),
    onTimeRate: (a, b) => rate(b) - rate(a),
    late: (a, b) => b.late - a.late,
  };
  const avgMin = (e) => (e.deliveries > 0 ? e.durationMsTotal / e.deliveries / 60000 : 0);
  const rate = (e) => (e.deliveries > 0 ? (e.onTime / e.deliveries) * 100 : 0);

  const riders = [...byRider.values()]
    .sort((a, b) => {
      const cmp = sorters[sort] ? sorters[sort](a, b) : sorters.deliveries(a, b);
      return cmp !== 0 ? cmp : a.rider.localeCompare(b.rider);
    })
    .map((e) => ({
      riderId: e.riderId,
      rider: e.rider,
      deliveries: e.deliveries,
      avgDeliveryMinutes: e.deliveries > 0 ? round1(avgMin(e)) : null,
      onTimeDeliveries: e.onTime,
      lateDeliveries: e.late,
      onTimeRate: e.deliveries > 0 ? round1(rate(e)) : null,
      canceledDeliveries: e.canceled,
    }));

  const completed = riders.reduce((s, r) => s + r.deliveries, 0);
  const onTimeTotal = riders.reduce((s, r) => s + r.onTimeDeliveries, 0);
  const durationTotal = riders.reduce((s, r) => s + (r.avgDeliveryMinutes || 0) * r.deliveries, 0);

  return {
    filters: serializeFilters(filters),
    definitions: {
      deliveryTime: 'deliveredAt(approximated by updatedAt) − createdAt',
      onTime: 'delivered ≤ promised (scheduled_at, else createdAt + SLA minutes)',
      slaMinutes,
    },
    totals: {
      riders: riders.length,
      deliveries: completed,
      avgDeliveryMinutes: completed > 0 ? round1(durationTotal / completed) : null,
      onTimeRate: safePct(onTimeTotal, completed),
    },
    riders,
    generatedAt: new Date().toISOString(),
  };
}

// ── Revenue anomaly detection ──────────────────────────────────────────────

const ANOMALY_ACTION = 'analytics.revenue_anomaly';
const ANOMALY_DEFAULTS = { dropPct: 20, spikePct: 30, minBaselineOrders: 10, cooldownHours: 24 };

/** Thresholds/cooldown from settings.analytics.anomalies (server-side config). */
export function anomalyConfig(tenant) {
  const cfg = tenant?.settings?.analytics?.anomalies || {};
  const num = (v, fallback, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  return {
    dropPct: num(cfg.dropPct, ANOMALY_DEFAULTS.dropPct, 1, 100),
    spikePct: num(cfg.spikePct, ANOMALY_DEFAULTS.spikePct, 1, 1000),
    minBaselineOrders: num(cfg.minBaselineOrders, ANOMALY_DEFAULTS.minBaselineOrders, 1, 100000),
    cooldownHours: num(cfg.cooldownHours, ANOMALY_DEFAULTS.cooldownHours, 0, 24 * 30),
  };
}

const paidRevenueOf = (orders) =>
  orders.reduce((s, o) => s + (o.payment_status === 'paid' ? Number(o.grand_total || 0) : 0), 0);

/**
 * Baseline-based anomaly detection: current window vs the immediately
 * preceding window of equal length. Segments: overall + per channel (no
 * combinatorial explosion — order_type is not segmented).
 *
 * Guards: minimum baseline sample (orders), configurable drop/spike
 * thresholds, and a persisted-alert cooldown so dashboard refreshes never
 * spam duplicates. Alerts reuse the append-only AuditLog store.
 */
export async function evaluateRevenueAnomalies({ tenant, filters }) {
  const cfg = anomalyConfig(tenant);
  const spanMs = filters.endUtc.getTime() - filters.startUtc.getTime();
  const baselineStart = new Date(filters.startUtc.getTime() - spanMs);
  const baselineEnd = filters.startUtc;

  const segments = [{ key: 'all', channel: null }];
  if (!filters.channel) {
    for (const c of CHANNELS) segments.push({ key: c, channel: c });
  } else {
    segments.push({ key: filters.channel, channel: filters.channel });
  }

  const results = [];
  for (const segment of segments) {
    const where = (start, end) => ({
      tenant_id: tenant.id,
      createdAt: { [Op.gte]: start, [Op.lt]: end },
      ...(segment.channel ? { channel: segment.channel } : {}),
    });
    const [currentOrders, baselineOrders] = await Promise.all([
      Order.findAll({ where: where(filters.startUtc, filters.endUtc), attributes: ['grand_total', 'payment_status'] }),
      Order.findAll({ where: where(baselineStart, baselineEnd), attributes: ['grand_total', 'payment_status'] }),
    ]);

    const currentRevenue = round2(paidRevenueOf(currentOrders));
    const baselineRevenue = round2(paidRevenueOf(baselineOrders));
    const baselineCount = baselineOrders.length;

    const evaluation = {
      segment: segment.key,
      channel: segment.channel || 'all',
      currentValue: currentRevenue,
      baselineValue: baselineRevenue,
      baselineOrders: baselineCount,
      percentageDeviation: baselineRevenue > 0 ? round1(((currentRevenue - baselineRevenue) / baselineRevenue) * 100) : null,
      alertType: null,
      suppressed: false,
    };

    // Minimum-sample guard — tiny baselines must not generate alerts.
    if (baselineRevenue > 0 && baselineCount >= cfg.minBaselineOrders) {
      if (evaluation.percentageDeviation <= -cfg.dropPct) evaluation.alertType = 'revenue_drop';
      else if (evaluation.percentageDeviation >= cfg.spikePct) evaluation.alertType = 'revenue_spike';
    }

    if (evaluation.alertType) {
      evaluation.suppressed = !(await persistAnomalyAlert({ tenant, cfg, evaluation, filters }));
    }
    results.push(evaluation);
  }

  return {
    filters: serializeFilters(filters),
    methodology: {
      baseline: 'previous equivalent period',
      thresholds: { dropPct: cfg.dropPct, spikePct: cfg.spikePct },
      minBaselineOrders: cfg.minBaselineOrders,
      cooldownHours: cfg.cooldownHours,
    },
    evaluatedAt: new Date().toISOString(),
    segments: results,
  };
}

/** Creates the alert unless one for the same type+segment fired within the cooldown. */
async function persistAnomalyAlert({ tenant, cfg, evaluation, filters }) {
  const since = new Date(Date.now() - cfg.cooldownHours * 3600000);
  const recent = await AuditLog.findAll({
    where: {
      tenant_id: tenant.id,
      action: ANOMALY_ACTION,
      created_at: { [Op.gte]: since },
    },
    order: [['id', 'DESC']],
    limit: 100,
  });
  const duplicate = recent.some(
    (r) => r.metadata?.alertType === evaluation.alertType && r.metadata?.segment === evaluation.segment
  );
  if (duplicate) return false;

  await AuditLog.create({
    tenant_id: tenant.id,
    actor_id: null,
    action: ANOMALY_ACTION,
    entity_type: 'analytics',
    entity_id: String(evaluation.segment),
    metadata: {
      alertType: evaluation.alertType,
      metric: 'revenue',
      segment: evaluation.segment,
      currentValue: evaluation.currentValue,
      baselineValue: evaluation.baselineValue,
      percentageDeviation: evaluation.percentageDeviation,
      from: filters.from,
      to: filters.to,
      channel: evaluation.channel,
      orderType: filters.orderType || 'all',
      detectedAt: new Date().toISOString(),
    },
  });
  return true;
}

/** Recent persisted anomaly alerts (the analytics alert feed). */
export async function listAnomalies(tenantId, limit = 20) {
  const rows = await AuditLog.findAll({
    where: { tenant_id: tenantId, action: ANOMALY_ACTION },
    order: [['id', 'DESC']],
    limit: Math.min(Math.max(limit, 1), 100),
  });
  return rows.map((r) => ({
    id: r.id,
    alertType: r.metadata?.alertType || 'revenue_anomaly',
    metric: r.metadata?.metric || 'revenue',
    segment: r.metadata?.segment || 'all',
    currentValue: r.metadata?.currentValue ?? null,
    baselineValue: r.metadata?.baselineValue ?? null,
    percentageDeviation: r.metadata?.percentageDeviation ?? null,
    from: r.metadata?.from || null,
    to: r.metadata?.to || null,
    channel: r.metadata?.channel || 'all',
    orderType: r.metadata?.orderType || 'all',
    detectedAt: r.created_at,
  }));
}

// ── CSV export (every chart) ───────────────────────────────────────────────

const csvRow = (cells) => cells.map(csvCell).join(',');
const csvDoc = (rows) => rows.map(csvRow).join('\r\n');

/**
 * Renders one chart's data as a CSV document (UTF-8, escaped via the shared
 * csvCell util, stable column order). `type` selects the dataset; every
 * analytics visualization has a mapping here.
 */
export function buildAnalyticsCsv(type, payload) {
  switch (type) {
    case 'revenue':
      return csvDoc([
        ['Date', 'Revenue', 'Orders'],
        ...payload.series.map((d) => [d.date, d.revenue.toFixed(2), d.orders]),
      ]);
    case 'methods':
      return csvDoc([
        ['Method', 'Amount', 'Count'],
        ...payload.methodMix.map((m) => [m.method, m.amount.toFixed(2), m.count]),
      ]);
    case 'categories':
      return csvDoc([
        ['Category', 'Revenue', 'Quantity', 'Share %'],
        ...payload.categoryMix.map((c) => [c.name, c.revenue.toFixed(2), c.quantity, c.pct]),
      ]);
    case 'status':
      return csvDoc([
        ['Status', 'Count'],
        ...payload.statusBreakdown.map((s) => [s.status, s.count]),
      ]);
    case 'top-items':
      return csvDoc([
        ['Item', 'Quantity', 'Revenue'],
        ...payload.topItems.map((i) => [i.name, i.quantity, i.revenue.toFixed(2)]),
      ]);
    case 'peak-hours':
      return csvDoc([
        ['Day', 'Hour', 'Orders', 'Revenue'],
        ...payload.grid.map((c) => [payload.days[c.day], String(c.hour).padStart(2, '0'), c.orders, c.revenue.toFixed(2)]),
      ]);
    case 'retention':
      return csvDoc([
        ['Customer', 'Orders', 'Revenue'],
        ...payload.retention.topCustomers.map((c) => [c.phone, c.orders, c.revenue.toFixed(2)]),
      ]);
    case 'funnel':
      return csvDoc([
        ['Stage', 'Count', 'Conversion Rate %'],
        ...payload.stages.map((s, i) => {
          const prev = i > 0 ? payload.stages[i - 1].count : null;
          const conv = i > 0 ? safePct(s.count, prev) : '';
          return [s.label, s.count, conv];
        }),
      ]);
    case 'riders':
      return csvDoc([
        ['Rider', 'Deliveries', 'Average Delivery Time (min)', 'On-Time Deliveries', 'Late Deliveries', 'On-Time Rate %', 'Canceled Deliveries'],
        ...payload.riders.map((r) => [
          r.rider,
          r.deliveries,
          r.avgDeliveryMinutes ?? '',
          r.onTimeDeliveries,
          r.lateDeliveries,
          r.onTimeRate ?? '',
          r.canceledDeliveries,
        ]),
      ]);
    case 'anomalies':
      return csvDoc([
        ['Type', 'Segment', 'Current Revenue', 'Baseline Revenue', 'Deviation %', 'From', 'To', 'Detected At'],
        ...payload.alerts.map((a) => [
          a.alertType,
          a.segment,
          a.currentValue ?? '',
          a.baselineValue ?? '',
          a.percentageDeviation ?? '',
          a.from || '',
          a.to || '',
          a.detectedAt,
        ]),
      ]);
    default:
      throw new AppError(400, 'VALIDATION_ERROR', `Unknown export type: ${type}`);
  }
}

export const CSV_TYPES = [
  'revenue',
  'methods',
  'categories',
  'status',
  'top-items',
  'peak-hours',
  'retention',
  'funnel',
  'riders',
  'anomalies',
];

/** Standard export filename: <type>-analytics-<from>-to-<to>.csv */
export const csvFilename = (type, filters) => `${type}-analytics-${filters.from}-to-${filters.to}.csv`;
