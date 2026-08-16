import { AppError } from '../middleware/errorHandler.js';
import {
  Tenant,
  Plan,
  Subscription,
  Product,
  UserTenant,
  UsageCounter,
} from '../models/index.js';
import { sendQuotaWebhook } from './whatsappService.js';
import { sendQuotaAlertEmail } from './notifications/quotaAlert.js';

/**
 * Plan quota enforcement (Phase 3 hardening).
 *
 * The SaaS quota layer sits between the (existing, unused) plans /
 * subscriptions / usage_counters tables and the business routes:
 *
 *   - plans carry quota columns (products, orders/day, members, storage)
 *   - orders/day + storage are counted through usage_counters (atomic
 *     findOrCreate+increment; orders reset per calendar day via period_start,
 *     storage uses a sentinel lifetime period)
 *   - products/members are counted live (COUNT with the tenant index)
 *
 * Routes call assertQuota BEFORE the mutation and incrementUsage AFTER it, so
 * a failed request never consumes quota and a successful one always does.
 * Violations surface as 429 QUOTA_EXCEEDED with current/limit numbers so the
 * UI can show exactly what ran out.
 */

// Lifetime counters (storage bytes) use a sentinel period_start because the
// usage_counters unique index requires one; orders use the real calendar day.
export const LIFETIME_PERIOD = '0001-01-01';

const today = () => new Date().toISOString().slice(0, 10);

const FREE_FALLBACK = { max_products: 20, max_orders_per_day: 50, max_members: 2, storage_mb: 100 };

/** Loads the tenant's plan + subscription (free-plan fallback when unset). */
export async function getPlanForTenant(tenantId) {
  const tenant = await Tenant.findByPk(tenantId, {
    include: [{ model: Plan, as: 'plan' }],
  });
  if (!tenant) throw new AppError(404, 'TENANT_NOT_FOUND', 'Workspace not found');
  const subscription = await Subscription.findOne({
    where: { tenant_id: tenantId },
    order: [['id', 'DESC']],
  });
  let plan = tenant.plan;
  if (!plan) {
    plan = await Plan.findOne({ where: { code: 'free' } });
  }
  return { tenant, subscription, plan };
}

/** Named limits for a plan, with safe defaults when columns are absent. */
export function planLimits(plan) {
  if (!plan) return { ...FREE_FALLBACK };
  return {
    products: Number(plan.max_products ?? FREE_FALLBACK.max_products),
    ordersPerDay: Number(plan.max_orders_per_day ?? FREE_FALLBACK.max_orders_per_day),
    members: Number(plan.max_members ?? FREE_FALLBACK.max_members),
    storageMb: Number(plan.storage_mb ?? FREE_FALLBACK.storage_mb),
  };
}

/**
 * Current usage across all counted metrics. products/members are live COUNTs
 * (soft-deleted rows excluded automatically); ordersToday + storageBytes come
 * from the usage counters.
 */
export async function countUsage(tenantId) {
  const [products, members] = await Promise.all([
    Product.count({ where: { tenant_id: tenantId } }),
    UserTenant.count({ where: { tenant_id: tenantId } }),
  ]);

  let ordersToday = 0;
  const orderRow = await UsageCounter.findOne({
    where: { tenant_id: tenantId, metric: 'orders_daily', period_start: today() },
  });
  if (orderRow) ordersToday = Number(orderRow.value);

  let storageBytes = 0;
  const storageRow = await UsageCounter.findOne({
    where: { tenant_id: tenantId, metric: 'storage_bytes', period_start: LIFETIME_PERIOD },
  });
  if (storageRow) storageBytes = Number(storageRow.value);

  return { products, members, ordersToday, storageBytes };
}

/**
 * Full plan + usage snapshot for the Settings UI: the plan, the subscription
 * state, the limits, and the current usage per metric.
 */
export async function getPlanUsage(tenantId) {
  const { subscription, plan } = await getPlanForTenant(tenantId);
  const usage = await countUsage(tenantId);
  const limits = planLimits(plan);
  return {
    plan: plan
      ? {
          id: plan.id,
          name: plan.name,
          code: plan.code,
          priceMo: Number(plan.price_mo || 0),
        }
      : null,
    subscription: subscription
      ? {
          status: subscription.status,
          trialEndsAt: subscription.trial_ends_at ?? null,
          currentPeriodEnd: subscription.current_period_end ?? null,
        }
      : null,
    limits,
    usage: {
      products: usage.products,
      members: usage.members,
      ordersToday: usage.ordersToday,
      storageMb: Math.round((usage.storageBytes / (1024 * 1024)) * 100) / 100,
    },
  };
}

/**
 * Throws 429 QUOTA_EXCEEDED when a mutation would exceed the plan's limit for
 * `metric` ('products' | 'members' | 'orders_daily' | 'storage_bytes').
 * `adding` accounts for batch operations (imports, bulk uploads) so the check
 * covers the *resulting* count, not just the current one.
 */
