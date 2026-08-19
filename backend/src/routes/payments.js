import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { requirePermission, attachPermissionCheck } from '../middleware/rbac.js';
import { resolveTenant, requireTenant } from '../middleware/tenant.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import { applyPaymentStatus, listPaymentRefunds } from '../services/paymentsService.js';
import { queryBkashPayment, applyGatewayConfirmation } from '../services/paymentGateway.js';
import { audit } from '../services/auditService.js';

const router = express.Router();
router.use(authMiddleware, attachPermissionCheck, resolveTenant, requireTenant);

/**
 * Payment records (Phase 5) — bKash/Nagad/cash lifecycle.
 *
 * Orders auto-create a payment record at placement (cash → paid, mobile
 * wallets → pending). These endpoints let a cashier confirm a wallet
 * transaction (trxID → paid) or refund/fail it, keeping the order's
 * denormalised payment_status in sync.
 */

/** GET /api/payments?orderId= — payment records for an order (view:orders). */
router.get(
  '/',
  requirePermission('view:orders'),
  asyncHandler(async (req, res) => {
    const where = { tenant_id: req.tenant.id };
    if (req.query.orderId) {
      where.order_id = Number(req.query.orderId);
    }
    res.json(
      await Payment.findAll({ where, order: [['id', 'ASC']] })
    );
  })
);

/**
 * GET /api/payments/:id/refunds — the refund ledger for a payment (view:orders).
 * Every refund (full or partial) is a row here, newest first.
 */
router.get(
  '/:id/refunds',
  requirePermission('view:orders'),
  asyncHandler(async (req, res) => {
    const payment = await Payment.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!payment) throw new AppError(404, 'NOT_FOUND', 'Payment not found');
    res.json(await listPaymentRefunds(payment.id, req.tenant.id));
  })
);

/**
 * POST /api/payments/:id/verify — manually verify a pending online payment
 * against its gateway (Phase 6). For bKash this queries the gateway for the
 * real transaction state and, when Completed + amount matches, confirms the
 * payment idempotently. Used when the browser callback was lost or a cashier
 * wants to double-check before hand-confirming. Requires `place:orders`.
 */
router.post(
  '/:id/verify',
  requirePermission('place:orders'),
  asyncHandler(async (req, res) => {
    const payment = await Payment.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!payment) throw new AppError(404, 'NOT_FOUND', 'Payment not found');
    if (payment.method !== 'online' || payment.status !== 'pending') {
      throw new AppError(400, 'NOT_VERIFIABLE', 'Only pending online payments can be verified');
    }
    if (payment.gateway === 'bkash' || !payment.gateway) {
      const queried = await queryBkashPayment(payment.reference);
      if (queried.transactionStatus !== 'Completed') {
        return res.json({ verified: false, status: queried.transactionStatus, payment });
      }
      const updated = await applyGatewayConfirmation({
        gateway: 'bkash',
        reference: payment.reference,
        gatewayReference: queried.trxID || payment.reference,
        expectedAmount: queried.amount,
        verification: {
          gateway: 'bkash',
          transactionStatus: queried.transactionStatus,
          trxID: queried.trxID,
          amount: Number(queried.amount),
          currency: queried.currency || 'BDT',
          method: 'bkash',
        },
      });
      await audit({
        action: 'payment.verified',
        actorId: req.user?.id,
        tenantId: req.tenant.id,
        entityType: 'payment',
        entityId: payment.id,
        metadata: { orderId: payment.order_id, gateway: 'bkash', trxID: queried.trxID },
        req,
      });
      return res.json({ verified: Boolean(updated), status: 'Completed', payment: updated });
    }
    throw new AppError(400, 'NOT_VERIFIABLE', 'Manual verification is only supported for bKash');
  })
);

/**
 * PATCH /api/payments/:id — confirm (paid), refund (full/partial with amount
 * + reason) or fail a payment. Refunds write the full audit trail
 * (refunded_amount / at / reason / by) and re-evaluate the order's
 * payment_status across ALL of its payments (split-aware).
 */
router.patch(
  '/:id',
  requirePermission('place:orders'),
  asyncHandler(async (req, res) => {
    const payment = await Payment.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!payment) throw new AppError(404, 'NOT_FOUND', 'Payment not found');

    const order = await Order.findOne({
      where: { id: payment.order_id, tenant_id: req.tenant.id },
    });
    if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found');

    const { status, reference, notes, amount, reason } = req.body;
    if (!status || typeof status !== 'string') {
      throw new AppError(400, 'VALIDATION_ERROR', 'status is required');
    }
    if (reference !== undefined && typeof reference !== 'string') {
      throw new AppError(400, 'VALIDATION_ERROR', 'reference must be a string');
    }
    if (notes !== undefined && typeof notes !== 'string') {
      throw new AppError(400, 'VALIDATION_ERROR', 'notes must be a string');
    }
    if (reason !== undefined && typeof reason !== 'string') {
      throw new AppError(400, 'VALIDATION_ERROR', 'reason must be a string');
    }
    if (amount !== undefined && typeof amount !== 'number') {
      throw new AppError(400, 'VALIDATION_ERROR', 'amount must be a number');
    }

    // Refunds move money out of the business — manager-and-above only
    // (permission-level RBAC, Phase 2). Cashiers can confirm/fail but never
    // refund, even though they hold 'place:orders'.
    if (status === 'refunded' && !req.userHas('refund:orders')) {
      throw new AppError(403, 'FORBIDDEN', 'Requires permission: refund:orders');
    }

    const result = await applyPaymentStatus(
      payment,
      { status, reference, notes, amount, reason, actorId: req.user?.id },
      order
    );

    // Refunds are money leaving the business — append to the audit trail.
    if (status === 'refunded') {
      await audit({
        action: 'payment.refunded',
        actorId: req.user?.id,
        tenantId: req.tenant.id,
        entityType: 'payment',
        entityId: payment.id,
        metadata: {
          orderId: order.id,
          amount: amount !== undefined ? amount : Number(payment.amount),
          totalRefunded: result.payment.refunded_amount,
          reason: reason || payment.refund_reason,
        },
        req,
      });
    }

    res.json(result.payment);
  })
);

export default router;
