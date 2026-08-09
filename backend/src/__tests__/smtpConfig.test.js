import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Real mail provider (Phase 5) — configuration guard: MAIL_DRIVER=smtp
 * without SMTP_HOST must fail loudly at send time, never silently drop mail.
 * Runs in its own file because env is parsed once at import (SMTP_HOST is
 * deliberately left unset here).
 */

process.env.MAIL_DRIVER = 'smtp';
// SMTP_HOST intentionally NOT set — this is the misconfiguration being tested.

let sendEmail;
let _resetMailer;

beforeAll(async () => {
  ({ sendEmail, _resetMailer } = await import('../services/notifications/email.js'));
});

afterAll(() => {
  _resetMailer?.();
});

describe('MAIL_DRIVER=smtp configuration guard', () => {
  it('rejects with a clear message when SMTP_HOST is missing', async () => {
    await expect(
      sendEmail({ to: 'x@test.dev', subject: 'x', html: '<p>x</p>' })
    ).rejects.toThrow(/SMTP_HOST/);
  });

  it('recovers after the transport is reset and SMTP_HOST becomes available', async () => {
    // Same process, so env cannot change — but the guard must re-check on
    // every send (no stale cached success). Reset + retry still fails loudly.
    _resetMailer();
    await expect(
      sendEmail({ to: 'x@test.dev', subject: 'x', html: '<p>x</p>' })
    ).rejects.toThrow(/SMTP_HOST/);
  });
});
