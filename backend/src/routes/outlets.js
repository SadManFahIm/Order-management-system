import express from 'express';
import { z } from 'zod';
import { literal } from 'sequelize';
import Outlet from '../models/Outlet.js';
import OutletMembership from '../models/OutletMembership.js';
import User from '../models/User.js';
import UserTenant from '../models/UserTenant.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { resolveTenant, requireTenant } from '../middleware/tenant.js';
import { parsePagination } from '../utils/pagination.js';

const router = express.Router();
router.use(authMiddleware, resolveTenant, requireTenant);

const canManageOutlets = requirePermission('manage:outlets');

// ── Validation schemas ──────────────────────────────────────────────

const createOutletSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  code: z.string().trim().min(1, 'Code is required').max(32),
  slug: z.string().trim().min(1, 'Slug is required').max(120),
  address: z.string().trim().max(500).optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  email: z.string().trim().max(200).optional().or(z.literal('')),
  timezone: z.string().trim().max(40).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  opening_hours: z.record(z.unknown()).optional(),
  settings: z.record(z.unknown()).optional(),
});

const updateOutletSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  address: z.string().trim().max(500).optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  email: z.string().trim().max(200).optional().or(z.literal('')),
  timezone: z.string().trim().max(40).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  opening_hours: z.record(z.unknown()).optional(),
  settings: z.record(z.unknown()).optional(),
});

const addMemberSchema = z.object({
  user_id: z.number().int().positive('user_id must be a positive integer'),
  role: z.enum(['outlet_manager', 'staff']).optional(),
});

// ── Outlet CRUD ─────────────────────────────────────────────────────

/** GET /api/outlets — list outlets for this tenant. */
router.get(
  '/',
  canManageOutlets,
  asyncHandler(async (req, res) => {
    const { limit, offset } = parsePagination(req.query);
    const { rows, count } = await Outlet.findAndCountAll({
      where: { tenant_id: req.tenant.id },
      attributes: {
        include: [
          [
            literal(`(
              SELECT COUNT(*)
              FROM outlet_memberships AS om
              WHERE om.outlet_id = "Outlet".id
                AND om.tenant_id = "Outlet".tenant_id
            )`),
            'member_count',
          ],
        ],
      },
      order: [['id', 'ASC']],
      limit,
      offset,
    });
    res.set('X-Total-Count', String(count));
    res.json(rows);
  })
);

/** POST /api/outlets — create a new outlet. */
router.post(
  '/',
  canManageOutlets,
  asyncHandler(async (req, res) => {
    const parsed = createOutletSchema.parse(req.body);

    // code + slug must be unique per tenant
    const existing = await Outlet.findOne({
      where: {
        tenant_id: req.tenant.id,
        ...(parsed.code ? { code: parsed.code } : {}),
      },
    });
    if (existing) {
      throw new AppError(409, 'DUPLICATE', `Outlet with code "${parsed.code}" already exists`);
    }

    const slugExists = await Outlet.findOne({
      where: { tenant_id: req.tenant.id, slug: parsed.slug },
    });
    if (slugExists) {
      throw new AppError(409, 'DUPLICATE', `Outlet with slug "${parsed.slug}" already exists`);
    }

    const outlet = await Outlet.create({
      tenant_id: req.tenant.id,
      name: parsed.name,
      code: parsed.code,
      slug: parsed.slug,
      address: parsed.address || null,
      phone: parsed.phone || null,
      email: parsed.email || null,
      timezone: parsed.timezone || 'Asia/Dhaka',
      status: parsed.status || 'active',
      opening_hours: parsed.opening_hours || {},
      settings: parsed.settings || {},
    });

    res.status(201).json(outlet);
  })
);

/** GET /api/outlets/:id — get a single outlet. */
router.get(
  '/:id',
  canManageOutlets,
  asyncHandler(async (req, res) => {
    const outlet = await Outlet.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!outlet) {
      throw new AppError(404, 'NOT_FOUND', 'Outlet not found');
    }
    res.json(outlet);
  })
);