export async function assertQuota(tenantId, metric, { adding = 0 } = {}) {
  const { plan } = await getPlanForTenant(tenantId);
  const limits = planLimits(plan);
  const usage = await countUsage(tenantId);

  const limitOf = {
    products: limits.products,
    members: limits.members,
    orders_daily: limits.ordersPerDay,
    storage_bytes: limits.storageMb * 1024 * 1024,
  };
  const limit = limitOf[metric];
  // Metric names use DB-style keys; usage uses camelCase — map across.
  const usageKey = {
    products: 'products',
    members: 'members',
    orders_daily: 'ordersToday',
    storage_bytes: 'storageBytes',
  }[metric];
  const current = usage[usageKey] ?? 0;
  if (limit == null) return;

  if (current + adding >= limit) {
    const label = metric === 'storage_bytes'
      ? `${Math.round((current + adding) / (1024 * 1024))}/${limits.storageMb} MB`
      : `${current + adding}/${limit}`;
    throw new AppError(
      429,
      'QUOTA_EXCEEDED',
      `Plan limit reached: ${metric} at ${label}`
    );
  }
  return { current, limit };
}

/** Atomically bumps a usage counter (orders per day, storage bytes). */
export async function incrementUsage(tenantId, metric, by = 1, periodStart = today()) {
  const [row] = await UsageCounter.findOrCreate({
    where: { tenant_id: tenantId, metric, period_start: periodStart },
    defaults: { value: 0 },
  });
  row.value = Number(row.value) + by;
  await row.save();
  return row;
}

// ── Quota alerting (Phase 3) ───────────────────────────────────────────────

// Percentage levels at which the owner is alerted, per metric per day.
export const QUOTA_ALERT_THRESHOLDS = [80, 90, 100];

/**
 * Fire-and-forget quota alerts: after a write, recompute usage vs limits and
 * notify the owner (WhatsApp webhook + email) when a metric crosses an
 * un-stamped threshold. Each (metric, threshold) fires once per calendar day
 * — the stamp lives in `tenant.settings.quotaAlerts`. Never rejects.
 */
export async function notifyQuotaIfCrossed(tenantId) {
  try {
    const { tenant, plan } = await getPlanForTenant(tenantId);
    const limits = planLimits(plan);
    const usage = await countUsage(tenantId);
    const metrics = [
      { metric: 'products', label: 'menu items', used: usage.products, limit: limits.products },
      { metric: 'orders_today', label: 'orders today', used: usage.ordersToday, limit: limits.ordersPerDay },
      { metric: 'members', label: 'team members', used: usage.members, limit: limits.members },
      { metric: 'storage', label: 'storage', used: Math.round((usage.storageBytes / (1024 * 1024)) * 100) / 100, limit: limits.storageMb },
    ];

    const stamped = { ...(tenant.settings?.quotaAlerts || {}) };
    const day = today();
    const alerts = [];
    for (const m of metrics) {
      if (!m.limit || m.limit <= 0) continue;
      const pct = Math.round((m.used / m.limit) * 100);
      // Highest threshold crossed that hasn't been stamped for this day. Only
      // the topmost un-stamped one fires, and stamping it covers every lower
      // threshold too — otherwise a jump from 70% to 100% would cascade
      // 100 → 90 → 80 alerts over the following days.
      const crossed = QUOTA_ALERT_THRESHOLDS
        .filter((t) => pct >= t)
        .sort((a, b) => b - a)
        .find((t) => stamped[`${m.metric}:${t}`] !== day);
      if (!crossed) continue;
      for (const t of QUOTA_ALERT_THRESHOLDS.filter((x) => x <= crossed)) {
        stamped[`${m.metric}:${t}`] = day;
      }
      const unit = m.metric === 'storage' ? 'MB' : '';
      alerts.push({
        metric: m.metric,
        used: m.used,
        limit: m.limit,
        percent: pct,
        label: m.label,
        message: `Plan alert: ${m.label} at ${pct}% (${m.used}${unit ? ` ${unit}` : ''}/${m.limit}${unit ? ` ${unit}` : ''}) — upgrade to keep going.`,
      });
    }
    if (alerts.length === 0) return [];

    // Stamp first (idempotent even if a send below fails).
    await tenant.update({ settings: { ...(tenant.settings || {}), quotaAlerts: stamped } });

    for (const alert of alerts) {
      void sendQuotaWebhook(tenant, alert);
      void sendQuotaAlertEmail({ tenant, alert });
    }
    return alerts;
  } catch (err) {
    // Alerting must never break the request that triggered it.
    console.warn(`[quota-alert] failed for tenant ${tenantId}: ${err.message}`);
    return [];
  }
}
