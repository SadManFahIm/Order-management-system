import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { resolveTenant, requireTenant } from '../middleware/tenant.js';
import { audit } from '../services/auditService.js';
import {
  listSettlements,
  createSettlement,
  updateSettlement,
  gatewayWalletBalance,
} from '../services/settlementService.js';

/**
 * Settlements / withdrawals (Phase 6, Feature 4) — gateway → bank movement of
 * money. These endpoints are read-only for staff (`view:reports`); creating
 * or updating a settlement moves money to the bank, so it requires
 * `manage:settings` (manager-and-above), matching the refund RBAC.
 */
const router = express.Router();
router.use(authMiddleware, resolveTenant, requireTenant);

/** GET /api/settlements — settlement history for the tenant (newest first). */
router.get(
  '/',
  requirePermission('view:reports'),
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    res.json(await listSettlements(req.tenant.id, { status: status || undefined }));
  })
);

/** GET /api/settlements/balance — the gateway wallet balance (computed). */
router.get(
  '/balance',
  requirePermission('view:reports'),
  asyncHandler(async (req, res) => {
    res.json(await gatewayWalletBalance(req.tenant.id));
  })
);

/** POST /api/settlements — record a settlement/withdrawal request. */
router.post(
  '/',
  requirePermission('manage:settings'),
  asyncHandler(async (req, res) => {
    const settlement = await createSettlement(req.tenant.id, req.body, req.user?.id);
    await audit({
      action: 'settlement.created',
      actorId: req.user?.id,
      tenantId: req.tenant.id,
      entityType: 'settlement',
      entityId: settlement.id,
      metadata: {
        gateway: settlement.gateway,
        requestedAmount: settlement.requested_amount,
        currency: settlement.currency,
      },
      req,
    });
    res.status(201).json(settlement);
  })
);

/** PATCH /api/settlements/:id — update status / settled amounts / bank ref. */
router.patch(
  '/:id',
  requirePermission('manage:settings'),
  asyncHandler(async (req, res) => {
    const before = await updateSettlement(req.tenant.id, Number(req.params.id), req.body, req.user?.id);
    await audit({
      action: 'settlement.updated',
      actorId: req.user?.id,
      tenantId: req.tenant.id,
      entityType: 'settlement',
      entityId: before.id,
      metadata: { status: before.status, bankRef: before.bank_ref || null },
      req,
    });
    res.json(before);
  })
);

export default router;