/** PUT /api/outlets/:id — update an outlet. */
router.put(
  '/:id',
  canManageOutlets,
  asyncHandler(async (req, res) => {
    const outlet = await Outlet.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!outlet) {
      throw new AppError(404, 'NOT_FOUND', 'Outlet not found');
    }

    // Don't allow changing code or slug (they're identity fields).
    // Check the raw body before zod strips unknown keys.
    if (req.body.code || req.body.slug) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Cannot change outlet code or slug');
    }

    const parsed = updateOutletSchema.parse(req.body);

    await outlet.update(parsed);
    res.json(outlet);
  })
);

/** DELETE /api/outlets/:id — delete an outlet. */
router.delete(
  '/:id',
  canManageOutlets,
  asyncHandler(async (req, res) => {
    const outlet = await Outlet.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!outlet) {
      throw new AppError(404, 'NOT_FOUND', 'Outlet not found');
    }

    // Prevent deleting the last outlet
    const count = await Outlet.count({ where: { tenant_id: req.tenant.id } });
    if (count <= 1) {
      throw new AppError(400, 'LAST_OUTLET', 'Cannot delete the last outlet — every tenant needs at least one');
    }

    // Remove memberships first
    await OutletMembership.destroy({ where: { outlet_id: outlet.id, tenant_id: req.tenant.id } });
    await outlet.destroy();
    res.status(204).send();
  })
);

// ── Outlet Memberships ──────────────────────────────────────────────

/** GET /api/outlets/:id/members — list members of an outlet. */
router.get(
  '/:id/members',
  canManageOutlets,
  asyncHandler(async (req, res) => {
    const outlet = await Outlet.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!outlet) {
      throw new AppError(404, 'NOT_FOUND', 'Outlet not found');
    }

    const members = await OutletMembership.findAll({
      where: { outlet_id: outlet.id, tenant_id: req.tenant.id },
      include: [{ model: User, attributes: ['id', 'name', 'email'] }],
      order: [['id', 'ASC']],
    });

    res.json(members);
  })
);

/** POST /api/outlets/:id/members — add a user to an outlet. */
router.post(
  '/:id/members',
  canManageOutlets,
  asyncHandler(async (req, res) => {
    const outlet = await Outlet.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!outlet) {
      throw new AppError(404, 'NOT_FOUND', 'Outlet not found');
    }

    const parsed = addMemberSchema.parse(req.body);

    // User must be a member of this tenant
    const membership = await UserTenant.findOne({
      where: { user_id: parsed.user_id, tenant_id: req.tenant.id },
    });
    if (!membership) {
      throw new AppError(400, 'INVALID_USER', 'User is not a member of this workspace');
    }

    // Check for existing outlet membership
    const existing = await OutletMembership.findOne({
      where: {
        user_id: parsed.user_id,
        outlet_id: outlet.id,
        tenant_id: req.tenant.id,
      },
    });
    if (existing) {
      throw new AppError(409, 'DUPLICATE', 'User is already a member of this outlet');
    }

    const member = await OutletMembership.create({
      user_id: parsed.user_id,
      outlet_id: outlet.id,
      tenant_id: req.tenant.id,
      role: parsed.role || 'staff',
    });

    res.status(201).json(member);
  })
);

/** DELETE /api/outlets/:id/members/:userId — remove a user from an outlet. */
router.delete(
  '/:id/members/:userId',
  canManageOutlets,
  asyncHandler(async (req, res) => {
    const outlet = await Outlet.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!outlet) {
      throw new AppError(404, 'NOT_FOUND', 'Outlet not found');
    }

    const member = await OutletMembership.findOne({
      where: {
        outlet_id: outlet.id,
        user_id: req.params.userId,
        tenant_id: req.tenant.id,
      },
    });
    if (!member) {
      throw new AppError(404, 'NOT_FOUND', 'Member not found in this outlet');
    }

    await member.destroy();
    res.status(204).send();
  })
);

export default router;
