import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import { User, Tenant, UserTenant } from '../models/index.js';
import {
  renderQuotaAlertHtml,
  sendQuotaAlertEmail,
  ownerEmailsFor,
} from '../services/notifications/quotaAlert.js';
import {
  renderUpgradeNudgeHtml,
  sendUpgradeNudgeEmail,
} from '../services/notifications/upgradeNudge.js';

/**
 * Coverage-oriented suite for the ticket-styled notification builders
 * (quota alert + trial upgrade nudge). These are pure render functions —
 * the goal is to exercise every level/label/escaping branch so the CI
 * coverage gate stays honest.
 */

const PASSWORD = 'Str0ngPass!42';
let tenant;

beforeAll(async () => {
  await resetTestDb();
  tenant = await Tenant.create({ name: 'Nudge Diner', slug: 'nudge-diner' });
  const owner = await User.create({
    name: 'Nudge Owner',
    email: 'nudge.owner@example.com',
    password: await bcrypt.hash(PASSWORD, 4),
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenant.id, role: 'owner' });
});

afterAll(async () => {
  await sequelize.close();
});

describe('quota alert email builder', () => {
  it('labels 100% as reached, 90-99% as nearly full, below as getting full', () => {
    const reached = renderQuotaAlertHtml({
      tenantName: 'T',
      planName: 'Pro',
      alert: { percent: 120, label: 'menu items', used: '30', limit: '20' },
    });
    expect(reached).toContain('Plan limit reached');
    // Percent is clamped to 100 and the meter width cannot exceed it.
    expect(reached).toContain('width:100%');

    const nearly = renderQuotaAlertHtml({
      tenantName: 'T',
      planName: null,
      alert: { percent: 92, label: 'orders', used: '46', limit: '50' },
    });
    expect(nearly).toContain('Plan nearly full');
    expect(nearly).toContain('92%');
    expect(nearly).toContain('current plan');

    const low = renderQuotaAlertHtml({
      tenantName: 'T',
      planName: 'Starter',
      alert: { percent: 0, label: 'storage', used: '1', limit: '100' },
    });
    expect(low).toContain('Plan getting full');
  });

  it('escapes HTML in tenant names and alert labels', () => {
    const html = renderQuotaAlertHtml({
      tenantName: '<b>X</b>',
      planName: 'P',
      alert: { percent: 95, label: 'orders <script>', used: '1', limit: '2' },
    });
    expect(html).not.toContain('<b>X</b>');
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;');
  });

  it('ownerEmailsFor returns only owners with a user email', async () => {
    const emails = await ownerEmailsFor(tenant.id);
    expect(emails).toEqual(['nudge.owner@example.com']);

    // No owners → empty list (never throws).
    const orphan = await Tenant.create({ name: 'Orphan', slug: 'orphan-nudge' });
    expect(await ownerEmailsFor(orphan.id)).toEqual([]);
  });

  it('sendQuotaAlertEmail degrades gracefully when no owners or SMTP is unset', async () => {
    const orphan = await Tenant.create({ name: 'Orphan 2', slug: 'orphan-nudge-2' });
    // No owners → null, no throw.
    expect(
      await sendQuotaAlertEmail({ tenant: orphan, alert: { percent: 100, label: 'x', used: '1', limit: '1' } })
    ).toBeNull();
  });
});

describe('trial upgrade nudge email builder', () => {
  it('renders with and without a trial end date', () => {
    const withDate = renderUpgradeNudgeHtml({
      tenantName: 'Diner',
      planName: 'Pro Trial',
      trialEndedAt: new Date('2026-08-01T00:00:00Z').toISOString(),
    });
    expect(withDate).toContain('Pro Trial');
    expect(withDate).toContain("You're now on the Free plan");

    const without = renderUpgradeNudgeHtml({ tenantName: 'Diner', planName: null, trialEndedAt: null });
    expect(without).toContain('trial ended');
    expect(without).toContain('Free');
  });

  it('escapes tenant name HTML', () => {
    const html = renderUpgradeNudgeHtml({
      tenantName: '<img src=x onerror=alert(1)>',
      planName: 'P',
      trialEndedAt: null,
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('sendUpgradeNudgeEmail returns null when no owner email exists', async () => {
    const orphan = await Tenant.create({ name: 'Orphan 3', slug: 'orphan-nudge-3' });
    expect(
      await sendUpgradeNudgeEmail({ tenant: orphan, planName: 'Trial', trialEndedAt: null })
    ).toBeNull();
  });
});
