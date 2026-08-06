import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { AppError } from '../middleware/errorHandler.js';
import { resolveTenant } from '../middleware/tenant.js';
import * as tenantService from '../services/tenantService.js';
import {
  createTenantSchema,
  updateTenantSchema,
  setStatusSchema,
  addMemberSchema,
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

export default router;
