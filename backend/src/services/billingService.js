import { createHmac } from 'node:crypto';
import { env } from '../config/env.js';
import { Tenant } from '../models/index.js';
import { getPlanForTenant, planLimits, countUsage } from './planService.js';

/**
 * Usage-based billing meter (Phase 3 follow-ups).
 *
 * A SaaS metering shim: on a schedule (default every 6h), every active
 * tenant's current plan + live usage snapshot is POSTed to the configured
 * billing webhook so an external billing system (Stripe usage records,
 * Chargebee, an internal ledger…) can meter by real consumption instead of
 * just the plan tier. Each request carries an HMAC-SHA256 signature over
 * the body when BILLING_WEBHOOK_SECRET is set, and the payload includes a
 * monotonic period key so consumers can dedupe. The reporter never rejects
 * and is a no-op when BILLING_WEBHOOK_URL is unset.
 */

/** Full meter snapshot for one tenant — the shape a billing consumer wants. */
export async function getBillingMeter(tenantId) {
  const { tenant, subscription, plan } = await getPlanForTenant(tenantId);
  const limits = planLimits(plan);
  const usage = await countUsage(tenantId);
  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    plan: plan?.code || 'free',
    planName: plan?.name || 'Free',
    priceMo: Number(plan?.price_mo || 0),
    subscriptionStatus: subscription?.status || null,
    periodEnd: subscription?.current_period_end || null,
    trialEndsAt: subscription?.trial_ends_at || null,
    usage: {
      products: usage.products,
      ordersToday: usage.ordersToday,
      members: usage.members,
      storageMb: Math.round((usage.storageBytes / (1024 * 1024)) * 100) / 100,
    },
    limits: {
      products: limits.products,
      ordersPerDay: limits.ordersPerDay,
      members: limits.members,
      storageMb: limits.storageMb,
    },
    // Monotonic period key (UTC date) so a consumer can dedupe/aggregate.
    period: new Date().toISOString().slice(0, 10),
    reportedAt: new Date().toISOString(),
  };
}

/**
 * Posts one tenant's meter snapshot to the billing webhook.
 * Returns { sent, reason } — never throws.
 */
// Read live from process.env (dotenv has already populated it) so tests can
// override the webhook per-run; env.* is the validated boot-time default.
const billingUrl = () => process.env.BILLING_WEBHOOK_URL || env.BILLING_WEBHOOK_URL;
const billingSecret = () => process.env.BILLING_WEBHOOK_SECRET || env.BILLING_WEBHOOK_SECRET;

export async function reportTenantMeter(tenantId) {
  const url = billingUrl();
  if (!url) return { sent: false, reason: 'disabled' };

  const payload = { event: 'billing.usage_snapshot', ...(await getBillingMeter(tenantId)) };
  const body = JSON.stringify(payload);
  const signature = billingSecret()
    ? createHmac('sha256', billingSecret()).update(body).digest('hex')
    : null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signature ? { 'X-Billing-Signature': signature } : {}),
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[billing] webhook responded ${res.status}`);
      return { sent: false, reason: `http-${res.status}` };
    }
    return { sent: true, signature: Boolean(signature) };
  } catch (err) {
    console.warn(`[billing] webhook failed: ${err?.message || 'unknown'}`);
    return { sent: false, reason: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

/** Reports every active tenant in one pass; returns per-tenant results. */
export async function reportAllTenantMeters() {
  const tenants = await Tenant.findAll({
    where: { status: ['active', 'trial'] },
    attributes: ['id'],
  });
  const results = [];
  for (const tenant of tenants) {
    const r = await reportTenantMeter(tenant.id);
    results.push({ tenantId: tenant.id, ...r });
  }
  return results;
}

/** Starts the scheduled reporter; `unref()` keeps it from holding the process open. */
export function startBillingReporter({ intervalMs = env.BILLING_REPORT_INTERVAL_MS } = {}) {
  if (!billingUrl()) {
    console.log('[billing] meter reporter disabled (BILLING_WEBHOOK_URL unset)');
    return null;
  }
  const timer = setInterval(() => {
    reportAllTenantMeters().catch((e) =>
      console.error(`[billing] report tick failed: ${e.message}`)
    );
  }, intervalMs);
  timer.unref?.();
  console.log(`[billing] meter reporter started (every ${intervalMs}ms)`);
  return timer;
}
