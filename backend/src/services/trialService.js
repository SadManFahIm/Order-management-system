import { Op } from 'sequelize';
import { Tenant, Plan, Subscription } from '../models/index.js';
import { audit } from './auditService.js';
import { sendQuotaWebhook } from './whatsappService.js';
import { sendUpgradeNudgeEmail } from './notifications/upgradeNudge.js';

/**
 * Trial-expiry sweep (Phase 3).
 *
 * Subscriptions in `trialing` whose trial window has passed are moved onto
 * the Free plan (tenant.plan_id + subscription row), audited as
 * `tenant.trial_expired`, and the owners get a ticket-styled upgrade nudge
 * email + WhatsApp webhook push. Idempotent: once the subscription is no
 * longer `trialing` it can never fire again.
 */
export async function runTrialExpirySweep(now = new Date()) {
  const expired = await Subscription.findAll({
    where: { status: 'trialing', trial_ends_at: { [Op.lt]: now } },
    include: [{ model: Tenant }],
  });

  let downgraded = 0;
  for (const sub of expired) {
    const tenant = sub.Tenant;
    if (!tenant || !['active', 'trial'].includes(tenant.status)) continue;

    // Idempotency guard under concurrency: only one sweep may downgrade.
    const [lock] = await Subscription.update(
      { status: 'expired' },
      { where: { id: sub.id, status: 'trialing' } }
    );
    if (!lock) continue;

    try {
      const free = await Plan.findOne({ where: { code: 'free' } });
      const fromPlan = free ? await Plan.findByPk(sub.plan_id) : null;
      await tenant.update({ plan_id: free?.id ?? tenant.plan_id });
      if (free) await sub.update({ plan_id: free.id });

      await audit({
        action: 'tenant.trial_expired',
        actorId: null,
        tenantId: tenant.id,
        entityType: 'Tenant',
        entityId: tenant.id,
        metadata: { fromPlan: fromPlan?.code ?? null, toPlan: 'free' },
      });

      downgraded += 1;
      console.log(`[trial] ${tenant.name} (#${tenant.id}) trial ended → Free`);

      const nudge = {
        metric: 'trial',
        used: 0,
        limit: 0,
        percent: 100,
        label: 'trial',
        message: `Trial ended: ${tenant.name} is now on the Free plan. Upgrade to lift the limits.`,
      };
      void sendQuotaWebhook(tenant, nudge);
      void sendUpgradeNudgeEmail({
        tenant,
        planName: fromPlan?.name ?? null,
        trialEndedAt: sub.trial_ends_at,
      });
    } catch (e) {
      console.error(`[trial] downgrade failed for tenant ${tenant.id}: ${e.message}`);
    }
  }
  return downgraded;
}

/** Starts a per-minute sweep; `unref()` keeps it from holding the process open. */
export function startTrialExpirySweeper({ intervalMs = 60_000 } = {}) {
  const timer = setInterval(() => {
    runTrialExpirySweep().catch((e) =>
      console.error(`[trial] sweep tick failed: ${e.message}`)
    );
  }, intervalMs);
  timer.unref?.();
  console.log(`[trial] expiry sweeper started (every ${intervalMs}ms)`);
  return timer;
}
