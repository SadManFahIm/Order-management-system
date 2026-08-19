import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';
import Payment from '../models/Payment.js';
import {
  verifySslcommerzSignature,
  verifyStripeSignature,
  applyGatewayConfirmation,
  executeBkashPayment,
} from '../services/paymentGateway.js';

/**
 * Payment gateway webhooks (Phase 5/6).
 *
 * These are PUBLIC, unauthenticated endpoints (the gateways call them, not
 * the merchant), so authenticity is enforced with signatures instead:
 *   - SSLCommerz POSTs form data + `verify_sign` (md5 of store password +
 *     store id + tran id + amount + currency + status).
 *   - Stripe POSTs raw JSON with a `Stripe-Signature` HMAC-SHA256 header.
 *   - bKash redirects the customer's BROWSER to the callback (no signature) —
 *     the backend verifies by EXECUTING the payment and trusting the real
 *     transaction state, never the unsigned callback itself.
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
      // Server-side verification record (Phase 6): the gateway-signed amount
      // must match the charged amount, and the full confirmation is stored
      // on the payment for auditability.
      expectedAmount: body.amount,
      verification: {
        gateway: 'sslcommerz',
        transactionStatus: body.status,
        trxID: body.val_id || body.tran_id,
        amount: Number(body.amount),
        currency: body.currency,
        method: body.card_issuer_country ? 'card' : 'online',
      },
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
        expectedAmount: session.amount_total != null ? session.amount_total / 100 : undefined,
        verification: {
          gateway: 'stripe',
          transactionStatus: session.payment_status || 'Completed',
          trxID: session.payment_intent || session.id,
          amount: session.amount_total != null ? session.amount_total / 100 : undefined,
          currency: session.currency,
          method: 'card',
        },
      });
    }
    // Every verified event is acknowledged — unhandled types are a no-op.
    res.json({ received: true, type: event.type });
  })
);

/**
 * GET/POST /api/webhooks/bkash/callback — the customer's browser lands here
 * after paying on bKash's page (`?paymentID=…&status=success`). The callback
 * itself is UNSIGNED, so it is never trusted: the backend executes the
 * payment with the real gateway (the source of truth) and only then marks it
 * paid. The browser is redirected to the merchant's success/fail page either
 * way (a 2xx to the bKash redirect would confuse the browser UX).
 */
router.all(
  '/bkash/callback',
  express.urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    const paymentID = req.query?.paymentID || req.body?.paymentID;
    const status = req.query?.status || req.body?.status;
    if (!paymentID || typeof paymentID !== 'string') {
      throw new AppError(400, 'VALIDATION_ERROR', 'paymentID is required');
    }
    // Canceled / failed at the bKash page — acknowledge, no state change.
    if (status && status !== 'success') {
      return res.redirect(env.SSLCOMMERZ_FAIL_URL);
    }

    const executed = await executeBkashPayment(paymentID);
    if (executed.transactionStatus !== 'Completed') {
      return res.redirect(env.SSLCOMMERZ_FAIL_URL);
    }

    // The callback + execute round-trip is the verification, but the amount
    // must still match what this order was charged — a tampered paymentID is
    // caught by the amount check inside applyGatewayConfirmation.
    const payment = await Payment.findOne({
      where: { method: 'online', reference: paymentID },
    });

    await applyGatewayConfirmation({
      gateway: 'bkash',
      reference: paymentID,
      gatewayReference: executed.trxID || paymentID,
      expectedAmount: executed.amount != null ? executed.amount : payment?.amount,
      verification: {
        gateway: 'bkash',
        transactionStatus: executed.transactionStatus,
        trxID: executed.trxID,
        amount: Number(executed.amount),
        currency: executed.currency || 'BDT',
        method: 'bkash',
      },
    });
    return res.redirect(env.SSLCOMMERZ_SUCCESS_URL);
  })
);

export default router;
