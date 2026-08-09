import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  verifySslcommerzSignature,
  verifyStripeSignature,
  applyGatewayConfirmation,
} from '../services/paymentGateway.js';

/**
 * Payment gateway webhooks (Phase 5).
 *
 * These are PUBLIC, unauthenticated endpoints (the gateways call them, not
 * the merchant), so authenticity is enforced with signatures instead:
 *   - SSLCommerz POSTs form data + `verify_sign` (md5 of store password +
 *     store id + tran id + amount + currency + status).
 *   - Stripe POSTs raw JSON with a `Stripe-Signature` HMAC-SHA256 header.
 *
 * Replayed webhooks are idempotent: the payment lookup requires status
 * `pending`, so a second confirmation simply no-ops.
 *
 * Mounted in app.js BEFORE the global JSON body parser — the Stripe route
 * needs the exact raw bytes for signature verification.
 */
const router = express.Router();

/** POST /api/webhooks/sslcommerz — payment confirmation (form-encoded). */
router.post(
  '/sslcommerz',
  express.urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (!verifySslcommerzSignature(body)) {
      throw new AppError(400, 'INVALID_SIGNATURE', 'Invalid SSLCommerz signature');
    }
    if (body.status !== 'VALID' && body.status !== 'SUCCESS') {
      // Failed/canceled transactions are acknowledged but never applied.
      return res.json({ received: true, status: body.status, applied: false });
    }
    const updated = await applyGatewayConfirmation({
      gateway: 'sslcommerz',
      reference: body.tran_id,
      gatewayReference: body.val_id || body.tran_id,
    });
    res.json({ received: true, applied: Boolean(updated) });
  })
);

/** POST /api/webhooks/stripe — payment confirmation (raw JSON + signature). */
router.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  asyncHandler(async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
    const signature = req.headers['stripe-signature'];
    if (!verifyStripeSignature(rawBody, signature)) {
      throw new AppError(400, 'INVALID_SIGNATURE', 'Invalid Stripe signature');
    }

    const event = JSON.parse(rawBody);
    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object || {};
      await applyGatewayConfirmation({
        gateway: 'stripe',
        reference: session.id,
        gatewayReference: session.payment_intent || session.id,
      });
    }
    // Every verified event is acknowledged — unhandled types are a no-op.
    res.json({ received: true, type: event.type });
  })
);

export default router;
