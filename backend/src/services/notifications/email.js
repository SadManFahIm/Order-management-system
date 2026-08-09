import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * Email notification adapter (stub).
 *
 * In development/test this logs the email so flows are usable without a real
 * provider. Wire a production provider (Amazon SES, Mailgun, SMTP) behind this
 * interface without changing callers.
 *
 * @param {{
 *   to: string,
 *   subject: string,
 *   html: string,
 *   attachments?: Array<{filename: string, content: string, contentType: string}>,
 * }} message
 */
export async function sendEmail({ to, subject, html, attachments = [] }) {
  if (env.NODE_ENV !== 'production') {
    console.log(
      `\n[email:stub] To: ${to}\n[email:stub] Subject: ${subject}\n[email:stub] Body:\n${html}\n`
    );
    for (const a of attachments) {
      console.log(
        `[email:stub] Attachment: ${a.filename} (${a.contentType}, ${Buffer.byteLength(a.content)} bytes)`
      );
    }
  }
  // In production this would call the provider and return a real message id.
  return { messageId: `stub-${randomUUID()}`, attachments: attachments.length };
}
