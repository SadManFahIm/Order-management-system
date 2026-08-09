import { Op } from 'sequelize';
import Tenant from '../models/Tenant.js';
import { DHAKA_OFFSET_MS, dhakaDate, sendNightlyDigest } from './reportsService.js';
import { sendDigestWebhook } from './whatsappService.js';

/**
 * Nightly merchant digest scheduler (Phase 6) — for each active workspace
 * with `settings.reports.autoSendCloseout.enabled`, emails yesterday's
 * closeout (HTML + CSV + top-sellers/low-stock digest) and pushes the same
 * digest to the WhatsApp webhook at the configured Dhaka hour (0–23), once
 * per day.
 *
 * Idempotent by design: `settings.reports.lastCloseoutSentDate` is stamped
 * after a successful send, so overlapping ticks or a restart mid-day can
 * never double-send.
 */
export async function runCloseoutScheduler(now = new Date()) {
  const dhakaNow = new Date(now.getTime() + DHAKA_OFFSET_MS);
  const today = dhakaDate(now);
  const hour = dhakaNow.getUTCHours();
  const yesterday = new Date(dhakaNow.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const tenants = await Tenant.findAll({
    where: { status: { [Op.in]: ['active', 'trial'] } },
    attributes: ['id', 'name', 'status', 'settings'],
  });

  let sent = 0;
  for (const tenant of tenants) {
    const reports = tenant.settings?.reports;
    const cfg = reports?.autoSendCloseout;
    if (!cfg?.enabled || cfg.hour !== hour) continue;
    if (!reports?.closeoutEmail) continue;
    if (reports?.lastCloseoutSentDate === today) continue;

    try {
      const { email, digest } = await sendNightlyDigest({ tenant, date: yesterday });
      if (!email) continue;
      // Fire-and-forget WhatsApp push (signed when a secret is configured).
      const webhook = await sendDigestWebhook(tenant, digest);
      if (webhook?.sent) {
        console.log(`[digest] pushed ${digest.date} digest to WhatsApp webhook (${tenant.name})`);
      }
      // Stamp success — the once-per-day guard.
      const settings = {
        ...(tenant.settings || {}),
        reports: { ...(reports || {}), lastCloseoutSentDate: today },
      };
      await tenant.update({ settings });
      sent += 1;
      console.log(`[closeout] emailed ${email.date} closeout + digest to ${email.to} (${tenant.name})`);
    } catch (e) {
      // A failing workspace must never stop the others (or the loop).
      console.error(`[closeout] send failed for workspace ${tenant.id} (${tenant.name}): ${e.message}`);
    }
  }
  return sent;
}

/** Starts the per-minute tick. `unref()` keeps it from holding the process open. */
export function startCloseoutScheduler({ intervalMs = 60_000 } = {}) {
  const timer = setInterval(() => {
    runCloseoutScheduler().catch((e) =>
      console.error(`[closeout] scheduler tick failed: ${e.message}`)
    );
  }, intervalMs);
  timer.unref?.();
  console.log(`[closeout] nightly scheduler started (every ${intervalMs}ms)`);
  return timer;
}
