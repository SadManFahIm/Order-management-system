import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { requirePermission, attachPermissionCheck } from '../middleware/rbac.js';
import { resolveTenant, requireTenant } from '../middleware/tenant.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import { applyPaymentStatus } from '../services/paymentsService.js';
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
          amount: payment.refunded_amount,
          reason: payment.refund_reason,
        },
        req,
      });
    }

    res.json(result.payment);
  })
);

export default router;
