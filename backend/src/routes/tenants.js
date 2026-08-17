import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { AppError } from '../middleware/errorHandler.js';
import { resolveTenant } from '../middleware/tenant.js';
import * as tenantService from '../services/tenantService.js';
import { getPlanUsage } from '../services/planService.js';
import { getBillingMeter, reportTenantMeter } from '../services/billingService.js';
import {
  TenantSamlConfig,
  TenantClosureDate,
  AvailabilityWeekdayRule,
} from '../models/index.js';
import { serializeSamlConfig } from '../services/samlService.js';
import { replaceTenantClosures, replaceTenantWeekdayClosures } from '../services/menuService.js';
import {
  createTenantSchema,
  updateTenantSchema,
  setStatusSchema,
  addMemberSchema,
  createInviteSchema,
  transferOwnershipSchema,
  changePlanSchema,
  samlConfigSchema,
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

/** GET /api/tenants/:id/billing/meter — usage meter snapshot (owner/platform admin). */
router.get(
  '/:id/billing/meter',
  asyncHandler(async (req, res) => {
    const { role, tenant } = await tenantService.assertTenantAccess(req.user, Number(req.params.id));
    if (role !== 'owner' && req.user.platform_role !== 'platform_admin') {
      throw new AppError(403, 'FORBIDDEN', 'Only the workspace owner can read the billing meter');
    }
    res.json(await getBillingMeter(tenant.id));
  })
);

/** POST /api/tenants/:id/billing/meter/report — push a meter snapshot to the billing webhook (owner/platform admin). */
router.post(
  '/:id/billing/meter/report',
  asyncHandler(async (req, res) => {
    const { role, tenant } = await tenantService.assertTenantAccess(req.user, Number(req.params.id));
    if (role !== 'owner' && req.user.platform_role !== 'platform_admin') {
      throw new AppError(403, 'FORBIDDEN', 'Only the workspace owner can trigger a billing report');
    }
    const result = await reportTenantMeter(tenant.id);
    res.json(result);
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

/** GET /api/tenants/:id/saml — SSO config view (owner or platform admin). */
router.get(
  '/:id/saml',
  asyncHandler(async (req, res) => {
    await tenantService.assertTenantAccess(req.user, Number(req.params.id));
    const config = await TenantSamlConfig.findOne({
      where: { tenant_id: Number(req.params.id) },
    });
    res.json(serializeSamlConfig(config));
  })
);

/** PUT /api/tenants/:id/saml — set SSO config (platform admin only). */
router.put(
  '/:id/saml',
  asyncHandler(async (req, res) => {
    const body = samlConfigSchema.parse(req.body);
    const config = await tenantService.setSamlConfig(
      req.user,
      Number(req.params.id),
      body,
      req
    );
    res.json(serializeSamlConfig(config));
  })
);

/**
 * GET /api/tenants/:id/closures — the workspace's restaurant-wide closure
 * dates (Phase 5), date-ascending. One-off closed days (holidays, private
 * events): the whole storefront is hidden that day and checkout is
 * rejected with RESTAURANT_CLOSED.
 */
router.get(
  '/:id/closures',
  asyncHandler(async (req, res) => {
    await tenantService.assertTenantAccess(req.user, Number(req.params.id));
    const rows = await TenantClosureDate.findAll({
      where: { tenant_id: Number(req.params.id) },
      order: [['date', 'ASC']],
    });
    res.json(rows.map((r) => ({ id: r.id, date: r.date })));
  })
);

/**
 * PUT /api/tenants/:id/closures — replace the workspace's restaurant-wide
 * closure dates (Phase 5). Body: `{ dates: ['YYYY-MM-DD', …] }`;
 * replace-all semantics (anything not sent is removed), validated + audited
 * as `menu.tenant_closures` in the service.
 */
router.put(
  '/:id/closures',
  asyncHandler(async (req, res) => {
    await tenantService.assertTenantAccess(req.user, Number(req.params.id), 'manage:settings');
    const saved = await replaceTenantClosures(
      Number(req.params.id),
      req.user,
      req.body?.dates,
      req
    );
    res.json(saved.map((r) => ({ id: r.id, date: r.date })));
  })
);

/**
 * GET /api/tenants/:id/weekday-closures — the weekdays the whole workspace
 * is closed every week (Phase 5), e.g. [5] = "closed every Saturday".
 */
router.get(
  '/:id/weekday-closures',
  asyncHandler(async (req, res) => {
    await tenantService.assertTenantAccess(req.user, Number(req.params.id));
    const rows = await AvailabilityWeekdayRule.findAll({
      where: { tenant_id: Number(req.params.id), menu_item_id: null },
      order: [['weekday', 'ASC']],
    });
    res.json(rows.map((r) => ({ id: r.id, weekday: r.weekday })));
  })
);

/**
 * PUT /api/tenants/:id/weekday-closures — replace the workspace's
 * restaurant-wide weekday closures (Phase 5). Body: `{ weekdays: [0–6] }`;
 * replace-all semantics, validated + audited in the service.
 */
router.put(
  '/:id/weekday-closures',
  asyncHandler(async (req, res) => {
    await tenantService.assertTenantAccess(req.user, Number(req.params.id), 'manage:settings');
    const saved = await replaceTenantWeekdayClosures(
      Number(req.params.id),
      req.user,
      req.body?.weekdays,
      req
    );
    res.json(saved.map((r) => ({ id: r.id, weekday: r.weekday })));
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
