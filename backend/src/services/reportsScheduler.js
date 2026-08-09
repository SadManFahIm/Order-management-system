import { Op } from 'sequelize';
import Tenant from '../models/Tenant.js';
import { DHAKA_OFFSET_MS, dhakaDate, sendCloseoutEmail } from './reportsService.js';

/**
 * Nightly closeout email scheduler (Phase 5) — for each active workspace
 * with `settings.reports.autoSendCloseout.enabled`, emails yesterday's
 * closeout (HTML + CSV) at the configured Dhaka hour (0–23), once per day.
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
      const result = await sendCloseoutEmail({ tenant, date: yesterday });
      if (!result) continue;
      // Stamp success — the once-per-day guard.
      const settings = {
        ...(tenant.settings || {}),
        reports: { ...(reports || {}), lastCloseoutSentDate: today },
      };
      await tenant.update({ settings });
      sent += 1;
      console.log(`[closeout] emailed ${result.date} closeout to ${result.to} (${tenant.name})`);
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
