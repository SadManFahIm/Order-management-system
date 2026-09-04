import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';

/**
 * Email notification adapter (Phase 5).
 *
 * Two drivers behind the same interface:
 *   - `stub` (default): logs the message in dev/test — zero config, so
 *     verification/reset/closeout flows work without a mail server.
 *   - `smtp`: sends real mail through any SMTP server (Gmail, Zoho,
 *     Mailgun/SES/Resend SMTP, self-hosted Postfix…) via nodemailer.
 *
 * The transport is created lazily on first send and reset after a failure
 * (a dead transport would otherwise poison every later send). Attachments
 * pass through untouched — the closeout CSV rides along as-is.
 *
 * @param {{
 *   to: string,
 *   subject: string,
 *   html: string,
 *   attachments?: Array<{filename: string, content: string, contentType: string}>,
 * }} message
 */
export async function sendEmail({ to, subject, html, attachments = [] }) {
  if (env.MAIL_DRIVER === 'smtp') {
    return sendViaSmtp({ to, subject, html, attachments });
  }

  if (env.NODE_ENV !== 'production') {
    // Dev stub — sanitize interpolated values so a crafted recipient or
    // subject cannot forge log entries (log injection). CodeQL recognizes
    // newline-removal (replace \n with '') as the sanitizer for this sink.
    const sanitizeLogLine = (v) => String(v).replace(/\n/g, '').replace(/\r/g, '');
    console.log(
      `\n[email:stub] To: ${sanitizeLogLine(to)}\n[email:stub] Subject: ${sanitizeLogLine(subject)}\n[email:stub] Body:\n${sanitizeLogLine(html)}\n`
    );
    for (const a of attachments) {
      console.log(
        `[email:stub] Attachment: ${sanitizeLogLine(a.filename)} (${a.contentType}, ${Buffer.byteLength(a.content)} bytes)`
      );
    }
  }
  // Production with MAIL_DRIVER unset still resolves (nothing crashes), but
  // the message is not delivered — operators must configure SMTP.
  return { messageId: `stub-${randomUUID()}`, attachments: attachments.length };
}

let transport = null;

function getTransport() {
  if (transport) return transport;
  if (!env.SMTP_HOST) {
    throw new Error(
      'MAIL_DRIVER=smtp requires SMTP_HOST (and SMTP_USER/SMTP_PASS for authenticated servers)'
    );
  }
  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE, // false → STARTTLS on 587; true → implicit TLS on 465
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transport;
}

/** Send through SMTP; drop the transport on failure so the next send retries. */
async function sendViaSmtp(message) {
  try {
    const result = await getTransport().sendMail({
      from: env.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      attachments: message.attachments || [],
    });
    return { messageId: result.messageId, smtp: true, attachments: (message.attachments || []).length };
  } catch (e) {
    // A failed connection must not poison future sends — reset and rethrow.
    transport = null;
    throw e;
  }
}

/** Test hook: resets the cached transport (used by the SMTP suite). */
export function _resetMailer() {
  transport = null;
}
