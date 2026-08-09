import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import bcrypt from 'bcryptjs';

const emailSpy = vi.fn().mockResolvedValue({ messageId: 'stub-sched-1' });
vi.mock('../services/notifications/email.js', () => ({
  sendEmail: (...args) => emailSpy(...args),
}));

import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant } from '../models/index.js';
import { runCloseoutScheduler } from '../services/reportsScheduler.js';
import { DHAKA_OFFSET_MS } from '../services/reportsService.js';

/**
 * Nightly closeout email scheduler (Phase 5) — per-tenant Dhaka hour,
 * once per day, idempotent via lastCloseoutSentDate.
 */

let tenant;
// Fixed clock: 2026-08-10 23:00 UTC+6 → 17:00 UTC. Dhaka date = 08-10,
// hour = 23, so yesterday's closeout (08-09) is what gets emailed.
const FIXED_NOW = new Date(Date.UTC(2026, 7, 10, 17, 0, 0));
const today = new Date(FIXED_NOW.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10); // 2026-08-10
const yesterday = new Date(FIXED_NOW.getTime() + DHAKA_OFFSET_MS - 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // 2026-08-09

const makeTenant = async (name, reports) => {
  const t = await Tenant.create({ name, slug: `sched-${name.toLowerCase()}` });
  const u = await User.create({
    name: `Sched ${name}`,
    email: `sched-${name.toLowerCase()}@example.com`,
    password: await bcrypt.hash('password123', 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: u.id, tenant_id: t.id, role: 'owner' });
  if (reports) {
    await t.update({ settings: { reports } });
  }
  return t;
};

beforeAll(async () => {
  await resetTestDb();
  tenant = await makeTenant('Main', {
    closeoutEmail: 'nightly@example.com',
    autoSendCloseout: { enabled: true, hour: 23 },
  });
});

afterAll(async () => {
  await sequelize.close();
});

describe('runCloseoutScheduler', () => {
  it('emails yesterday\'s closeout to a workspace whose Dhaka hour matches', async () => {
    emailSpy.mockClear();
    const sent = await runCloseoutScheduler(FIXED_NOW);
    expect(sent).toBe(1);
    expect(emailSpy).toHaveBeenCalledTimes(1);
    const call = emailSpy.mock.calls[0][0];
    expect(call.to).toBe('nightly@example.com');
    expect(call.subject).toContain(yesterday);
    expect(call.attachments[0].filename).toBe(`closeout-${yesterday}.csv`);
  });

  it('never double-sends on a later tick the same day', async () => {
    emailSpy.mockClear();
    await runCloseoutScheduler(FIXED_NOW);
    expect(emailSpy).not.toHaveBeenCalled();
    // The send date is stamped on the tenant.
    const fresh = await Tenant.findByPk(tenant.id);
    expect(fresh.settings.reports.lastCloseoutSentDate).toBe(today);
  });

  it('skips workspaces with a different hour or auto-send disabled', async () => {
    const wrongHour = await makeTenant('WrongHour', {
      closeoutEmail: 'wrong@example.com',
      autoSendCloseout: { enabled: true, hour: 9 },
    });
    const disabled = await makeTenant('Disabled', {
      closeoutEmail: 'disabled@example.com',
      autoSendCloseout: { enabled: false, hour: 23 },
    });
    const noEmail = await makeTenant('NoEmail', { autoSendCloseout: { enabled: true, hour: 23 } });

    emailSpy.mockClear();
    const sent = await runCloseoutScheduler(FIXED_NOW);
    expect(sent).toBe(0);
    expect(emailSpy).not.toHaveBeenCalled();
    expect((await Tenant.findByPk(wrongHour.id)).settings.reports.lastCloseoutSentDate).toBeUndefined();
    expect((await Tenant.findByPk(disabled.id)).settings.reports.lastCloseoutSentDate).toBeUndefined();
    expect((await Tenant.findByPk(noEmail.id)).settings.reports.lastCloseoutSentDate).toBeUndefined();
  });

  it('keeps going when one workspace fails to send', async () => {
    const failing = await makeTenant('Failing', {
      closeoutEmail: 'fail@example.com',
      autoSendCloseout: { enabled: true, hour: 23 },
    });
    emailSpy.mockRejectedValueOnce(new Error('SMTP down'));

    // First tenant (Main) already sent today; Failing tries and fails, but
    // the loop must not crash and must not stamp lastCloseoutSentDate.
    const sent = await runCloseoutScheduler(FIXED_NOW);
    expect(sent).toBe(0);
    expect((await Tenant.findByPk(failing.id)).settings.reports.lastCloseoutSentDate).toBeUndefined();
  });
});
