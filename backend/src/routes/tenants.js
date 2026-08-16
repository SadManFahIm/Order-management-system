import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { AppError } from '../middleware/errorHandler.js';
import { resolveTenant } from '../middleware/tenant.js';
import * as tenantService from '../services/tenantService.js';
import { getPlanUsage } from '../services/planService.js';
import {
  createTenantSchema,
  updateTenantSchema,
  setStatusSchema,
  addMemberSchema,
  createInviteSchema,
  transferOwnershipSchema,
  changePlanSchema,
} from '../validators/tenant.js';

const router = express.Router();
router.use(authMiddleware, resolveTenant);

/** GET /api/tenants — my workspaces (platform admin: all with ?all=1). */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await tenantService.listMyTenants(req.user, { includeAll: req.query.all === '1' }));
  })
);

/** GET /api/tenants/:id — workspace detail (member or platform admin). */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { tenant } = await tenantService.assertTenantAccess(
      req.user,
      Number(req.params.id)
    );
    res.json(tenantService.serializeTenant(tenant));
  })
);

/** POST /api/tenants — create a workspace (creator becomes owner). */
router.post(
  '/',
  requirePermission('manage:tenants'),
  asyncHandler(async (req, res) => {
    const result = await tenantService.createTenant(
      req.user,
      createTenantSchema.parse(req.body),
      req
    );
    res.status(201).json(result);
  })
);

/** POST /api/tenants/:id/whatsapp/test — send a test alert to the webhook. */
router.post(
  '/:id/whatsapp/test',
  asyncHandler(async (req, res) => {
    const result = await tenantService.sendWhatsAppTest(
      req.user,
      Number(req.params.id),
      req
    );
    res.json(result);
  })
);

/** PATCH /api/tenants/:id — update name / logo / settings. */
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await tenantService.updateTenant(
      req.user,
      Number(req.params.id),
      updateTenantSchema.parse(req.body),
      req
    );
    res.json(result);
  })
);

/** PATCH /api/tenants/:id/status — platform-admin activate/suspend/archive. */
router.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = setStatusSchema.parse(req.body);
    const result = await tenantService.setTenantStatus(
      req.user,
      Number(req.params.id),
      status,
      req
    );
    res.json(result);
  })
);

/** GET /api/tenants/:id/members — team roster. */
router.get(
  '/:id/members',
  asyncHandler(async (req, res) => {
    res.json(await tenantService.listMembers(req.user, Number(req.params.id)));
  })
);

/** POST /api/tenants/:id/members — invite a member by email + role. */
router.post(
  '/:id/members',
  asyncHandler(async (req, res) => {
    const result = await tenantService.addMember(
      req.user,
      Number(req.params.id),
      addMemberSchema.parse(req.body),
      req
    );
    res.status(201).json(result);
  })
);

/** DELETE /api/tenants/:id/members/:userId — remove a member. */
router.delete(
  '/:id/members/:userId',
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    if (!Number.isInteger(Number(userId))) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid member id');
    }
    res.json(
      await tenantService.removeMember(req.user, Number(req.params.id), Number(userId), req)
    );
  })
);

// ── Phase 3: plan & usage, invites, ownership, audit ───────────────────────

/** GET /api/tenants/:id/plan — plan + subscription + live usage (any member). */
router.get(
  '/:id/plan',
  asyncHandler(async (req, res) => {
    await tenantService.assertTenantAccess(req.user, Number(req.params.id));
    res.json(await getPlanUsage(Number(req.params.id)));
  })
);

/** PATCH /api/tenants/:id/plan — platform-admin plan change. */
router.patch(
  '/:id/plan',
  asyncHandler(async (req, res) => {
    const { code } = changePlanSchema.parse(req.body);
    const result = await tenantService.changeTenantPlan(
      req.user,
      Number(req.params.id),
      code,
      req
    );
    res.json(result);
  })
);

/** POST /api/tenants/:id/invites — create an expiring invite (returns token once). */
router.post(
  '/:id/invites',
  asyncHandler(async (req, res) => {
    const result = await tenantService.createInvite(
      req.user,
      Number(req.params.id),
      createInviteSchema.parse(req.body),
      req
    );
    res.status(201).json(result);
  })
);

/** GET /api/tenants/:id/invites — list invites (any status). */
router.get(
  '/:id/invites',
  asyncHandler(async (req, res) => {
    res.json(await tenantService.listInvites(req.user, Number(req.params.id)));
  })
);

/** DELETE /api/tenants/:id/invites/:inviteId — revoke a pending invite. */
router.delete(
  '/:id/invites/:inviteId',
  asyncHandler(async (req, res) => {
    const inviteId = Number(req.params.inviteId);
    if (!Number.isInteger(inviteId) || inviteId <= 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid invite id');
    }
    res.json(
      await tenantService.revokeInvite(req.user, Number(req.params.id), inviteId, req)
    );
  })
);

/** POST /api/tenants/:id/transfer-ownership — owner hands over the workspace. */
router.post(
  '/:id/transfer-ownership',
  asyncHandler(async (req, res) => {
    const { userId } = transferOwnershipSchema.parse(req.body);
    const result = await tenantService.transferOwnership(
      req.user,
      Number(req.params.id),
      userId,
      req
    );
    res.json(result);
  })
);

/** GET /api/tenants/:id/audit — tenant-scoped audit trail (who changed what). */
router.get(
  '/:id/audit',
  asyncHandler(async (req, res) => {
    const result = await tenantService.listTenantAudit(
      req.user,
      Number(req.params.id),
      {
        limit: req.query.limit,
        offset: req.query.offset,
        action: req.query.action,
      }
    );
    res.json(result);
  })
);

export default router;
