import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SMTPServer } from 'smtp-server';

/**
 * Real mail provider (Phase 5) — proves the nodemailer SMTP driver actually
 * delivers over a real SMTP conversation. Uses `smtp-server` (nodemailer's
 * own test server, same author) with STARTTLS hidden (its built-in cert is
 * expired) and auth optional — the full message including the base64 CSV
 * attachment is captured and asserted. No external mail server needed.
 *
 * Env (MAIL_DRIVER/SMTP_HOST/SMTP_PORT) is parsed once at import and is
 * immutable afterwards, so failure paths are exercised by stopping/restarting
 * the server on the SAME port rather than mutating env.
 */

// ── Env must be set before the env/config module loads ────────────────────
process.env.MAIL_DRIVER = 'smtp';
process.env.SMTP_HOST = '127.0.0.1';
process.env.MAIL_FROM = 'Orderly <no-reply@orderly.app>';

let messages = [];
let server;
let port;
let sendEmail;
let _resetMailer;

const startServer = () =>
  new Promise((resolve, reject) => {
    const srv = new SMTPServer({
      authOptional: true,
      hideSTARTTLS: true, // built-in cert is expired — skip TLS for the test
      onData(stream, session, callback) {
        let data = '';
        stream.on('data', (c) => (data += c));
        stream.on('end', () => {
          messages.push(data);
          callback();
        });
      },
    });
    srv.on('error', reject);
    srv.listen(port || 0, '127.0.0.1', () => {
      port = srv.server.address().port;
      resolve(srv);
    });
  });

beforeAll(async () => {
  server = await startServer();
  process.env.SMTP_PORT = String(port);
  ({ sendEmail, _resetMailer } = await import('../services/notifications/email.js'));
});

afterAll(async () => {
  _resetMailer?.();
  await new Promise((r) => server.close(r));
});

const waitForMessage = async (n = 1, timeoutMs = 4000) => {
  const start = Date.now();
  while (messages.length < n && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return messages.length >= n;
};

describe('sendEmail with MAIL_DRIVER=smtp', () => {
  it('delivers the HTML body and CSV attachment over a real SMTP connection', async () => {
    const result = await sendEmail({
      to: 'owner@restaurant.test',
      subject: 'Daily closeout — 2026-08-09 — KFC Dhaka',
      html: '<h1>KFC Dhaka — Daily Closeout</h1><p>Revenue: ৳ 6,390</p>',
      attachments: [
        { filename: 'closeout-2026-08-09.csv', content: 'order_no,amount\nORD-1,2000.00\n', contentType: 'text/csv' },
      ],
    });

    expect(result.smtp).toBe(true);
    expect(result.messageId).toBeTruthy();
    expect(await waitForMessage()).toBe(true);

    const mime = messages[0];
    expect(mime).toContain('From: Orderly <no-reply@orderly.app>');
    expect(mime).toContain('To: owner@restaurant.test');
    // Non-ASCII subject/body are RFC-2047 / quoted-printable encoded, so
    // assert the ASCII fragments around the encoded em-dash + taka sign.
    expect(mime).toContain('Subject: =?UTF-8?Q?Daily_closeout');
    expect(mime).toContain('Daily Closeout');
    expect(mime).toContain('6,390');
    expect(mime).toContain('closeout-2026-08-09.csv'); // attachment
    expect(mime).toContain('text/csv');
    expect(mime).toContain('Content-Type: multipart/mixed');
    expect(mime).toMatch(/Content-Transfer-Encoding: base64/i);
  });

  it('rejects a failed send and recovers on the next attempt (transport reset)', async () => {
    // Stop the server → the next send must reject AND drop the cached
    // transport; restart on the SAME port → the following send succeeds.
    messages = [];
    await new Promise((r) => server.close(r));
    _resetMailer();

    await expect(
      sendEmail({ to: 'x@test.dev', subject: 'boom', html: '<p>x</p>' })
    ).rejects.toThrow();

    server = await startServer(); // same `port`
    const result = await sendEmail({ to: 'after@test.dev', subject: 'recovered', html: '<p>ok</p>' });
    expect(result.smtp).toBe(true);
    expect(await waitForMessage()).toBe(true);
    expect(messages[0]).toContain('To: after@test.dev');
  });
});
