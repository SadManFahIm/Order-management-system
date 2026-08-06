import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * Email notification adapter (stub).
 *
 * In development/test this logs the email so flows are usable without a real
 * provider. Wire a production provider (Amazon SES, Mailgun, SMTP) behind this
 * interface without changing callers.
 *
 * @param {{to: string, subject: string, html: string}} message
 */
export async function sendEmail({ to, subject, html }) {
  if (env.NODE_ENV !== 'production') {
    console.log(
      `\n[email:stub] To: ${to}\n[email:stub] Subject: ${subject}\n[email:stub] Body:\n${html}\n`
    );
  }
  // In production this would call the provider and return a real message id.
  return { messageId: `stub-${randomUUID()}` };
}
