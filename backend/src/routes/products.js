import express from 'express';
import Product from '../models/Product.js';
import MenuCategory from '../models/MenuCategory.js';
import ItemVariant from '../models/ItemVariant.js';
import ItemAddon from '../models/ItemAddon.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { resolveTenant, requireTenant } from '../middleware/tenant.js';
import { parsePagination } from '../utils/pagination.js';

// Rich menu includes (Phase 4).
const MENU_INCLUDE = [
  { model: MenuCategory, as: 'category', attributes: ['id', 'name'] },
  { model: ItemVariant, as: 'variants' },
  { model: ItemAddon, as: 'addons' },
];

const router = express.Router();
router.use(authMiddleware, resolveTenant, requireTenant);

// Product mutations require menu management rights (owner/manager/admin).
const canManageMenu = requirePermission('manage:menu');

/** GET /api/products?limit=&offset= — paginated list (returns an array + X-Total-Count). */
router.get(
  '/',
  requirePermission('view:menu'),
  asyncHandler(async (req, res) => {
    const { limit, offset } = parsePagination(req.query);

    const { rows, count } = await Product.findAndCountAll({
      where: { tenant_id: req.tenant.id },
      include: MENU_INCLUDE,
      order: [['id', 'ASC']],
      limit,
      offset,
    });

    res.set('X-Total-Count', String(count));
    res.json(rows);
  })
);

/** POST /api/products */
router.post(
  '/',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const { name, description, price, weight_gm, enabled, category_id, prep_minutes, image_url } =
      req.body;

    if (!name || typeof name !== 'string') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Product name is required');
    }
    if (typeof price !== 'number' || price < 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A non-negative price is required');
    }
    if (!Number.isInteger(weight_gm) || weight_gm <= 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'weight_gm must be a positive integer');
    }

    // The category must belong to the same tenant (fail-closed).
    if (category_id) {
      const category = await MenuCategory.findOne({
        where: { id: category_id, tenant_id: req.tenant.id },
      });
      if (!category) {
        throw new AppError(400, 'INVALID_CATEGORY', 'Category not found in this workspace');
      }
    }

    const p = await Product.create({
      tenant_id: req.tenant.id,
      name,
      description,
      price,
      weight_gm,
      enabled: enabled ?? true,
      category_id: category_id ?? null,
      prep_minutes: prep_minutes ?? null,
      image_url: image_url ?? null,
    });
    const withMenu = await Product.findByPk(p.id, { include: MENU_INCLUDE });
    res.status(201).json(withMenu);
  })
);

/** PUT /api/products/:id */
router.put(
  '/:id',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const p = await Product.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!p) throw new AppError(404, 'NOT_FOUND', 'Product not found');

    const { name, description, price, weight_gm, enabled, category_id, prep_minutes, image_url } =
      req.body;

    if (category_id !== undefined && category_id !== null) {
      const category = await MenuCategory.findOne({
        where: { id: category_id, tenant_id: req.tenant.id },
      });
      if (!category) {
        throw new AppError(400, 'INVALID_CATEGORY', 'Category not found in this workspace');
      }
      p.category_id = category_id;
    } else if (category_id === null) {
      p.category_id = null;
    }

    if (name !== undefined) p.name = name;
    if (description !== undefined) p.description = description;
    if (price !== undefined) p.price = price;
    if (weight_gm !== undefined) p.weight_gm = weight_gm;
    if (enabled !== undefined) p.enabled = enabled;
    if (prep_minutes !== undefined) p.prep_minutes = prep_minutes;
    if (image_url !== undefined) p.image_url = image_url;
    await p.save();

    const withMenu = await Product.findByPk(p.id, { include: MENU_INCLUDE });
    res.json(withMenu);
  })
);

export default router;
